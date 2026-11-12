package rdk

import sdktx "github.com/qorechain/qorechain-sdk/packages/go/qorechain/tx"

// Readable decoding of a transaction the rdk module refused. The QoreChain
// SDK's DecodeTxError names the sdk codespace's codes; this adds the rdk
// module's own, as the chain registers them, with what to do about the ones a
// rollup operator meets.

// RdkErrorInfo is one rdk codespace error: a stable kind, its message, and a
// hint where there is one.
type RdkErrorInfo struct {
	Kind    string
	Message string
	Hint    string
}

// RdkErrors is the rdk codespace, code by code.
var RdkErrors = map[uint32]RdkErrorInfo{
	2:  {Kind: "rollup_not_found", Message: "rollup not found"},
	3:  {Kind: "rollup_already_exists", Message: "rollup already exists"},
	4:  {Kind: "rollup_not_active", Message: "rollup not active"},
	5:  {Kind: "max_rollups_reached", Message: "maximum rollups reached", Hint: "every max_rollups slot is taken"},
	6:  {Kind: "insufficient_stake", Message: "insufficient stake amount", Hint: "stake at least min_stake_for_rollup"},
	7:  {Kind: "unauthorized", Message: "only the rollup creator can do this"},
	8:  {Kind: "batch_not_found", Message: "batch not found"},
	9:  {Kind: "batch_exists", Message: "a batch with this index already exists"},
	10: {Kind: "challenge_window_closed", Message: "challenge window closed or not applicable", Hint: "a batch can be challenged only while its own window is open"},
	11: {Kind: "invalid_proof", Message: "invalid proof"},
	12: {Kind: "proof_required", Message: "proof required for this settlement mode"},
	13: {Kind: "da_blob_too_large", Message: "DA blob exceeds the maximum size"},
	14: {Kind: "da_blob_not_found", Message: "DA blob not found"},
	15: {Kind: "celestia_unavailable", Message: "Celestia data availability is not active"},
	16: {Kind: "invalid_settlement_mode", Message: "invalid settlement mode"},
	17: {Kind: "invalid_sequencer_mode", Message: "invalid sequencer mode"},
	18: {Kind: "invalid_proof_system", Message: "invalid proof system"},
	19: {Kind: "based_sequencer_only", Message: "based settlement requires a based sequencer"},
	20: {Kind: "challenge_bond_required", Message: "a challenge bond is required"},
	21: {Kind: "verification_key_missing", Message: "ZK verification key not configured for the rollup", Hint: "register one with MsgSetVerificationKey (chain v3.2.7+) before the rollup's first batch"},
	22: {Kind: "stark_not_supported", Message: "STARK verification is not available for this rollup"},
	23: {Kind: "proof_verify_failed", Message: "ZK proof verification failed"},
	24: {Kind: "no_open_challenge", Message: "no open challenge for this batch"},
	25: {Kind: "batch_not_challenged", Message: "batch is not challenged"},
	26: {Kind: "data_unavailable", Message: "no DA blob matches the batch's data hash", Hint: "post the data with MsgPostRollupData (chain v3.2.8+) and carry its SHA-256, or leave data_hash empty"},
	27: {Kind: "batch_not_finalized", Message: "withdrawals need a finalized batch"},
	28: {Kind: "withdrawal_already_done", Message: "withdrawal already executed"},
	29: {Kind: "invalid_withdrawal_proof", Message: "withdrawal proof does not match the batch's withdrawals root", Hint: "build it with NewWithdrawalsTree, using the batch's own binding (v2 from chain v3.2.5)"},
	30: {Kind: "invalid_rollup_id", Message: "invalid rollup id"},
	31: {Kind: "anchor_refused", Message: "the batch's signed state anchor was refused", Hint: "only the rollup creator's registered post-quantum key can sign the anchor"},
	32: {Kind: "insufficient_escrow", Message: "the rollup's escrow does not cover the withdrawal"},
	33: {Kind: "invalid_withdrawal", Message: "malformed withdrawal message"},
	34: {Kind: "params_update_disabled", Message: "rdk parameter updates are not enabled at this height"},
	35: {Kind: "invalid_params", Message: "invalid rdk parameters"},
	36: {Kind: "settlement_pending", Message: "the rollup has a batch that is not settled yet", Hint: "a rollup cannot be stopped, and cannot take more than 4096 waiting batches, while batches are unsettled"},
	37: {Kind: "verification_key_disabled", Message: "verification key registration is not enabled at this height"},
	38: {Kind: "invalid_verification_key", Message: "invalid ZK verification key"},
	39: {Kind: "verification_key_locked", Message: "the verification key can only be changed by governance after the first batch"},
	40: {Kind: "batch_limit_reached", Message: "the rollup reached max_batches_per_block in this block"},
	41: {Kind: "rollup_data_disabled", Message: "rollup data posting is not enabled at this height"},
	42: {Kind: "rollup_data_too_large", Message: "rollup data exceeds the per-message limit", Hint: "see max_posted_data_bytes"},
	43: {Kind: "rollup_data_block_full", Message: "the rollup data limit for this block is reached", Hint: "retry in a later block"},
	44: {Kind: "based_sequencing_disabled", Message: "based sequencing is not enabled at this height"},
	45: {Kind: "based_sequencing_unsupported", Message: "based sequencing is not available for this rollup", Hint: "zk (snark), based settlement and qledger-v1 optimistic rollups only"},
	46: {Kind: "invalid_inbox_range", Message: "the batch does not match the rollup inbox", Hint: "data_hash must be the inbox range commitment up to inbox_end; inbox_end must be 0 on a rollup that is not based"},
	47: {Kind: "rollup_mode_disabled", Message: "this rollup mode is not enabled at this height"},
	48: {Kind: "invalid_rollup_mode", Message: "invalid rollup execution or privacy mode", Hint: "a new optimistic rollup needs execution_vm qledger-v1 and based sequencing; a private rollup must be zk with a Groth16 key"},
	49: {Kind: "submitter_bond_required", Message: "submitter bond required", Hint: "bond at least min_submitter_bond first"},
	50: {Kind: "submitter_bond_locked", Message: "the submitter bond is still locked", Hint: "a full challenge window must pass after the submitter's last batch"},
	51: {Kind: "fraud_not_proven", Message: "the fraud proof does not show the batch invalid"},
	52: {Kind: "stark_statement_unsupported", Message: "this STARK verification key proves no rollup statement", Hint: "STARK settlement is paused; use a Groth16 (snark) key"},
	53: {Kind: "invalid_envelope", Message: "the post is not a valid envelope to the rollup's members"},
	54: {Kind: "deposit_pool_not_empty", Message: "the rollup still holds user deposits"},
}

