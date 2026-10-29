import type { Environment } from "@fintech/models/shared";
import { Badge } from "@fintech/platform/ui";

export function EnvironmentBadge({ environment }: { environment: Environment }) {
  return <Badge tone={environment === "prod" ? "danger" : environment === "staging" ? "warning" : "neutral"}>{environment}</Badge>;
}

export function StatusBadge({ enabled }: { enabled: boolean }) {
  return <Badge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</Badge>;
}
