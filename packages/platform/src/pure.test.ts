import { describe, expect, it } from "vitest";
import { assertCanDecide, needsSecondApprover } from "./approval";
import { DEMO_IDENTITIES, rolesForGroups } from "./auth/mock-idp";
import { toolForPath, visibleTools, type ToolDefinition } from "./catalog";
import { toCsv } from "./csv";
import { ApprovalError } from "./errors";
import { parseDollarsToCents } from "./money";
import { isAllowedOutbound } from "./outbound";
import { parseTableParams } from "./table-params";
import { demoUsers } from "./testing";

describe("mock IdP group → role mapping", () => {
  it("maps groups to roles, ignoring unknown groups", () => {
    expect(rolesForGroups(["grp-compliance-analysts", "grp-compliance-reviewers", "grp-unknown"])).toEqual(["Analyst", "Reviewer"]);
    expect(rolesForGroups(["grp-unknown"])).toEqual([]);
  });

  it("has 6 demo users covering every role", () => {
    expect(DEMO_IDENTITIES).toHaveLength(6);
    const roles = new Set(DEMO_IDENTITIES.flatMap((i) => rolesForGroups(i.groups)));
    expect([...roles].sort()).toEqual(["Admin", "Analyst", "Reviewer"]);
  });
});

describe("catalog", () => {
  const tools: ToolDefinition[] = [
    { slug: "kyc", name: "KYC", href: "/kyc", owner: "Compliance", roles: ["Analyst", "Reviewer"], description: "" },
    { slug: "flags", name: "Flags", href: "/flags", owner: "Platform", roles: ["Admin"], description: "" },
  ];

  it("shows only tools the user may access", () => {
    expect(visibleTools(demoUsers.alice, tools).map((t) => t.slug)).toEqual(["kyc"]);
    expect(visibleTools(demoUsers.ada, tools).map((t) => t.slug)).toEqual(["flags"]);
    expect(visibleTools(null, tools)).toEqual([]);
  });

  it("matches paths by prefix without partial-segment matches", () => {
    expect(toolForPath("/kyc/case_1", tools)?.slug).toBe("kyc");
    expect(toolForPath("/kycx", tools)).toBeUndefined();
  });
});

describe("approval rules (pure)", () => {
  const pending = { status: "PENDING" as const, requesterId: demoUsers.alice.id, approverRoles: ["Reviewer" as const] };

  it("rejects self-approval even when the requester holds the approver role", () => {
    const req = { ...pending, requesterId: demoUsers.sam.id };
    expect(() => assertCanDecide(req, demoUsers.sam, "approve")).toThrowError(expect.objectContaining({ reason: "SELF_APPROVAL" }));
  });

  it("requires an approver role", () => {
    expect(() => assertCanDecide(pending, demoUsers.aaron, "approve")).toThrow(ApprovalError);
  });

  it("requires a reason to reject", () => {
    expect(() => assertCanDecide(pending, demoUsers.rita, "reject", "  ")).toThrowError(expect.objectContaining({ reason: "REASON_REQUIRED" }));
  });

  it("refuses to decide twice", () => {
    expect(() => assertCanDecide({ ...pending, status: "APPROVED" }, demoUsers.rita, "approve")).toThrowError(expect.objectContaining({ reason: "NOT_PENDING" }));
  });

  it("enforces thresholds: at or below auto-approves, above needs a checker", () => {
    const policy = { kind: "refund", entityType: "Refund", approverRoles: ["Reviewer" as const], autoApproveMaxCents: 50_000 };
    expect(needsSecondApprover(policy, 49_900)).toBe(false);
    expect(needsSecondApprover(policy, 50_000)).toBe(false);
    expect(needsSecondApprover(policy, 50_100)).toBe(true);
    expect(needsSecondApprover({ ...policy, autoApproveMaxCents: undefined }, 1)).toBe(true);
  });
});

describe("csv", () => {
  it("escapes quotes/commas and neutralises formula injection", () => {
    const csv = toCsv([{ a: 'x,"y"', b: "=HYPERLINK(1)" }], [
      { header: "a", value: (r) => r.a },
      { header: "b", value: (r) => r.b },
    ]);
    expect(csv).toBe('a,b\r\n"x,""y""",\'=HYPERLINK(1)\r\n');
  });
});

describe("table params", () => {
  it("whitelists sort keys and clamps paging", () => {
    const p = parseTableParams({ sort: "password", page: "-3", pageSize: "9999", status: " OPEN " }, { sortable: ["createdAt"], defaultSort: "createdAt", filterKeys: ["status"] });
    expect(p).toMatchObject({ sort: "createdAt", page: 1, pageSize: 25, skip: 0, filters: { status: "OPEN" } });
  });
});

describe("money", () => {
  it("parses dollars to integer cents", () => {
    expect(parseDollarsToCents("$1,234.5")).toBe(123_450);
    expect(parseDollarsToCents("499")).toBe(49_900);
    expect(parseDollarsToCents("1.234")).toBeNull();
    expect(parseDollarsToCents("-5")).toBeNull();
  });
});

describe("outbound allowlist", () => {
  const env = { PAYMENTS_MOCK_URL: "http://localhost:4100", SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/x" } as unknown as NodeJS.ProcessEnv;
  it("allows configured and static hosts only", () => {
    expect(isAllowedOutbound("http://localhost:4100/refunds", env)).toBe(true);
    expect(isAllowedOutbound("https://hooks.slack.com/services/x", env)).toBe(true);
    expect(isAllowedOutbound("https://o1.ingest.sentry.io/api", env)).toBe(true);
    expect(isAllowedOutbound("https://evil.example.com", env)).toBe(false);
    expect(isAllowedOutbound("https://hooks.slack.com.evil.io", env)).toBe(false);
    expect(isAllowedOutbound("not a url", env)).toBe(false);
  });
});
