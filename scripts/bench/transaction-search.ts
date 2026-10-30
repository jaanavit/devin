// Times the Phase 6 transaction searches against the current database (run on the full 500K seed):
//   pnpm bench:search
// Each case runs once to warm up, then RUNS times; prints median and max (ms) for the paged query +
// count, i.e. exactly what the /transactions page executes.
import "dotenv/config";
import { prisma } from "@fintech/models";
import { searchTransactions, type TxnFilters } from "../../apps/internal-tools/app/(tools)/transactions/_lib/search";

const RUNS = 7;
const DAY = 86_400_000;
const now = Date.now();
const page = { skip: 0, take: 25, sort: "createdAt" as const, dir: "desc" as const };

const cases: [string, TxnFilters, typeof page?][] = [
  ["no filters (newest first)", {}],
  ["transaction ID", { txnId: "txn_0250000" }],
  ["customer ID", { customer: "cus_012345" }],
  ["customer name prefix", { customer: "Olivia" }],
  ["merchant", { merchant: "Amazon" }],
  ["amount range $1,000–$1,500", { minAmountCents: 100_000, maxAmountCents: 150_000 }],
  ["date range (last 7 days)", { from: new Date(now - 7 * DAY), to: new Date(now) }],
  ["merchant + amount + 30 days", { merchant: "Apple", minAmountCents: 50_000, from: new Date(now - 30 * DAY) }],
  ["amount range, sorted by amount", { minAmountCents: 200_000 }, { ...page, sort: "amountCents" as never }],
  ["merchant, page 200", { merchant: "Uber" }, { ...page, skip: 199 * 25 }],
];

async function time(filters: TxnFilters, p: typeof page): Promise<{ ms: number; total: number }> {
  const t0 = performance.now();
  const { total } = await searchTransactions(filters, p);
  return { ms: performance.now() - t0, total };
}

async function main(): Promise<void> {
  const count = await prisma.transaction.count();
  console.log(`Transactions in DB: ${count.toLocaleString()}\n`);
  console.log("| Search | Matches | Median (ms) | Max (ms) |\n| --- | ---: | ---: | ---: |");
  let worst = 0;
  for (const [label, filters, p = page] of cases) {
    await time(filters, p);
    const samples: number[] = [];
    let total = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = await time(filters, p);
      samples.push(r.ms);
      total = r.total;
    }
    samples.sort((a, b) => a - b);
    const max = samples[samples.length - 1] ?? 0;
    worst = Math.max(worst, max);
    console.log(`| ${label} | ${total.toLocaleString()} | ${(samples[Math.floor(RUNS / 2)] ?? 0).toFixed(1)} | ${max.toFixed(1)} |`);
  }
  console.log(`\nSlowest single run: ${worst.toFixed(1)} ms (target < 1000 ms)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
