"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "../http";
import { cn } from "./cn";
import { Button, Notice } from "./primitives";

export type FormAction = (prev: ActionResult<unknown> | null, formData: FormData) => Promise<ActionResult<unknown>>;

function SubmitButton({ label, variant }: { label: string; variant?: "default" | "secondary" | "destructive" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

/**
 * Form bound to a server action returning `ActionResult`. Shows the action's error or success
 * message inline. The server action must call `requireRole()` and `audit()` itself.
 */
export function Form({
  action,
  submitLabel,
  variant,
  className,
  children,
}: {
  action: FormAction;
  submitLabel: string;
  variant?: "default" | "secondary" | "destructive";
  className?: string;
  children?: ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={cn("flex flex-col gap-3", className)}>
      {children}
      {state && !state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      {state?.ok && state.message ? <Notice tone="success">{state.message}</Notice> : null}
      <div>
        <SubmitButton label={submitLabel} variant={variant} />
      </div>
    </form>
  );
}
