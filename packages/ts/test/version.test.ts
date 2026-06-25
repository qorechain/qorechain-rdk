import { describe, it, expect } from "vitest";
import { VERSION } from "../src/index";

describe("@qorechain/rdk", () => {
  it("exposes a semver version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
