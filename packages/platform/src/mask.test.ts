import { describe, expect, it } from "vitest";
import { mask, maskValue, redactPii } from "./mask";

const analyst = { roles: ["Analyst" as const] };
const reviewer = { roles: ["Reviewer" as const] };
const admin = { roles: ["Admin" as const] };

const customer = {
  id: "cus_1",
  name: "Jane Doe",
  ssn: "123-45-6789",
  dob: new Date("1990-02-03T00:00:00Z"),
  address: "1 Main St, Springfield",
  documentNumber: "P12345678",
};

describe("mask()", () => {
  it("masks every PII field for Analysts and keeps non-PII intact", () => {
    const out = mask(customer, analyst);
    expect(out.id).toBe("cus_1");
    expect(out.name).toBe("Jane Doe");
    expect(out.ssn).toBe("•••-••-6789");
    expect(out.dob).toBe("••••-••-••");
    expect(out.address).not.toContain("Main");
    expect(out.documentNumber).toBe("•••••5678");
  });

  it("does not reveal PII to Admins (Admin does not imply Reviewer)", () => {
    expect(mask(customer, admin).ssn).toBe("•••-••-6789");
  });

  it("reveals PII to Reviewers, normalising dates", () => {
    const out = mask(customer, reviewer);
    expect(out.ssn).toBe("123-45-6789");
    expect(out.dob).toBe("1990-02-03");
    expect(out.documentNumber).toBe("P12345678");
  });

  it("masks for anonymous viewers and preserves nulls", () => {
    expect(mask({ ssn: null }, null).ssn).toBeNull();
    expect(mask({ ssn: "111-22-3333" }, undefined).ssn).toBe("•••-••-3333");
  });

  it("maskValue masks short document numbers without leaking length", () => {
    expect(maskValue("documentNumber", "AB12")).toBe("••••AB12");
  });
});

describe("redactPii()", () => {
  it("recursively redacts PII-named keys", () => {
    expect(redactPii({ a: 1, ssn: "x", nested: [{ dob: "y", ok: true }] })).toEqual({
      a: 1,
      ssn: "[REDACTED]",
      nested: [{ dob: "[REDACTED]", ok: true }],
    });
  });
});
