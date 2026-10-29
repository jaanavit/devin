import { prisma, type FeatureFlag } from "@fintech/models";
import { FORBIDDEN, auditRowsFor, demoUsers, isRedirectTo, resetDb, runAsUser, seedDemoUsers } from "@fintech/platform/testing";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import FlagDetailPage from "./[id]/page";
import { setRollout, toggleFlag } from "./actions";
import FlagsPage from "./page";

const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };
const SLACK_URL = "https://hooks.slack.com/services/T000/B000/test";
const nonAdmins = [demoUsers.alice, demoUsers.rita, demoUsers.sam];

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

let dev: FeatureFlag;
let prod: FeatureFlag;
let infoSpy: MockInstance<typeof console.info>;
let fetchSpy: MockInstance<typeof fetch>;

const slackStubCalls = () => infoSpy.mock.calls.filter(([msg]) => String(msg).startsWith("slack stub:"));

beforeEach(async () => {
  await resetDb();
  await seedDemoUsers();
  const base = { key: "crypto-buy", description: "Buy crypto from balance" };
  dev = await prisma.featureFlag.create({ data: { ...base, environment: "dev", enabled: false, rolloutPercentage: 0 } });
  prod = await prisma.featureFlag.create({ data: { ...base, environment: "prod", enabled: false, rolloutPercentage: 10 } });
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("/flags list page", () => {
  const props = { searchParams: Promise.resolve({}) };

  it("redirects anonymous users to /login", async () => {
    const err = await runAsUser(null, () => FlagsPage(props)).catch((e: unknown) => e);
    expect(isRedirectTo(err, "/login")).toBe(true);
  });

  it("renders 403 for every non-Admin, including Analyst+Reviewer", async () => {
    for (const user of nonAdmins) await expect(runAsUser(user, () => FlagsPage(props))).rejects.toMatchObject(FORBIDDEN);
  });

  it("renders for Admins, filtered by environment", async () => {
    await expect(runAsUser(demoUsers.ada, () => FlagsPage({ searchParams: Promise.resolve({ environment: "prod" }) }))).resolves.toBeTruthy();
  });
});

describe("/flags/[id] detail page", () => {
  const props = (id: string) => ({ params: Promise.resolve({ id }) });

  it("redirects anonymous users and renders 403 for non-Admins", async () => {
    const err = await runAsUser(null, () => FlagDetailPage(props(prod.id))).catch((e: unknown) => e);
    expect(isRedirectTo(err, "/login")).toBe(true);
    for (const user of nonAdmins) await expect(runAsUser(user, () => FlagDetailPage(props(prod.id)))).rejects.toMatchObject(FORBIDDEN);
  });

  it("renders for Admins and 404s on unknown flags", async () => {
    await expect(runAsUser(demoUsers.ada, () => FlagDetailPage(props(prod.id)))).resolves.toBeTruthy();
    await expect(runAsUser(demoUsers.ada, () => FlagDetailPage(props("nope")))).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("toggleFlag", () => {
  it("is denied for anonymous and non-Admin users, with no change and no audit", async () => {
    expect(await runAsUser(null, () => toggleFlag(null, form({ id: dev.id, enabled: "true" })))).toMatchObject({ ok: false, code: "unauthenticated" });
    for (const user of nonAdmins) {
      expect(await runAsUser(user, () => toggleFlag(null, form({ id: prod.id, enabled: "true", reason: "x" })))).toMatchObject({ ok: false, code: "forbidden" });
    }
    expect(await prisma.featureFlag.findMany({ where: { enabled: true } })).toHaveLength(0);
    expect(await auditRowsFor("FeatureFlag")).toHaveLength(0);
  });

  it("toggles a dev flag without a reason, audits before/after, and does not post to Slack", async () => {
    const res = await runAsUser(demoUsers.ada, () => toggleFlag(null, form({ id: dev.id, enabled: "true" })));
    expect(res).toMatchObject({ ok: true });
    expect(await prisma.featureFlag.findUniqueOrThrow({ where: { id: dev.id } })).toMatchObject({ enabled: true, updatedById: demoUsers.ada.id });
    const [row] = await auditRowsFor("FeatureFlag", dev.id);
    expect(row).toMatchObject({
      action: "feature_flag.toggle",
      actorId: demoUsers.ada.id,
      before: { key: "crypto-buy", environment: "dev", enabled: false, rolloutPercentage: 0 },
      after: { key: "crypto-buy", environment: "dev", enabled: true, rolloutPercentage: 0 },
      metadata: { environment: "dev", key: "crypto-buy", reason: null },
    });
    expect(slackStubCalls()).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a prod toggle without a reason: no change, no audit, no Slack", async () => {
    for (const reason of [undefined, "   "]) {
      const res = await runAsUser(demoUsers.ada, () => toggleFlag(null, form({ id: prod.id, enabled: "true", ...(reason === undefined ? {} : { reason }) })));
      expect(res).toMatchObject({ ok: false, code: "reason_required" });
    }
    expect((await prisma.featureFlag.findUniqueOrThrow({ where: { id: prod.id } })).enabled).toBe(false);
    expect(await auditRowsFor("FeatureFlag", prod.id)).toHaveLength(0);
    expect(slackStubCalls()).toHaveLength(0);
  });

  it("audits a prod toggle with its reason and uses the console stub (no PII) when Slack is unconfigured", async () => {
    const res = await runAsUser(demoUsers.ada, () => toggleFlag(null, form({ id: prod.id, enabled: "true", reason: "Launch approved in CAB-12" })));
    expect(res).toMatchObject({ ok: true });
    const [row] = await auditRowsFor("FeatureFlag", prod.id);
    expect(row).toMatchObject({
      action: "feature_flag.toggle",
      before: { enabled: false, rolloutPercentage: 10 },
      after: { enabled: true, rolloutPercentage: 10 },
      metadata: { environment: "prod", reason: "Launch approved in CAB-12" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    const stub = slackStubCalls();
    expect(stub).toHaveLength(1);
    expect(String(stub[0]![0])).toContain("crypto-buy");
    expect(String(stub[0]![0])).not.toContain(demoUsers.ada.email);
    expect(String(stub[0]![0])).not.toContain("CAB-12");
  });

  it("posts prod changes to the Slack webhook via outboundFetch when configured", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", SLACK_URL);
    await runAsUser(demoUsers.ada, () => toggleFlag(null, form({ id: prod.id, enabled: "true", reason: "Launch approved" })));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(SLACK_URL);
    expect(init?.method).toBe("POST");
    const { text } = JSON.parse(String(init?.body)) as { text: string };
    expect(text).toContain("[prod] `crypto-buy` turned ON by ada");
    expect(text).toContain("Reason: Launch approved");
  });

  it("keeps the committed change when Slack fails", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", SLACK_URL);
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchSpy.mockRejectedValue(new TypeError("network down"));
    const res = await runAsUser(demoUsers.ada, () => toggleFlag(null, form({ id: prod.id, enabled: "true", reason: "Launch" })));
    expect(res).toMatchObject({ ok: true });
    expect((await prisma.featureFlag.findUniqueOrThrow({ where: { id: prod.id } })).enabled).toBe(true);
    expect(await auditRowsFor("FeatureFlag", prod.id)).toHaveLength(1);
  });

  it("rejects a toggle to the current state and unknown flags", async () => {
    expect(await runAsUser(demoUsers.ada, () => toggleFlag(null, form({ id: dev.id, enabled: "false" })))).toMatchObject({ ok: false, code: "conflict" });
    expect(await runAsUser(demoUsers.ada, () => toggleFlag(null, form({ id: "nope", enabled: "true" })))).toMatchObject({ ok: false, code: "not_found" });
    expect(await auditRowsFor("FeatureFlag")).toHaveLength(0);
  });
});

describe("setRollout", () => {
  it("is denied for non-Admins", async () => {
    for (const user of nonAdmins) {
      expect(await runAsUser(user, () => setRollout(null, form({ id: dev.id, rolloutPercentage: "50" })))).toMatchObject({ ok: false, code: "forbidden" });
    }
    expect((await prisma.featureFlag.findUniqueOrThrow({ where: { id: dev.id } })).rolloutPercentage).toBe(0);
  });

  it("sets a dev rollout and audits before/after", async () => {
    expect(await runAsUser(demoUsers.ada, () => setRollout(null, form({ id: dev.id, rolloutPercentage: "50" })))).toMatchObject({ ok: true });
    const [row] = await auditRowsFor("FeatureFlag", dev.id);
    expect(row).toMatchObject({ action: "feature_flag.set_rollout", before: { rolloutPercentage: 0 }, after: { rolloutPercentage: 50 } });
  });

  it("requires a reason for prod, then audits and notifies", async () => {
    expect(await runAsUser(demoUsers.ada, () => setRollout(null, form({ id: prod.id, rolloutPercentage: "25" })))).toMatchObject({ ok: false, code: "reason_required" });
    expect(await auditRowsFor("FeatureFlag", prod.id)).toHaveLength(0);

    expect(await runAsUser(demoUsers.ada, () => setRollout(null, form({ id: prod.id, rolloutPercentage: "25", reason: "Ramp up" })))).toMatchObject({ ok: true });
    const [row] = await auditRowsFor("FeatureFlag", prod.id);
    expect(row).toMatchObject({ action: "feature_flag.set_rollout", before: { rolloutPercentage: 10 }, after: { rolloutPercentage: 25 }, metadata: { reason: "Ramp up" } });
    expect(slackStubCalls()).toHaveLength(1);
  });

  it("rejects invalid and unchanged percentages", async () => {
    expect(await runAsUser(demoUsers.ada, () => setRollout(null, form({ id: dev.id, rolloutPercentage: "150" })))).toMatchObject({ ok: false, code: "invalid_rollout" });
    expect(await runAsUser(demoUsers.ada, () => setRollout(null, form({ id: dev.id, rolloutPercentage: "0" })))).toMatchObject({ ok: false, code: "no_change" });
    expect(await auditRowsFor("FeatureFlag")).toHaveLength(0);
  });
});
