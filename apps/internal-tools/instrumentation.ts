import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentry";

export function register(): void {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(sentryOptions(process.env.SENTRY_DSN));
  }
}

/** Reports errors thrown while rendering server components, route handlers and server actions. */
export const onRequestError = Sentry.captureRequestError;
