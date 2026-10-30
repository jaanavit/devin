import { PlatformError } from "./errors";

export function errorResponse(err: unknown): Response {
  if (err instanceof PlatformError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
  // Log only the error class: messages from the DB layer can echo row values (PII).
  console.error("Unhandled route error:", err instanceof Error ? err.name : typeof err);
  return Response.json({ error: "internal_error" }, { status: 500 });
}

/** Wraps a route handler so platform errors become JSON responses with the right status. */
export function route<A extends unknown[]>(handler: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: string; code: string };

/**
 * Wraps the body of a server action so expected platform errors (403, validation, approval rules)
 * are returned to the form instead of surfacing as an opaque 500.
 * `requireRole()` must still be the first call inside `fn`.
 */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (err) {
    if (err instanceof PlatformError) return { ok: false, error: err.message, code: err.code };
    console.error("Unhandled action error:", err instanceof Error ? err.name : typeof err);
    return { ok: false, error: "Something went wrong", code: "internal_error" };
  }
}
