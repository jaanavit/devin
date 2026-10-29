// Pure, isomorphic platform exports (safe for edge middleware and client components).
// Server-only helpers live in "@fintech/platform/server"; UI in "@fintech/platform/ui".
export * from "./errors";
export * from "./rbac";
export * from "./mask";
export * from "./csv";
export * from "./catalog";
export * from "./money";
export * from "./table-params";
export { DEMO_IDENTITIES, GROUP_ROLE_MAP, findIdentity, rolesForGroups, type IdpIdentity } from "./auth/mock-idp";
