package io.github.qorechain.rdk.config;

import java.util.List;
import java.util.Set;

/**
 * The closed value sets accepted by the QoreChain {@code rdk} module.
 *
 * <p>These mirror the on-chain {@code rdk} module exactly. The string values are the wire values
 * the chain expects — do not localize or re-case them. Each enum exposes its wire value via
 * {@code wire()} and resolves from a wire string via {@code fromWire(String)} (returns {@code null}
 * for an unknown value).
 */
public final class Enums {
    private Enums() {}

    /** How a rollup settles to the Main Chain. */
    public enum SettlementParadigm {
        OPTIMISTIC("optimistic"),
        ZK("zk"),
        BASED("based"),
        SOVEREIGN("sovereign");

        private final String wire;

        SettlementParadigm(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static SettlementParadigm fromWire(String wire) {
            for (SettlementParadigm v : values()) {
                if (v.wire.equals(wire)) {
                    return v;
                }
            }
            return null;
        }
    }

    /** Who orders the rollup's transactions. */
    public enum SequencerMode {
        DEDICATED("dedicated"),
        SHARED("shared"),
        BASED("based");

        private final String wire;

        SequencerMode(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static SequencerMode fromWire(String wire) {
            for (SequencerMode v : values()) {
                if (v.wire.equals(wire)) {
                    return v;
                }
            }
            return null;
        }
    }

    /** The proof a settlement batch carries. */
    public enum ProofSystem {
        FRAUD("fraud"),
        SNARK("snark"),
        STARK("stark"),
        NONE("none");

        private final String wire;

        ProofSystem(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static ProofSystem fromWire(String wire) {
            for (ProofSystem v : values()) {
                if (v.wire.equals(wire)) {
                    return v;
                }
            }
            return null;
        }
    }

    /** Where rollup data is made available. */
    public enum DABackend {
        NATIVE("native"),
        CELESTIA("celestia"),
        BOTH("both");

        private final String wire;

        DABackend(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static DABackend fromWire(String wire) {
            for (DABackend v : values()) {
                if (v.wire.equals(wire)) {
                    return v;
                }
            }
            return null;
        }
    }

    /** The fee model the rollup charges. */
    public enum GasModel {
        STANDARD("standard"),
        EIP1559("eip1559"),
        FLAT("flat"),
        SUBSIDIZED("subsidized");

        private final String wire;

        GasModel(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static GasModel fromWire(String wire) {
            for (GasModel v : values()) {
                if (v.wire.equals(wire)) {
                    return v;
                }
            }
            return null;
        }
    }

    /**
     * The execution environment the rollup exposes.
     *
     * <ul>
     *   <li>{@code EVM} — Ethereum/Solidity.
     *   <li>{@code NATIVE} — the QoreChain Native runtime (Wasm smart contracts).
     *   <li>{@code SVM} — the Solana VM.
     *   <li>{@code CUSTOM} — an application-defined VM.
     * </ul>
     *
     * <p>{@code COSMWASM} is accepted as a legacy alias of {@code NATIVE} and is what both map to on
     * the wire of an on-chain {@code MsgCreateRollup} (the network, explorer, and dashboard use
     * {@code cosmwasm}). See {@link #vmTypeWireValue(String)} and {@link #vmTypeLabel(String)}.
     */
    public enum VmType {
        EVM("evm"),
        NATIVE("native"),
        SVM("svm"),
        CUSTOM("custom"),
        COSMWASM("cosmwasm");

        private final String wire;

        VmType(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static VmType fromWire(String wire) {
            for (VmType v : values()) {
                if (v.wire.equals(wire)) {
                    return v;
                }
            }
            return null;
        }
    }

    /** The advertised VM types ({@code native} is the QoreChain Native runtime). */
    public static final List<String> VM_TYPES = List.of("evm", "native", "svm", "custom");

    private static final Set<String> ACCEPTED_VM_TYPES =
            Set.of("evm", "native", "svm", "custom", "cosmwasm");

    /** Whether {@code value} is a VM type the RDK accepts (includes the {@code cosmwasm} alias). */
    public static boolean isVmType(String value) {
        return value != null && ACCEPTED_VM_TYPES.contains(value);
    }

    /**
     * The on-chain wire value for a VM type. The QoreChain Native runtime ({@code native}) is
     * transmitted as {@code cosmwasm} for consistency with the network, explorer, and dashboard; all
     * other values pass through unchanged. The wire value is never {@code native}.
     */
    public static String vmTypeWireValue(String vmType) {
        return "native".equals(vmType) ? "cosmwasm" : vmType;
    }

    /** A human-readable label for a VM type (the Wasm runtime reads as QoreChain Native). */
    public static String vmTypeLabel(String vmType) {
        if (vmType == null) {
            return null;
        }
        switch (vmType) {
            case "native":
            case "cosmwasm":
                return "QoreChain Native";
            case "evm":
                return "EVM";
            case "svm":
                return "SVM";
            case "custom":
                return "Custom";
            default:
                return vmType;
        }
    }

    /** Rollup lifecycle states. */
    public enum RollupStatus {
        PENDING("pending"),
        ACTIVE("active"),
        PAUSED("paused"),
        STOPPED("stopped");

        private final String wire;

        RollupStatus(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static RollupStatus fromWire(String wire) {
            for (RollupStatus v : values()) {
                if (v.wire.equals(wire)) {
                    return v;
                }
            }
            return null;
        }
    }

    /** Settlement-batch lifecycle states. */
    public enum BatchStatus {
        SUBMITTED("submitted"),
        CHALLENGED("challenged"),
        FINALIZED("finalized"),
        REJECTED("rejected");

        private final String wire;

        BatchStatus(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static BatchStatus fromWire(String wire) {
            for (BatchStatus v : values()) {
                if (v.wire.equals(wire)) {
                    return v;
                }
            }
            return null;
        }
    }

    /** The five preset profiles. */
    public enum ProfileName {
        DEFI("defi"),
        GAMING("gaming"),
        NFT("nft"),
        ENTERPRISE("enterprise"),
        CUSTOM("custom");

        private final String wire;

        ProfileName(String wire) {
            this.wire = wire;
        }

        public String wire() {
            return wire;
        }

        public static ProfileName fromWire(String wire) {
            for (ProfileName v : values()) {
                if (v.wire.equals(wire)) {
                    return v;
                }
            }
            return null;
        }
    }
}
