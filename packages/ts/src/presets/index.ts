import { RollupConfigBuilder } from "../config/builder";
import type { ProfileName } from "../config/enums";
import type { RollupConfig } from "../config/types";
import { DEFAULT_CHALLENGE_BOND_UQOR, DEFAULT_RDK_PARAMS } from "../constants";

/** Resolved preset fields, excluding the per-user `rollupId` and stake. */
type PresetDefaults = Omit<RollupConfig, "rollupId" | "stakeAmountUqor">;

/**
 * The five preset profiles and their documented default fields.
 *
 * These mirror the network's published profile table. The proof system for each
 * profile is the one its settlement paradigm requires (optimistic → fraud,
 * zk → snark, based → none).
 */
export const PRESET_DEFAULTS: Record<ProfileName, PresetDefaults> = {
  defi: {
    profile: "defi",
    settlement: "zk",
    sequencer: "dedicated",
    da: "native",
    proofSystem: "snark",
    gasModel: "eip1559",
    vmType: "evm",
    blockTimeMs: 500,
    maxTxPerBlock: 10000,
  },
  gaming: {
    profile: "gaming",
    settlement: "based",
    sequencer: "based",
    da: "native",
    proofSystem: "none",
    gasModel: "flat",
    vmType: "custom",
    blockTimeMs: 200,
    maxTxPerBlock: 50000,
  },
  nft: {
    profile: "nft",
    settlement: "optimistic",
    sequencer: "dedicated",
    da: "celestia",
    proofSystem: "fraud",
    gasModel: "standard",
    vmType: "cosmwasm",
    blockTimeMs: 2000,
    maxTxPerBlock: 5000,
    challengeWindowSecs: DEFAULT_RDK_PARAMS.defaultChallengeWindow,
    challengeBondUqor: DEFAULT_CHALLENGE_BOND_UQOR,
  },
  enterprise: {
    profile: "enterprise",
    settlement: "based",
    sequencer: "based",
    da: "native",
    proofSystem: "none",
    gasModel: "subsidized",
    vmType: "evm",
    blockTimeMs: 1000,
    maxTxPerBlock: 20000,
  },
  custom: {
    profile: "custom",
    settlement: "optimistic",
    sequencer: "dedicated",
    da: "native",
    proofSystem: "fraud",
    gasModel: "standard",
    vmType: "evm",
    blockTimeMs: 1000,
    maxTxPerBlock: 10000,
    challengeWindowSecs: DEFAULT_RDK_PARAMS.defaultChallengeWindow,
    challengeBondUqor: DEFAULT_CHALLENGE_BOND_UQOR,
  },
};

/**
 * Build a {@link RollupConfigBuilder} for a profile, applying any overrides on
 * top of the profile's documented defaults. The `profile` field always reflects
 * the chosen preset (it is the wire value sent in the create message); overrides
 * adjust the resolved client-side configuration.
 */
function makePreset(name: ProfileName) {
  return (overrides: Partial<RollupConfig> = {}): RollupConfigBuilder => {
    const base = PRESET_DEFAULTS[name];
    const sequencerParams = overrides.sequencerParams
      ? { ...base.sequencerParams, ...overrides.sequencerParams }
      : base.sequencerParams;
    const config: RollupConfig = {
      rollupId: "",
      ...base,
      ...overrides,
      sequencerParams,
      profile: name,
    };
    return new RollupConfigBuilder(config);
  };
}

/**
 * First-class preset profiles. Each returns a {@link RollupConfigBuilder}
 * pre-filled with the profile's defaults; pass overrides to customize.
 *
 * ```ts
 * const builder = presets.defi({ rollupId: "my-defi-rollup" });
 * const config = builder.validate().build();
 * ```
 */
export const presets = {
  defi: makePreset("defi"),
  gaming: makePreset("gaming"),
  nft: makePreset("nft"),
  enterprise: makePreset("enterprise"),
  custom: makePreset("custom"),
};
