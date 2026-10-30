// Pure, runtime-light shared types and constants. Safe to import from edge middleware and
// client components (no Prisma runtime). Prisma-generated types are re-exported from "./index".

export const ROLES = ["Analyst", "Reviewer", "Admin"] as const;
export type Role = (typeof ROLES)[number];

export const ENVIRONMENTS = ["dev", "staging", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Fields that are PII and must be masked unless the viewer has the Reviewer role. */
export const PII_FIELDS = ["ssn", "dob", "address", "documentNumber"] as const;
export type PiiField = (typeof PII_FIELDS)[number];

/** The authenticated principal as seen by the platform. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: Role[];
}

/** A principal that is not a human user (scheduled jobs, webhooks). */
export interface SystemActor {
  id: `system:${string}`;
  email: string;
}

export type Actor = SessionUser | SystemActor;
