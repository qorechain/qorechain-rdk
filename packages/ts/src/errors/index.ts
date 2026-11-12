/**
 * Readable decoding of a transaction the `rdk` module refused.
 *
 * `decodeTxError` in `@qorechain/sdk` names the `sdk` codespace's codes and
 * falls back to the raw log for a module's own. This adds the `rdk` module's
 * codes, copied from the chain's error registry, with what to do about the
 * ones a rollup operator meets.
 */
import { decodeTxError, type DecodedTxError, type TxErrorInput } from "@qorechain/sdk";

/** One `rdk` codespace error: a stable kind, and a hint where there is one. */
interface RdkErrorInfo {
  kind: string;
  message: string;
  hint?: string;
}

/** The `rdk` codespace, code by code, as the chain registers it. */
export const RDK_ERRORS: Readonly<Record<number, RdkErrorInfo>> = {
  2: { kind: "rollup_not_found", message: "rollup not found" },
  3: { kind: "rollup_already_exists", message: "rollup already exists" },
  4: { kind: "rollup_not_active", message: "rollup not active" },
  5: { kind: "max_rollups_reached", message: "maximum rollups reached", hint: "every max_rollups slot is taken" },
  6: { kind: "insufficient_stake", message: "insufficient stake amount", hint: "stake at least min_stake_for_rollup" },
  7: { kind: "unauthorized", message: "only the rollup creator can do this" },
  8: { kind: "batch_not_found", message: "batch not found" },
  9: { kind: "batch_exists", message: "a batch with this index already exists" },
  10: {
    kind: "challenge_window_closed",
    message: "challenge window closed or not applicable",
    hint: "a batch can be challenged only while its own window is open",
  },
  11: { kind: "invalid_proof", message: "invalid proof" },
  12: { kind: "proof_required", message: "proof required for this settlement mode" },
  13: { kind: "da_blob_too_large", message: "DA blob exceeds the maximum size" },
  14: { kind: "da_blob_not_found", message: "DA blob not found" },
  15: { kind: "celestia_unavailable", message: "Celestia data availability is not active" },
  16: { kind: "invalid_settlement_mode", message: "invalid settlement mode" },
  17: { kind: "invalid_sequencer_mode", message: "invalid sequencer mode" },
  18: { kind: "invalid_proof_system", message: "invalid proof system" },
  19: { kind: "based_sequencer_only", message: "based settlement requires a based sequencer" },
  20: { kind: "challenge_bond_required", message: "a challenge bond is required" },
  21: {
    kind: "verification_key_missing",
    message: "ZK verification key not configured for the rollup",
    hint: "register one with MsgSetVerificationKey (chain v3.2.7+) before the rollup's first batch",
  },
  22: { kind: "stark_not_supported", message: "STARK verification is not available for this rollup" },
  23: { kind: "proof_verify_failed", message: "ZK proof verification failed" },
  24: { kind: "no_open_challenge", message: "no open challenge for this batch" },
  25: { kind: "batch_not_challenged", message: "batch is not challenged" },
  26: {
    kind: "data_unavailable",
    message: "no DA blob matches the batch's data hash",
    hint: "post the data with MsgPostRollupData (chain v3.2.8+) and carry its SHA-256, or leave data_hash empty",
  },
  27: { kind: "batch_not_finalized", message: "withdrawals need a finalized batch" },
  28: { kind: "withdrawal_already_done", message: "withdrawal already executed" },
  29: {
    kind: "invalid_withdrawal_proof",
    message: "withdrawal proof does not match the batch's withdrawals root",
    hint: "build it with withdrawalsTree, using the batch's own binding (v2 from chain v3.2.5)",
  },
  30: { kind: "invalid_rollup_id", message: "invalid rollup id" },
  31: {
    kind: "anchor_refused",
    message: "the batch's signed state anchor was refused",
    hint: "only the rollup creator's registered post-quantum key can sign the anchor",
  },
  32: { kind: "insufficient_escrow", message: "the rollup's escrow does not cover the withdrawal" },
  33: { kind: "invalid_withdrawal", message: "malformed withdrawal message" },
  34: { kind: "params_update_disabled", message: "rdk parameter updates are not enabled at this height" },
  35: { kind: "invalid_params", message: "invalid rdk parameters" },
  36: {
    kind: "settlement_pending",
    message: "the rollup has a batch that is not settled yet",
    hint: "a rollup cannot be stopped, and cannot take more than 4096 waiting batches, while batches are unsettled",
  },
  37: { kind: "verification_key_disabled", message: "verification key registration is not enabled at this height" },
  38: { kind: "invalid_verification_key", message: "invalid ZK verification key" },
  39: {
    kind: "verification_key_locked",
    message: "the verification key can only be changed by governance after the first batch",
  },
  40: { kind: "batch_limit_reached", message: "the rollup reached max_batches_per_block in this block" },
  41: { kind: "rollup_data_disabled", message: "rollup data posting is not enabled at this height" },
  42: { kind: "rollup_data_too_large", message: "rollup data exceeds the per-message limit", hint: "see max_posted_data_bytes" },
  43: { kind: "rollup_data_block_full", message: "the rollup data limit for this block is reached", hint: "retry in a later block" },
  44: { kind: "based_sequencing_disabled", message: "based sequencing is not enabled at this height" },
  45: {
    kind: "based_sequencing_unsupported",
    message: "based sequencing is not available for this rollup",
    hint: "zk (snark), based settlement and qledger-v1 optimistic rollups only",
  },
  46: {
    kind: "invalid_inbox_range",
    message: "the batch does not match the rollup inbox",
    hint: "data_hash must be the inbox range commitment up to inbox_end; inbox_end must be 0 on a rollup that is not based",
  },
  47: { kind: "rollup_mode_disabled", message: "this rollup mode is not enabled at this height" },
  48: {
    kind: "invalid_rollup_mode",
    message: "invalid rollup execution or privacy mode",
    hint: "a new optimistic rollup needs execution_vm qledger-v1 and based sequencing; a private rollup must be zk with a Groth16 key",
  },
  49: { kind: "submitter_bond_required", message: "submitter bond required", hint: "bond at least min_submitter_bond first" },
  50: {
    kind: "submitter_bond_locked",
    message: "the submitter bond is still locked",
    hint: "a full challenge window must pass after the submitter's last batch",
  },
  51: { kind: "fraud_not_proven", message: "the fraud proof does not show the batch invalid" },
  52: {
    kind: "stark_statement_unsupported",
    message: "this STARK verification key proves no rollup statement",
    hint: "STARK settlement is paused; use a Groth16 (snark) key",
  },
  53: { kind: "invalid_envelope", message: "the post is not a valid envelope to the rollup's members" },
  54: { kind: "deposit_pool_not_empty", message: "the rollup still holds user deposits" },
};

/** {@link decodeTxError}, plus the `rdk` codespace. */
export function decodeRdkTxError(input: TxErrorInput): DecodedTxError & { hint?: string } {
  if (input.codespace === "rdk") {
    const info = RDK_ERRORS[input.code];
    if (info) {
      return {
        code: input.code,
        codespace: "rdk",
        kind: info.kind,
        message: info.hint ? `${info.message} (${info.hint})` : info.message,
        hint: info.hint,
        rawLog: input.rawLog,
      };
    }
  }
  return decodeTxError(input);
}
