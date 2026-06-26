package io.github.qorechain.rdk.config;

import io.github.qorechain.rdk.config.Enums.DABackend;
import io.github.qorechain.rdk.config.Enums.GasModel;
import io.github.qorechain.rdk.config.Enums.ProfileName;
import io.github.qorechain.rdk.config.Enums.ProofSystem;
import io.github.qorechain.rdk.config.Enums.SequencerMode;
import io.github.qorechain.rdk.config.Enums.SettlementParadigm;
import io.github.qorechain.rdk.config.Enums.VmType;

/**
 * A fully resolved rollup configuration.
 *
 * <p>On creation the chain derives a rollup's settlement, sequencing, data availability, gas, and
 * timing from its {@code profile} (and {@code vmType}). This object captures the resolved
 * configuration for client-side validation, display, and to build a create message. Field overrides
 * beyond {@code profile} and {@code vmType} are used for local validation and clarity; the
 * authoritative configuration is whatever the chain records for the chosen profile.
 *
 * <p>Optional integer fields ({@code challengeWindowSecs}, {@code maxDaBlobSize}) use boxed types so
 * that "unset" is distinguishable from zero. Enum fields are (de)serialized as their wire strings.
 */
public class RollupConfig {
    /** Unique rollup identifier. */
    public String rollupId;
    /** The preset profile this configuration is based on. */
    public ProfileName profile;
    /** Settlement paradigm. */
    public SettlementParadigm settlement;
    /** Sequencer mode. */
    public SequencerMode sequencer;
    /** Mode-specific sequencer parameters. */
    public SequencerParams sequencerParams;
    /** Data-availability backend. */
    public DABackend da;
    /** Proof system (must be compatible with {@code settlement}). */
    public ProofSystem proofSystem;
    /** Gas / fee model. */
    public GasModel gasModel;
    /** Execution environment. */
    public VmType vmType;
    /** Target block time, in milliseconds. */
    public int blockTimeMs;
    /** Maximum transactions per rollup block. */
    public int maxTxPerBlock;
    /** Optimistic challenge window, in seconds. */
    public Integer challengeWindowSecs;
    /** Optimistic challenge bond, in uqor. */
    public String challengeBondUqor;
    /** Maximum DA blob size, in bytes. */
    public Integer maxDaBlobSize;
    /** Stake committed at creation, in uqor. Required to build a create message. */
    public String stakeAmountUqor;

    public RollupConfig() {}

    /** A deep copy of this configuration (the nested sequencer params are cloned). */
    public RollupConfig copy() {
        RollupConfig c = new RollupConfig();
        c.rollupId = rollupId;
        c.profile = profile;
        c.settlement = settlement;
        c.sequencer = sequencer;
        c.sequencerParams = sequencerParams == null ? null : sequencerParams.copy();
        c.da = da;
        c.proofSystem = proofSystem;
        c.gasModel = gasModel;
        c.vmType = vmType;
        c.blockTimeMs = blockTimeMs;
        c.maxTxPerBlock = maxTxPerBlock;
        c.challengeWindowSecs = challengeWindowSecs;
        c.challengeBondUqor = challengeBondUqor;
        c.maxDaBlobSize = maxDaBlobSize;
        c.stakeAmountUqor = stakeAmountUqor;
        return c;
    }
}
