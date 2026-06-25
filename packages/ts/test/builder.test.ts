import { describe, it, expect } from "vitest";
import { presets, RollupConfigBuilder, RollupConfigError } from "../src/index";

describe("RollupConfigBuilder", () => {
  it("build() returns a frozen valid config", () => {
    const cfg = presets.defi({ rollupId: "d" }).build();
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(cfg.rollupId).toBe("d");
  });

  it("build() throws on an invalid override", () => {
    const builder = presets.defi({ rollupId: "d" }).set({ proofSystem: "fraud" });
    expect(() => builder.build()).toThrow(RollupConfigError);
  });

  it("set() merges nested sequencerParams", () => {
    const cfg = presets.custom({ rollupId: "c" })
      .set({ sequencerParams: { sequencerAddress: "qor1abc" } })
      .set({ sequencerParams: { sharedSetMinSize: 3 } })
      .get();
    expect(cfg.sequencerParams).toEqual({ sequencerAddress: "qor1abc", sharedSetMinSize: 3 });
  });

  it("toCreateMsg() produces the on-chain create inputs", () => {
    const msg = presets
      .defi({ rollupId: "d", stakeAmountUqor: "10000000000" })
      .toCreateMsg("qor1creator");
    expect(msg).toEqual({
      creator: "qor1creator",
      rollupId: "d",
      profile: "defi",
      vmType: "evm",
      stakeAmount: "10000000000",
    });
  });

  it("toCreateMsg() requires a stake amount", () => {
    expect(() => presets.defi({ rollupId: "d" }).toCreateMsg("qor1creator")).toThrow(
      RollupConfigError,
    );
  });

  it("toCreateMsg() accepts the stake via opts", () => {
    const msg = presets.gaming({ rollupId: "g" }).toCreateMsg("qor1c", { stakeAmount: "10000000000" });
    expect(msg.stakeAmount).toBe("10000000000");
    expect(msg.profile).toBe("gaming");
    expect(msg.vmType).toBe("custom");
  });

  it("is constructible directly from a full config", () => {
    const cfg = presets.nft({ rollupId: "n" }).get();
    const builder = new RollupConfigBuilder(cfg);
    expect(builder.validationResult().valid).toBe(true);
  });
});