// DecodedRdkTxError is a refused transaction, named.
type DecodedRdkTxError struct {
	Code      uint32
	Codespace string
	// Kind is the stable name of an rdk refusal (e.g. "invalid_rollup_mode");
	// empty outside the rdk codespace or for an unknown code.
	Kind string
	// Message is the readable reason, with the hint appended when there is one.
	Message string
	Hint    string
	RawLog  string
}

func (e *DecodedRdkTxError) Error() string {
	cs := e.Codespace
	if cs == "" {
		cs = "sdk"
	}
	msg := "tx failed: " + cs + ": " + e.Message
	if e.RawLog != "" {
		msg += ": " + e.RawLog
	}
	return msg
}

// DecodeRdkTxError names a refusal by (code, codespace, rawLog): the rdk
// codespace from RdkErrors, anything else through the SDK's DecodeTxError. A
// zero code is success and returns nil.
func DecodeRdkTxError(code uint32, codespace, rawLog string) *DecodedRdkTxError {
	if code == 0 {
		return nil
	}
	if codespace == "rdk" {
		if info, ok := RdkErrors[code]; ok {
			msg := info.Message
			if info.Hint != "" {
				msg += " (" + info.Hint + ")"
			}
			return &DecodedRdkTxError{Code: code, Codespace: "rdk", Kind: info.Kind, Message: msg, Hint: info.Hint, RawLog: rawLog}
		}
	}
	base := sdktx.DecodeTxError(code, codespace, rawLog)
	return &DecodedRdkTxError{Code: code, Codespace: codespace, Message: base.Reason, RawLog: rawLog}
}
