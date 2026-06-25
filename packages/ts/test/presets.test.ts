import { describe, it, expect } from "vitest";
import { presets, PRESET_DEFAULTS, validateRollupConfig, PROFILE_NAMES } from "../src/index";

describe("preset profiles", () => {
  it("exposes exactly the five documented profiles", () => {
    expect(Object.keys(presets).sort()).toEqual([...PROFILE_NAMES].sort());
  });

  it("defi resolves to zk-snark / dedicated / native / eip1559 / evm", () => {
    const cfg = presets.defi({ rollupId: "d" }).get();
    expect(cfg).toMatchObject({
      profile: "defi",
      settlement: "zk",
      proofSystem: "snark",
      sequencer: "dedicated",
      da: "native",
      gasModel: "eip1559",
      vmType: "evm",
      blockTimeMs: 500,
      maxTxPerBlock: 10000,
    });
  });

  it("each preset's defaults are internally valid", () => {
    for (const name of PROFILE_NAMES) {
      const cfg = presets[name]({ rollupId: "x" }).get();
      const res = validateRollupConfig(cfg);
      expect(res.valid, `${name}: ${res.errors.join("; ")}`).toBe(true);
    }
  });

  it("gaming/enterprise use based settlement with the based sequencer", () => {
    for (const name of ["gaming", "enterprise"] as const) {
      const cfg = PRESET_DEFAULTS[name];
      expect(cfg.settlement).toBe("based");
      expect(cfg.sequencer).toBe("based");
      expect(cfg.proofSystem).toBe("none");
    }
  });

  it("applies overrides while forcing the profile name", () => {
    const cfg = presets.custom({ rollupId: "c", blockTimeMs: 250, vmType: "svm" }).get();
    expect(cfg.profile).toBe("custom");
    expect(cfg.blockTimeMs).toBe(250);
    expect(cfg.vmType).toBe("svm");
  });
});
