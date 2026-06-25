import { describe, it, expect } from "vitest";
import {
  validateRollupConfig,
  assertValidRollupConfig,
  RollupConfigError,
  presets,
  type RollupConfig,
} from "../src/index";

function base(): RollupConfig {
  return presets.custom({ rollupId: "r1" }).get();
}

describe("validateRollupConfig", () => {
  it("accepts a valid custom config", () => {
    const res = validateRollupConfig(base());
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it("rejects an incompatible settlement/proof pair", () => {
    const cfg = { ...base(), settlement: "zk", proofSystem: "fraud" } as RollupConfig;
    const res = validateRollupConfig(cfg);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("not compatible"))).toBe(true);
  });

  it("requires the based sequencer for based settlement", () => {
    const cfg = {
      ...base(),
      settlement: "based",
      proofSystem: "none",
      sequencer: "dedicated",
    } as RollupConfig;
    const res = validateRollupConfig(cfg);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("based settlement requires"))).toBe(true);
  });

  it("accepts based settlement with the based sequencer", () => {
    const cfg = {
      ...base(),
      settlement: "based",
      proofSystem: "none",
      sequencer: "based",
    } as RollupConfig;
    expect(validateRollupConfig(cfg).valid).toBe(true);
  });

  it("warns (but does not fail) when Celestia DA is selected", () => {
    const cfg = { ...base(), da: "celestia" } as RollupConfig;
    const res = validateRollupConfig(cfg);
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.toLowerCase().includes("celestia"))).toBe(true);
  });

  it("rejects empty rollupId and non-positive numeric fields", () => {
    const cfg = { ...base(), rollupId: "", blockTimeMs: 0, maxTxPerBlock: -1 } as RollupConfig;
    const res = validateRollupConfig(cfg);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("assertValidRollupConfig throws RollupConfigError on invalid input", () => {
    const cfg = { ...base(), settlement: "zk", proofSystem: "fraud" } as RollupConfig;
    expect(() => assertValidRollupConfig(cfg)).toThrow(RollupConfigError);
  });
});
