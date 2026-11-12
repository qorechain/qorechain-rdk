package io.github.qorechain.rdk.errors;

import io.github.qorechain.tx.TxError;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Readable decoding of a transaction the {@code rdk} module refused.
 *
 * <p>{@link TxError#decode} in the QoreChain SDK names the {@code sdk} codespace's codes and falls
 * back to the raw log for a module's own. This adds the {@code rdk} module's codes, copied from the
 * chain's error registry, with what to do about the ones a rollup operator meets.
 */
public final class RdkErrors {
    private RdkErrors() {}

    /** One {@code rdk} codespace error: a stable kind, and a hint where there is one. */
    public static final class RdkErrorInfo {
        public final String kind;
        public final String message;
        /** What to do about it, or {@code null}. */
        public final String hint;

        RdkErrorInfo(String kind, String message, String hint) {
            this.kind = kind;
            this.message = message;
            this.hint = hint;
        }
    }

    /** The {@code rdk} codespace, code by code, as the chain registers it. */
    public static final Map<Integer, RdkErrorInfo> RDK_ERRORS;

    private static void put(Map<Integer, RdkErrorInfo> m, int code, String kind, String message, String hint) {
        m.put(code, new RdkErrorInfo(kind, message, hint));
    }

    static {
        Map<Integer, RdkErrorInfo> m = new LinkedHashMap<>();
        put(m, 2, "rollup_not_found", "rollup not found", null);
        put(m, 3, "rollup_already_exists", "rollup already exists", null);
        put(m, 4, "rollup_not_active", "rollup not active", null);
        put(m, 5, "max_rollups_reached", "maximum rollups reached", "every max_rollups slot is taken");
        put(m, 6, "insufficient_stake", "insufficient stake amount", "stake at least min_stake_for_rollup");
        put(m, 7, "unauthorized", "only the rollup creator can do this", null);
        put(m, 8, "batch_not_found", "batch not found", null);
        put(m, 9, "batch_exists", "a batch with this index already exists", null);
        put(m, 10, "challenge_window_closed", "challenge window closed or not applicable", "a batch can be challenged only while its own window is open");
        put(m, 11, "invalid_proof", "invalid proof", null);
        put(m, 12, "proof_required", "proof required for this settlement mode", null);
        put(m, 13, "da_blob_too_large", "DA blob exceeds the maximum size", null);
        put(m, 14, "da_blob_not_found", "DA blob not found", null);
        put(m, 15, "celestia_unavailable", "Celestia data availability is not active", null);
        put(m, 16, "invalid_settlement_mode", "invalid settlement mode", null);
        put(m, 17, "invalid_sequencer_mode", "invalid sequencer mode", null);
        put(m, 18, "invalid_proof_system", "invalid proof system", null);
        put(m, 19, "based_sequencer_only", "based settlement requires a based sequencer", null);
        put(m, 20, "challenge_bond_required", "a challenge bond is required", null);
        put(m, 21, "verification_key_missing", "ZK verification key not configured for the rollup", "register one with MsgSetVerificationKey (chain v3.2.7+) before the rollup's first batch");
        put(m, 22, "stark_not_supported", "STARK verification is not available for this rollup", null);
        put(m, 23, "proof_verify_failed", "ZK proof verification failed", null);
        put(m, 24, "no_open_challenge", "no open challenge for this batch", null);
        put(m, 25, "batch_not_challenged", "batch is not challenged", null);
        put(m, 26, "data_unavailable", "no DA blob matches the batch's data hash", "post the data with MsgPostRollupData (chain v3.2.8+) and carry its SHA-256, or leave data_hash empty");
        put(m, 27, "batch_not_finalized", "withdrawals need a finalized batch", null);
        put(m, 28, "withdrawal_already_done", "withdrawal already executed", null);
        put(m, 29, "invalid_withdrawal_proof", "withdrawal proof does not match the batch's withdrawals root", "build it with withdrawalsTree, using the batch's own binding (v2 from chain v3.2.5)");
        put(m, 30, "invalid_rollup_id", "invalid rollup id", null);
        put(m, 31, "anchor_refused", "the batch's signed state anchor was refused", "only the rollup creator's registered post-quantum key can sign the anchor");
        put(m, 32, "insufficient_escrow", "the rollup's escrow does not cover the withdrawal", null);
        put(m, 33, "invalid_withdrawal", "malformed withdrawal message", null);
        put(m, 34, "params_update_disabled", "rdk parameter updates are not enabled at this height", null);
        put(m, 35, "invalid_params", "invalid rdk parameters", null);
        put(m, 36, "settlement_pending", "the rollup has a batch that is not settled yet", "a rollup cannot be stopped, and cannot take more than 4096 waiting batches, while batches are unsettled");
        put(m, 37, "verification_key_disabled", "verification key registration is not enabled at this height", null);
        put(m, 38, "invalid_verification_key", "invalid ZK verification key", null);
        put(m, 39, "verification_key_locked", "the verification key can only be changed by governance after the first batch", null);
        put(m, 40, "batch_limit_reached", "the rollup reached max_batches_per_block in this block", null);
        put(m, 41, "rollup_data_disabled", "rollup data posting is not enabled at this height", null);
        put(m, 42, "rollup_data_too_large", "rollup data exceeds the per-message limit", "see max_posted_data_bytes");
        put(m, 43, "rollup_data_block_full", "the rollup data limit for this block is reached", "retry in a later block");
        put(m, 44, "based_sequencing_disabled", "based sequencing is not enabled at this height", null);
        put(m, 45, "based_sequencing_unsupported", "based sequencing is not available for this rollup", "zk (snark), based settlement and qledger-v1 optimistic rollups only");
        put(m, 46, "invalid_inbox_range", "the batch does not match the rollup inbox", "data_hash must be the inbox range commitment up to inbox_end; inbox_end must be 0 on a rollup that is not based");
        put(m, 47, "rollup_mode_disabled", "this rollup mode is not enabled at this height", null);
        put(m, 48, "invalid_rollup_mode", "invalid rollup execution or privacy mode", "a new optimistic rollup needs execution_vm qledger-v1 and based sequencing; a private rollup must be zk with a Groth16 key");
        put(m, 49, "submitter_bond_required", "submitter bond required", "bond at least min_submitter_bond first");
        put(m, 50, "submitter_bond_locked", "the submitter bond is still locked", "a full challenge window must pass after the submitter's last batch");
        put(m, 51, "fraud_not_proven", "the fraud proof does not show the batch invalid", null);
        put(m, 52, "stark_statement_unsupported", "this STARK verification key proves no rollup statement", "STARK settlement is paused; use a Groth16 (snark) key");
        put(m, 53, "invalid_envelope", "the post is not a valid envelope to the rollup's members", null);
        put(m, 54, "deposit_pool_not_empty", "the rollup still holds user deposits", null);
        RDK_ERRORS = Collections.unmodifiableMap(m);
    }

    /** A decoded transaction refusal. */
    public static final class DecodedTxError {
        public final int code;
        public final String codespace;
        /** A stable name for the refusal, e.g. {@code invalid_rollup_mode}. */
        public final String kind;
        /** A readable message (with the hint, when there is one). */
        public final String message;
        /** What to do about it, or {@code null}. */
        public final String hint;
        public final String rawLog;

        DecodedTxError(int code, String codespace, String kind, String message, String hint, String rawLog) {
            this.code = code;
            this.codespace = codespace;
            this.kind = kind;
            this.message = message;
            this.hint = hint;
            this.rawLog = rawLog;
        }
    }

    /**
     * Decode a refused transaction's {@code code}, {@code codespace} and raw log: the {@code rdk}
     * codespace from {@link #RDK_ERRORS}, everything else through the SDK's {@link TxError#decode}.
     */
    public static DecodedTxError decodeRdkTxError(int code, String codespace, String rawLog) {
        if ("rdk".equals(codespace)) {
            RdkErrorInfo info = RDK_ERRORS.get(code);
            if (info != null) {
                String message = info.hint == null ? info.message : info.message + " (" + info.hint + ")";
                return new DecodedTxError(code, "rdk", info.kind, message, info.hint, rawLog);
            }
        }
        TxError.QoreTxException e = TxError.decode(code, codespace, rawLog, null);
        return new DecodedTxError(code, codespace, e.kind, e.getMessage(), null, rawLog);
    }
}
