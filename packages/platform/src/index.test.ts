import { describe, expect, it } from "vitest";
import { PLATFORM_VERSION } from "./index";

describe("platform", () => {
  it("exports a version", () => {
    expect(PLATFORM_VERSION).toBe("0.0.0");
  });
});
