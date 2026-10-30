import { PII_FIELDS, type PiiField, type SessionUser } from "@fintech/models/shared";
import { canViewPii } from "./rbac";

const PII_SET: ReadonlySet<string> = new Set(PII_FIELDS);
const DOT = "•";

export function isPiiField(key: string): key is PiiField {
  return PII_SET.has(key);
}

type PiiInput = string | Date | null | undefined;

function asText(value: Exclude<PiiInput, null | undefined>): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

/** Masks a single PII value. Always masks — callers decide (via `mask`) whether masking applies. */
export function maskValue(field: PiiField, value: PiiInput): string | null {
  if (value === null || value === undefined) return null;
  const text = asText(value);
  switch (field) {
    case "ssn":
      return `${DOT.repeat(3)}-${DOT.repeat(2)}-${text.replace(/\D/g, "").slice(-4)}`;
    case "documentNumber":
      return `${DOT.repeat(Math.max(text.length - 4, 4))}${text.slice(-4)}`;
    case "dob":
      return `${DOT.repeat(4)}-${DOT.repeat(2)}-${DOT.repeat(2)}`;
    case "address":
      return `${DOT.repeat(8)} (hidden)`;
  }
}

export type Masked<T> = { [K in keyof T]: K extends PiiField ? string | null : T[K] };

/**
 * Returns a copy of `record` with PII fields masked unless the viewer has the Reviewer role.
 * Reviewers receive PII fields normalised to strings (dates as YYYY-MM-DD) but unmasked.
 * Server code that returns unmasked PII must also audit the view (see `maskForViewer`).
 */
export function mask<T extends object>(record: T, viewer: Pick<SessionUser, "roles"> | null | undefined): Masked<T> {
  const reveal = canViewPii(viewer);
  const out: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const key of Object.keys(out)) {
    if (!isPiiField(key)) continue;
    const value = out[key] as PiiInput;
    out[key] = reveal ? (value === null || value === undefined ? null : asText(value)) : maskValue(key, value);
  }
  return out as Masked<T>;
}

/** Recursively replaces PII-named keys with a placeholder. Used before persisting/logging payloads. */
export function redactPii(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(redactPii);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, isPiiField(k) ? "[REDACTED]" : redactPii(v)]),
    );
  }
  return value;
}
