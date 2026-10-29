import { ValidationError } from "@fintech/platform";
import { ENVIRONMENTS, type Environment, type FeatureFlag } from "@fintech/models";

export const FLAG_FILTER_KEYS = ["environment", "key"] as const;
export const REASON_MAX_LENGTH = 500;

export type FlagAuditAction = "feature_flag.toggle" | "feature_flag.set_rollout";

/** The fields of a flag that changes are audited and diffed on. */
export type FlagSnapshot = Pick<FeatureFlag, "key" | "environment" | "enabled" | "rolloutPercentage">;

export function snapshot(flag: FlagSnapshot): FlagSnapshot {
  return { key: flag.key, environment: flag.environment, enabled: flag.enabled, rolloutPercentage: flag.rolloutPercentage };
}

export function isEnvironment(value: unknown): value is Environment {
  return typeof value === "string" && (ENVIRONMENTS as readonly string[]).includes(value);
}

/** Prod changes require a non-blank reason; elsewhere it is optional. Returns the trimmed reason or null. */
export function parseReason(environment: Environment, raw: FormDataEntryValue | null): string | null {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length > REASON_MAX_LENGTH) throw new ValidationError(`Reason must be at most ${REASON_MAX_LENGTH} characters`, "reason_too_long");
  if (environment === "prod" && !reason) throw new ValidationError("A reason is required for prod changes", "reason_required");
  return reason || null;
}

/** Parses the desired on/off state from a form value ("true"/"false"). */
export function parseEnabled(raw: FormDataEntryValue | null): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ValidationError("enabled must be true or false");
}

/** Parses a whole-number rollout percentage in [0, 100]. */
export function parseRollout(raw: FormDataEntryValue | null): number {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,3}$/.test(text)) throw new ValidationError("Rollout must be a whole number from 0 to 100", "invalid_rollout");
  const value = Number(text);
  if (value > 100) throw new ValidationError("Rollout must be a whole number from 0 to 100", "invalid_rollout");
  return value;
}

const describe = (s: FlagSnapshot) => `${s.enabled ? "on" : "off"} @ ${s.rolloutPercentage}%`;

/** Slack text for a prod change. Contains flag metadata, the actor's work email and the reason only. */
export function slackText(change: { action: FlagAuditAction; before: FlagSnapshot; after: FlagSnapshot; actorEmail: string; reason: string | null }): string {
  const verb = change.action === "feature_flag.toggle" ? (change.after.enabled ? "turned ON" : "turned OFF") : "rollout changed";
  return [
    `:triangular_flag_on_post: [${change.after.environment}] \`${change.after.key}\` ${verb} by ${change.actorEmail}`,
    `${describe(change.before)} → ${describe(change.after)}`,
    `Reason: ${change.reason ?? "(none)"}`,
  ].join("\n");
}
