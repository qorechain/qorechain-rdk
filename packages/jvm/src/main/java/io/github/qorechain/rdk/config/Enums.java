package io.github.qorechain.rdk.config;

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
     * The execution environment the rollup exposes. {@code CUSTOM} denotes an application-defined
     * VM; the wire value may be any identifier the network recognizes.
     */
    public enum VmType {
        EVM("evm"),
        COSMWASM("cosmwasm"),
        SVM("svm"),
        CUSTOM("custom");

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
