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
    hint: "no chain release up to v3.2.5 can register a verification key, so zk settlement cannot be used yet",
  },
  22: { kind: "stark_not_supported", message: "STARK verification is not available for this rollup" },
  23: { kind: "proof_verify_failed", message: "ZK proof verification failed" },
  24: { kind: "no_open_challenge", message: "no open challenge for this batch" },
  25: { kind: "batch_not_challenged", message: "batch is not challenged" },
  26: {
    kind: "data_unavailable",
    message: "no DA blob matches the batch's data hash",
    hint: "leave dataHash empty on native or both data availability: no transaction posts a blob",
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
