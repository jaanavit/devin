import "dotenv/config";
import { prisma, type Prisma } from "@fintech/models";
import { DEMO_IDENTITIES, rolesForGroups } from "@fintech/platform";
import { audit } from "@fintech/platform/server";
import {
  DOB_MISMATCH_CASE_ID,
  FRAUD_RING,
  customerRow,
  generateCustomers,
  generateFlags,
  generateFraudRing,
  generateKyc,
  generateRefunds,
  generateTransaction,
  mulberry32,
  type SeedCustomer,
} from "./seed/generate";

const TRANSACTIONS = Number(process.env.SEED_TRANSACTIONS ?? 500_000);
const CUSTOMERS = Number(process.env.SEED_CUSTOMERS ?? 25_000);
const KYC_CASES = 200;
const REFUNDS = 1_000;
const BATCH = 5_000;

const DOMAIN_TABLES = ["Refund", "ApprovalRequest", "KycDocument", "KycCase", "Transaction", "Customer", "FeatureFlag"];

function elapsed(start: number): string {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed synthetic data with NODE_ENV=production");
  const started = Date.now();
  const rng = mulberry32(20261029);
  const now = Date.now();

  console.log("Resetting domain tables (AuditLog is append-only and is never cleared)...");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${DOMAIN_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);

  console.log("Upserting demo users...");
  for (const i of DEMO_IDENTITIES) {
    const data = { email: i.email, name: i.name, roles: rolesForGroups(i.groups), idpGroups: i.groups };
    await prisma.user.upsert({ where: { id: i.sub }, create: { id: i.sub, ...data }, update: data });
  }

  const customers: SeedCustomer[] = [...generateCustomers(rng, CUSTOMERS), ...generateFraudRing(rng)];
  console.log(`Inserting ${customers.length.toLocaleString()} customers...`);
  for (let i = 0; i < customers.length; i += BATCH) {
    await prisma.customer.createMany({ data: customers.slice(i, i + BATCH).map(customerRow) });
  }

  console.log(`Inserting ${TRANSACTIONS.toLocaleString()} transactions...`);
  const ring = customers.filter((c) => (FRAUD_RING.customerIds as readonly string[]).includes(c.id));
  const refundCandidates: Prisma.TransactionCreateManyInput[] = [];
  let batch: Prisma.TransactionCreateManyInput[] = [];
  const txStart = Date.now();
  for (let i = 1; i <= TRANSACTIONS; i++) {
    // ~120 transactions spread across ring members so the ring shows up in linked-account views.
    const customer = i % 4_000 === 0 || i <= 120 ? (ring[i % ring.length] as SeedCustomer) : (customers[Math.floor(rng() * CUSTOMERS)] as SeedCustomer);
    const txn = generateTransaction(rng, i, customer, now);
    batch.push(txn);
    if (txn.status === "SETTLED" && refundCandidates.length < REFUNDS && rng() < 0.01) refundCandidates.push(txn);
    if (batch.length === BATCH || i === TRANSACTIONS) {
      await prisma.transaction.createMany({ data: batch });
      batch = [];
      if (i % 50_000 === 0) console.log(`  ${i.toLocaleString()} (${elapsed(txStart)})`);
    }
  }

  console.log(`Inserting ${KYC_CASES} KYC cases...`);
  const kyc = generateKyc(rng, customers.slice(0, CUSTOMERS), KYC_CASES, now, { analysts: ["u_alice", "u_sam"], reviewer: "u_rita" });
  await prisma.kycCase.createMany({ data: kyc.cases });
  await prisma.kycDocument.createMany({ data: kyc.documents });
  await prisma.approvalRequest.createMany({ data: kyc.approvals });

  console.log(`Inserting ${refundCandidates.length} refunds (+ approval requests)...`);
  const refunds = generateRefunds(rng, refundCandidates, now, { requesters: ["u_aaron", "u_alice"], approvers: ["u_felix", "u_rita"] });
  await prisma.approvalRequest.createMany({ data: refunds.approvals });
  await prisma.refund.createMany({ data: refunds.refunds });

  const flags = generateFlags(rng);
  console.log(`Inserting ${flags.length} feature flags...`);
  await prisma.featureFlag.createMany({ data: flags });

  await audit(
    { id: "system:seed", email: "seed@system" },
    {
      action: "seed.run",
      entityType: "Database",
      entityId: "synthetic",
      metadata: { customers: customers.length, transactions: TRANSACTIONS, kycCases: KYC_CASES, refunds: refundCandidates.length, flags: flags.length },
    },
  );

  console.log(`\nSeed complete in ${elapsed(started)}.`);
  console.log(`  Fraud ring: ${FRAUD_RING.customerIds.join(", ")} (device ${FRAUD_RING.device}, address hash ${FRAUD_RING.addressHash})`);
  console.log(`  DOB-mismatch KYC case: ${DOB_MISMATCH_CASE_ID}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
