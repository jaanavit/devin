import "dotenv/config";
import { prisma } from "@fintech/models";

async function main(): Promise<void> {
  console.log("Seed: nothing to seed yet (Phase 0).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
