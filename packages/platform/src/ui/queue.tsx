import { Form, type FormAction } from "./form";
import { Badge } from "./primitives";

/**
 * Claim/unclaim control for a work-queue item. `claimAction`/`unclaimAction` are server actions
 * that receive the item id as the `id` form field.
 */
export function Queue({
  itemId,
  assigneeName,
  isMine,
  canClaim,
  claimAction,
  unclaimAction,
}: {
  itemId: string;
  assigneeName: string | null;
  isMine: boolean;
  canClaim: boolean;
  claimAction: FormAction;
  unclaimAction: FormAction;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {assigneeName ? <Badge tone={isMine ? "info" : "neutral"}>Claimed by {isMine ? "you" : assigneeName}</Badge> : <Badge>Unclaimed</Badge>}
      {isMine ? (
        <Form action={unclaimAction} submitLabel="Unclaim" variant="secondary" className="flex-row items-center">
          <input type="hidden" name="id" value={itemId} />
        </Form>
      ) : canClaim && !assigneeName ? (
        <Form action={claimAction} submitLabel="Claim" className="flex-row items-center">
          <input type="hidden" name="id" value={itemId} />
        </Form>
      ) : null}
    </div>
  );
}
