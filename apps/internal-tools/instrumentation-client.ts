import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentry";

// Browser errors. The DSN is public by design (it only allows sending events), hence NEXT_PUBLIC_.
Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
