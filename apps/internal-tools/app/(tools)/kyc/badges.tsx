import type { KycStatus, RiskLevel } from "@fintech/models";
import { Badge, type BadgeTone } from "@fintech/platform/ui";

const STATUS_TONE: Record<KycStatus, BadgeTone> = { OPEN: "neutral", IN_REVIEW: "info", RECOMMENDED: "warning", APPROVED: "success", REJECTED: "danger" };
const RISK_TONE: Record<RiskLevel, BadgeTone> = { LOW: "neutral", MEDIUM: "warning", HIGH: "danger" };

export function StatusBadge({ status }: { status: KycStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status.replace("_", " ").toLowerCase()}</Badge>;
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Badge tone={RISK_TONE[risk]}>{risk.toLowerCase()} risk</Badge>;
}
