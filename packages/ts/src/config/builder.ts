import type { CreateRollupMsgInput, RollupConfig } from "./types";
import { assertValidRollupConfig, validateRollupConfig, type ValidationResult } from "./validate";
import { RollupConfigError } from "./errors";

/**
 * A fluent builder for a {@link RollupConfig}. Presets return a builder
 * pre-filled with their defaults; override fields with {@link set}, inspect with
 * {@link validationResult}, and produce a frozen config with {@link build} or an
 * on-chain create message with {@link toCreateMsg}.
 */
export class RollupConfigBuilder {
  private config: RollupConfig;

  constructor(initial: RollupConfig) {
    this.config = { ...initial };
  }

  /** Merge field overrides. Nested `sequencerParams` are merged, not replaced. */
  set(overrides: Partial<RollupConfig>): this {
    const sequencerParams = overrides.sequencerParams
      ? { ...this.config.sequencerParams, ...overrides.sequencerParams }
      : this.config.sequencerParams;
    this.config = { ...this.config, ...overrides, sequencerParams };
    return this;
  }

  /** A snapshot copy of the current (not necessarily valid) configuration. */
  get(): RollupConfig {
    return { ...this.config };
  }

  /** The structured validation result for the current configuration. */
  validationResult(): ValidationResult {
    return validateRollupConfig(this.config);
  }

  /** Validate, throwing {@link RollupConfigError} on any error. Returns `this`. */
  validate(): this {
    assertValidRollupConfig(this.config);
    return this;
  }

  /** Validate and return a frozen copy of the configuration. */
  build(): Readonly<RollupConfig> {
    assertValidRollupConfig(this.config);
    return Object.freeze({ ...this.config });
  }

  /**
   * Build the inputs for an on-chain `MsgCreateRollup`. Requires a stake amount,
   * either on the config (`stakeAmountUqor`) or via `opts.stakeAmount`. Read the
   * minimum from the chain with `rdk.params()`.
   */
  toCreateMsg(creator: string, opts: { stakeAmount?: string } = {}): CreateRollupMsgInput {
    assertValidRollupConfig(this.config);
    const stakeAmount = opts.stakeAmount ?? this.config.stakeAmountUqor;
    if (!stakeAmount) {
      throw new RollupConfigError([
        "a stake amount is required to build a create message; set stakeAmountUqor or pass " +
          "opts.stakeAmount (read the minimum from rdk.params())",
      ]);
    }
    return {
      creator,
      rollupId: this.config.rollupId,
      profile: this.config.profile,
      vmType: this.config.vmType,
      stakeAmount,
    };
  }
}
