package io.github.qorechain.rdk.presets;

import io.github.qorechain.rdk.config.Constants;
import io.github.qorechain.rdk.config.Enums.DABackend;
import io.github.qorechain.rdk.config.Enums.GasModel;
import io.github.qorechain.rdk.config.Enums.ProfileName;
import io.github.qorechain.rdk.config.Enums.ProofSystem;
import io.github.qorechain.rdk.config.Enums.SequencerMode;
import io.github.qorechain.rdk.config.Enums.SettlementParadigm;
import io.github.qorechain.rdk.config.Enums.VmType;
import io.github.qorechain.rdk.config.RollupConfig;
import io.github.qorechain.rdk.config.RollupConfigBuilder;
import java.util.EnumMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * The five preset profiles and their documented default fields.
 *
 * <p>These mirror the network's published profile table. The proof system for each profile is the
 * one its settlement paradigm requires (optimistic → fraud, zk → snark, based → none).
 */
public final class Presets {
    private Presets() {}

    /** The documented default fields for each profile (excluding rollupId and stake). */
    public static final Map<ProfileName, RollupConfig> PRESET_DEFAULTS;

    static {
        Map<ProfileName, RollupConfig> m = new EnumMap<>(ProfileName.class);

        RollupConfig defi = base(ProfileName.DEFI);
        defi.settlement = SettlementParadigm.ZK;
        defi.sequencer = SequencerMode.DEDICATED;
        defi.da = DABackend.NATIVE;
        defi.proofSystem = ProofSystem.SNARK;
        defi.gasModel = GasModel.EIP1559;
        defi.vmType = VmType.EVM;
        defi.blockTimeMs = 500;
        defi.maxTxPerBlock = 10000;
        m.put(ProfileName.DEFI, defi);

        RollupConfig gaming = base(ProfileName.GAMING);
        gaming.settlement = SettlementParadigm.BASED;
        gaming.sequencer = SequencerMode.BASED;
        gaming.da = DABackend.NATIVE;
        gaming.proofSystem = ProofSystem.NONE;
        gaming.gasModel = GasModel.FLAT;
        gaming.vmType = VmType.CUSTOM;
        gaming.blockTimeMs = 200;
        gaming.maxTxPerBlock = 50000;
        m.put(ProfileName.GAMING, gaming);

        RollupConfig nft = base(ProfileName.NFT);
        nft.settlement = SettlementParadigm.OPTIMISTIC;
        nft.sequencer = SequencerMode.DEDICATED;
        nft.da = DABackend.CELESTIA;
        nft.proofSystem = ProofSystem.FRAUD;
        nft.gasModel = GasModel.STANDARD;
        nft.vmType = VmType.COSMWASM;
        nft.blockTimeMs = 2000;
        nft.maxTxPerBlock = 5000;
        nft.challengeWindowSecs = Constants.DEFAULT_CHALLENGE_WINDOW_SECS;
        nft.challengeBondUqor = Constants.DEFAULT_CHALLENGE_BOND_UQOR;
        m.put(ProfileName.NFT, nft);

        RollupConfig enterprise = base(ProfileName.ENTERPRISE);
        enterprise.settlement = SettlementParadigm.BASED;
        enterprise.sequencer = SequencerMode.BASED;
        enterprise.da = DABackend.NATIVE;
        enterprise.proofSystem = ProofSystem.NONE;
        enterprise.gasModel = GasModel.SUBSIDIZED;
        enterprise.vmType = VmType.EVM;
        enterprise.blockTimeMs = 1000;
        enterprise.maxTxPerBlock = 20000;
        m.put(ProfileName.ENTERPRISE, enterprise);

        RollupConfig custom = base(ProfileName.CUSTOM);
        custom.settlement = SettlementParadigm.OPTIMISTIC;
        custom.sequencer = SequencerMode.DEDICATED;
        custom.da = DABackend.NATIVE;
        custom.proofSystem = ProofSystem.FRAUD;
        custom.gasModel = GasModel.STANDARD;
        custom.vmType = VmType.EVM;
        custom.blockTimeMs = 1000;
        custom.maxTxPerBlock = 10000;
        custom.challengeWindowSecs = Constants.DEFAULT_CHALLENGE_WINDOW_SECS;
        custom.challengeBondUqor = Constants.DEFAULT_CHALLENGE_BOND_UQOR;
        m.put(ProfileName.CUSTOM, custom);

        PRESET_DEFAULTS = m;
    }

    private static RollupConfig base(ProfileName profile) {
        RollupConfig c = new RollupConfig();
        c.profile = profile;
        return c;
    }

    /**
     * Build a {@link RollupConfigBuilder} for a profile, applying any overrides on top of the
     * profile's documented defaults. The {@code profile} field always reflects the chosen preset.
     */
    public static RollupConfigBuilder preset(ProfileName name, Consumer<RollupConfig> overrides) {
        RollupConfig config = PRESET_DEFAULTS.get(name).copy();
        config.rollupId = "";
        if (overrides != null) {
            overrides.accept(config);
        }
        config.profile = name;
        return new RollupConfigBuilder(config);
    }

    public static RollupConfigBuilder defi(Consumer<RollupConfig> overrides) {
        return preset(ProfileName.DEFI, overrides);
    }

    public static RollupConfigBuilder gaming(Consumer<RollupConfig> overrides) {
        return preset(ProfileName.GAMING, overrides);
    }

    public static RollupConfigBuilder nft(Consumer<RollupConfig> overrides) {
        return preset(ProfileName.NFT, overrides);
    }

    public static RollupConfigBuilder enterprise(Consumer<RollupConfig> overrides) {
        return preset(ProfileName.ENTERPRISE, overrides);
    }

    public static RollupConfigBuilder custom(Consumer<RollupConfig> overrides) {
        return preset(ProfileName.CUSTOM, overrides);
    }
}
