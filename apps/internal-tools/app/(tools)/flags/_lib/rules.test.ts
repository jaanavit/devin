import { describe, expect, it } from "vitest";
import { parseEnabled, parseReason, parseRollout, slackText } from "./rules";

describe("parseReason", () => {
  it("requires a non-blank reason for prod", () => {
    expect(() => parseReason("prod", null)).toThrow(/reason is required/i);
    expect(() => parseReason("prod", "   ")).toThrow(/reason is required/i);
    expect(parseReason("prod", "  incident 42 ")).toBe("incident 42");
  });

  it("makes the reason optional outside prod", () => {
    expect(parseReason("dev", null)).toBeNull();
    expect(parseReason("staging", "")).toBeNull();
    expect(parseReason("staging", "testing")).toBe("testing");
  });

  it("caps the reason length", () => {
    expect(() => parseReason("dev", "x".repeat(501))).toThrow(/at most 500/);
  });
});

describe("parseRollout", () => {
  it.each([["0", 0], ["25", 25], [" 100 ", 100]])("accepts %s", (raw, expected) => {
    expect(parseRollout(raw)).toBe(expected);
  });

  it.each([null, "", "-1", "101", "12.5", "abc", "1e2", "1000"])("rejects %s", (raw) => {
    expect(() => parseRollout(raw)).toThrow(/whole number from 0 to 100/);
  });
});

describe("parseEnabled", () => {
  it("parses true/false and rejects anything else", () => {
    expect(parseEnabled("true")).toBe(true);
    expect(parseEnabled("false")).toBe(false);
    expect(() => parseEnabled("on")).toThrow();
    expect(() => parseEnabled(null)).toThrow();
  });
});

describe("slackText", () => {
  it("describes the change, actor and reason", () => {
    const before = { key: "crypto-buy", environment: "prod", enabled: false, rolloutPercentage: 10 } as const;
    const text = slackText({ action: "feature_flag.toggle", before, after: { ...before, enabled: true }, actorEmail: "ada@example.com", reason: "launch" });
    expect(text).toContain("[prod] `crypto-buy` turned ON by ada@example.com");
    expect(text).toContain("off @ 10% → on @ 10%");
    expect(text).toContain("Reason: launch");
  });
});
