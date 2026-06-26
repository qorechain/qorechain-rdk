package io.github.qorechain.rdk.client;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Typed views over raw {@code rdk} REST payloads, with the loose-key mapping the reference uses. */
public final class Views {
    private Views() {}

    /** The {@code rdk} module parameters. */
    public static final class ParamsView {
        public int maxRollups;
        public String minStakeForRollup = "0";
        public String rollupCreationBurnRate = "0";
        public int defaultChallengeWindow;
        public int maxDaBlobSize;
        public int blobRetentionBlocks;
        public int maxBatchesPerBlock;
    }

    /** A rollup's configuration and status. */
    public static final class RollupView {
        public String rollupId = "";
        public String creator = "";
        public String profile = "";
        public String settlementMode = "";
        public String daBackend = "";
        public int blockTimeMs;
        public int maxTxPerBlock;
        public String vmType = "";
        public String status = "";
        public String stakeAmount = "0";
        public String layerId = "";
        public int createdHeight;
    }

    /** A settlement batch. */
    public static final class BatchView {
        public String rollupId = "";
        public int batchIndex;
        public String stateRoot = "";
        public String prevStateRoot = "";
        public int txCount;
        public String dataHash = "";
        public String proofType = "";
        public String status = "";
        public int submittedAt;
        public int finalizedAt;
        public String withdrawalsRoot = "";
    }

    /** An account balance for a single denom. */
    public static final class Balance {
        public final String denom;
        public final String amount;

        public Balance(String denom, String amount) {
            this.denom = denom;
            this.amount = amount;
        }
    }

    static Object pick(Map<String, Object> raw, String... keys) {
        for (String k : keys) {
            Object v = raw.get(k);
            if (v != null) {
                return v;
            }
        }
        return null;
    }

    static String asStr(Object v, String fallback) {
        if (v == null) {
            return fallback;
        }
        if (v instanceof String) {
            return (String) v;
        }
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (d == Math.floor(d) && !Double.isInfinite(d)) {
                return Long.toString((long) d);
            }
            return Double.toString(d);
        }
        if (v instanceof Boolean) {
            return v.toString();
        }
        return String.valueOf(v);
    }

    static int asNum(Object v, int fallback) {
        if (v == null) {
            return fallback;
        }
        if (v instanceof Number) {
            return (int) ((Number) v).doubleValue();
        }
        if (v instanceof String) {
            String s = (String) v;
            if (s.isEmpty()) {
                return fallback;
            }
            try {
                return (int) Double.parseDouble(s);
            } catch (NumberFormatException e) {
                return fallback;
            }
        }
        return fallback;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> asRecord(Object v) {
        if (v instanceof Map) {
            return (Map<String, Object>) v;
        }
        return new java.util.LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> asArray(Object v) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (v instanceof List) {
            for (Object item : (List<Object>) v) {
                out.add(asRecord(item));
            }
        }
        return out;
    }

    public static ParamsView mapParamsView(Map<String, Object> raw) {
        ParamsView p = new ParamsView();
        p.maxRollups = asNum(pick(raw, "max_rollups", "maxRollups"), 0);
        p.minStakeForRollup = asStr(pick(raw, "min_stake_for_rollup", "minStakeForRollup"), "0");
        p.rollupCreationBurnRate =
                asStr(pick(raw, "rollup_creation_burn_rate", "rollupCreationBurnRate"), "0");
        p.defaultChallengeWindow = asNum(pick(raw, "default_challenge_window", "defaultChallengeWindow"), 0);
        p.maxDaBlobSize = asNum(pick(raw, "max_da_blob_size", "maxDaBlobSize"), 0);
        p.blobRetentionBlocks = asNum(pick(raw, "blob_retention_blocks", "blobRetentionBlocks"), 0);
        p.maxBatchesPerBlock = asNum(pick(raw, "max_batches_per_block", "maxBatchesPerBlock"), 0);
        return p;
    }

    public static RollupView mapRollupView(Map<String, Object> raw) {
        RollupView r = new RollupView();
        r.rollupId = asStr(pick(raw, "rollup_id", "rollupId"), "");
        r.creator = asStr(pick(raw, "creator"), "");
        r.profile = asStr(pick(raw, "profile"), "");
        r.settlementMode = asStr(pick(raw, "settlement_mode", "settlementMode"), "");
        r.daBackend = asStr(pick(raw, "da_backend", "daBackend"), "");
        r.blockTimeMs = asNum(pick(raw, "block_time_ms", "blockTimeMs"), 0);
        r.maxTxPerBlock = asNum(pick(raw, "max_tx_per_block", "maxTxPerBlock"), 0);
        r.vmType = asStr(pick(raw, "vm_type", "vmType"), "");
        r.status = asStr(pick(raw, "status"), "");
        r.stakeAmount = asStr(pick(raw, "stake_amount", "stakeAmount"), "0");
        r.layerId = asStr(pick(raw, "layer_id", "layerId"), "");
        r.createdHeight = asNum(pick(raw, "created_height", "createdHeight"), 0);
        return r;
    }

    public static BatchView mapBatchView(Map<String, Object> raw) {
        BatchView b = new BatchView();
        b.rollupId = asStr(pick(raw, "rollup_id", "rollupId"), "");
        b.batchIndex = asNum(pick(raw, "batch_index", "batchIndex"), 0);
        b.stateRoot = asStr(pick(raw, "state_root", "stateRoot"), "");
        b.prevStateRoot = asStr(pick(raw, "prev_state_root", "prevStateRoot"), "");
        b.txCount = asNum(pick(raw, "tx_count", "txCount"), 0);
        b.dataHash = asStr(pick(raw, "data_hash", "dataHash"), "");
        b.proofType = asStr(pick(raw, "proof_type", "proofType"), "");
        b.status = asStr(pick(raw, "status"), "");
        b.submittedAt = asNum(pick(raw, "submitted_at", "submittedAt"), 0);
        b.finalizedAt = asNum(pick(raw, "finalized_at", "finalizedAt"), 0);
        b.withdrawalsRoot = asStr(pick(raw, "withdrawals_root", "withdrawalsRoot"), "");
        return b;
    }
}
