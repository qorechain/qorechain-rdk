package io.github.qorechain.rdk.config;

import java.util.List;
import java.util.function.Consumer;

/**
 * A fluent builder for a {@link RollupConfig}. Presets return a builder pre-filled with their
 * defaults; override fields with {@link #set(Consumer)}, inspect with {@link #validationResult()},
 * and produce a config with {@link #build()} or an on-chain create message with
 * {@link #toCreateMsg(String, String)}.
 */
public class RollupConfigBuilder {
    private RollupConfig config;

    public RollupConfigBuilder(RollupConfig initial) {
        this.config = initial.copy();
    }

    /**
     * Apply field overrides by mutating a copy of the current configuration. Nested sequencer params
     * carry over unless replaced.
     */
    public RollupConfigBuilder set(Consumer<RollupConfig> mutate) {
        RollupConfig next = config.copy();
        mutate.accept(next);
        config = next;
        return this;
    }

    /** Set the rollup id. */
    public RollupConfigBuilder rollupId(String id) {
        config.rollupId = id;
        return this;
    }

    /** Set the committed stake, in uqor. */
    public RollupConfigBuilder stakeAmountUqor(String stake) {
        config.stakeAmountUqor = stake;
        return this;
    }

    /** Merge the given sequencer params onto the current ones. */
    public RollupConfigBuilder mergeSequencerParams(SequencerParams p) {
        if (config.sequencerParams == null) {
            config.sequencerParams = p == null ? null : p.copy();
            return this;
        }
        if (p == null) {
            return this;
        }
        if (p.sequencerAddress != null) {
            config.sequencerParams.sequencerAddress = p.sequencerAddress;
        }
        if (p.sharedSetMinSize != null) {
            config.sequencerParams.sharedSetMinSize = p.sharedSetMinSize;
        }
        if (p.inclusionDelay != null) {
            config.sequencerParams.inclusionDelay = p.inclusionDelay;
        }
        if (p.priorityFeeShare != null) {
            config.sequencerParams.priorityFeeShare = p.priorityFeeShare;
        }
        return this;
    }

    /** A snapshot copy of the current (not necessarily valid) configuration. */
    public RollupConfig get() {
        return config.copy();
    }

    /** The structured validation result for the current configuration. */
    public ValidationResult validationResult() {
        return Validate.validateRollupConfig(config);
    }

    /** Validate, throwing {@link RollupConfigError} on any error. Returns {@code this}. */
    public RollupConfigBuilder validate() {
        Validate.assertValidRollupConfig(config);
        return this;
    }

    /** Validate and return a copy of the configuration. */
    public RollupConfig build() {
        Validate.assertValidRollupConfig(config);
        return config.copy();
    }

    /**
     * Build the inputs for an on-chain {@code MsgCreateRollup}. Requires a stake amount, either on
     * the config ({@code stakeAmountUqor}) or passed explicitly. Read the minimum from the chain
     * with the params query surface.
     */
    public CreateRollupMsgInput toCreateMsg(String creator, String stakeAmount) {
        Validate.assertValidRollupConfig(config);
        String stake = stakeAmount;
        if (stake == null || stake.isEmpty()) {
            stake = config.stakeAmountUqor;
        }
        if (stake == null || stake.isEmpty()) {
            throw new RollupConfigError(
                    List.of(
                            "a stake amount is required to build a create message; set stakeAmountUqor or pass "
                                    + "stakeAmount (read the minimum from the params query)"));
        }
        return new CreateRollupMsgInput(creator, config.rollupId, config.profile, config.vmType, stake);
    }
}
