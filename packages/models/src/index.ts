import type { $Enums, Prisma as PrismaTypes } from "@prisma/client";
import type { Environment as SharedEnvironment, Role as SharedRole } from "./shared";

export { prisma } from "./client";
export { Prisma } from "@prisma/client";
export type {
  ApprovalRequest,
  ApprovalStatus,
  AuditLog,
  Customer,
  FeatureFlag,
  KycCase,
  KycDocument,
  KycOutcome,
  KycStatus,
  PrismaClient,
  Refund,
  RefundStatus,
  RiskLevel,
  Transaction,
  TransactionStatus,
  User,
} from "@prisma/client";
export * from "./shared";

/** A Prisma client or an interactive-transaction client. */
export type Db = PrismaTypes.TransactionClient;

// Compile-time guarantees that the pure shared unions stay in sync with the Prisma schema.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _roleInSync: Equals<SharedRole, $Enums.Role> = true;
const _envInSync: Equals<SharedEnvironment, $Enums.Environment> = true;
void _roleInSync;
void _envInSync;
