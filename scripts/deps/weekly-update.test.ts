import { describe, expect, it } from "vitest";
import { pickVersions } from "./weekly-update";

const NOW = Date.parse("2026-10-29T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const times = {
  created: daysAgo(900),
  "1.2.0": daysAgo(100),
  "1.2.3": daysAgo(60),
  "1.3.0": daysAgo(10),
  "1.4.0": daysAgo(2), // too new
  "1.5.0-beta.1": daysAgo(20), // prerelease
  "2.0.0": daysAgo(30),
  "3.0.0": daysAgo(1), // too new
};

describe("weekly dependency picker", () => {
  it("picks the newest same-major release at least 7 days old and reports majors separately", () => {
    expect(pickVersions("1.2.0", times, NOW)).toEqual({ sameMajor: "1.3.0", newerMajor: "2.0.0" });
  });

  it("returns nothing when already current or not exactly pinned", () => {
    expect(pickVersions("2.0.0", times, NOW)).toEqual({ sameMajor: undefined, newerMajor: undefined });
    expect(pickVersions("^1.2.0", times, NOW)).toEqual({});
    expect(pickVersions("workspace:*", times, NOW)).toEqual({});
  });
});
