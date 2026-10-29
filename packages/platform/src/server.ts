// Server-only platform API. Never import from client components or edge middleware.
export { authOptions, isMockIdpEnabled } from "./auth/options";
export { getSessionUser, runAsUser } from "./auth/session";
export { requirePageRole, requireRole } from "./auth/require-role";
export { audit, auditLogsToCsv, auditWhere, queryAuditLogs, AUDIT_EXPORT_LIMIT, type AuditEntry, type AuditFilters } from "./audit";
export {
  approveRequest,
  assertCanDecide,
  createApprovalRequest,
  isApproved,
  needsSecondApprover,
  rejectRequest,
  type ApprovalPolicy,
} from "./approval";
export { maskForViewer } from "./pii";
export { allowedOutboundHosts, isAllowedOutbound, outboundFetch } from "./outbound";
export { errorResponse, route, runAction, type ActionResult } from "./http";
export { inTransaction, type DbClient } from "./db";
export { createPaymentsClient, paymentsClient, PaymentsServiceError, type PaymentsClient } from "./services/payments";
