package rdk

import "fmt"

// Client-side copies of rules the chain enforces, so a transaction the chain
// would refuse is caught before a fee is paid. The chain checks both in the
// keeper rather than in ValidateBasic (tightening ValidateBasic would
// retroactively refuse what historical blocks accepted), so it can only tell you
// after you have paid. These mirror them exactly; where they disagree, the
// chain wins and this file is the bug.

const (
	// IDMinLength and IDMaxLength bound a new rollup/layer id, in bytes.
	IDMinLength = 3
	IDMaxLength = 64
	// RollupEscrowDenom is the only denomination a rollup's escrow ledger can
	// pay a withdrawal in.
	RollupEscrowDenom = "uqor"
	// MaxWithdrawalProofDepth bounds a withdrawal's Merkle path: a batch commits
	// at most 2^64 withdrawals, so a longer path can never verify.
	MaxWithdrawalProofDepth = 64
)

// RollupIDError reports why id breaks the chain's id grammar, or "" if it does
// not.
//
// From chain v3.2.2 a new rollup or layer id must match
// ^[a-z0-9][a-z0-9._-]{2,63}$, measured in bytes. Ids are store-key components
// joined with '/', so an id containing '/' (or sorting as another id's
// extension) let one layer's anchors, batches or blobs be read as another's.
// Ids created before v3.2.2 stay valid; this is for choosing a new one. It is
// the chain's IDGrammarError, byte for byte.
func RollupIDError(id string) string {
	if len(id) < IDMinLength || len(id) > IDMaxLength {
		return fmt.Sprintf("must be %d to %d characters", IDMinLength, IDMaxLength)
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		case (c == '.' || c == '_' || c == '-') && i > 0:
		default:
			if i == 0 {
				return "must start with a lowercase letter or a digit"
			}
			return "may contain only lowercase letters, digits, '.', '_' and '-'"
		}
	}
	return ""
}

// IsValidRollupID reports whether id is a valid new rollup/layer id.
func IsValidRollupID(id string) bool { return RollupIDError(id) == "" }

// WithdrawalErrors lists every reason the chain would refuse this withdrawal at
// the start of ExecuteWithdrawal (chain v3.2.3+, rdk-escrow-ledger), or nil.
// It mirrors MsgExecuteWithdrawal.ValidateWithdrawal.
func WithdrawalErrors(m MsgExecuteWithdrawal) []string {
	var errs []string
	if _, _, err := bech32Decode(m.Submitter); err != nil {
		errs = append(errs, fmt.Sprintf("invalid submitter address %q", m.Submitter))
	}
	// Only emptiness: ids from before v3.2.2 may sit outside the grammar.
	if m.RollupID == "" {
		errs = append(errs, "rollup_id cannot be empty")
	}
	if _, _, err := bech32Decode(m.Recipient); err != nil {
		errs = append(errs, fmt.Sprintf("invalid recipient address %q", m.Recipient))
	}
	if m.Denom != RollupEscrowDenom {
		errs = append(errs, fmt.Sprintf("denom %q: rollup escrow is held in %s only", m.Denom, RollupEscrowDenom))
	}
	if m.Amount <= 0 {
		errs = append(errs, "amount must be positive")
	}
	if len(m.Proof) > MaxWithdrawalProofDepth {
		errs = append(errs, fmt.Sprintf("proof has %d levels, at most %d", len(m.Proof), MaxWithdrawalProofDepth))
	}
	for i, sib := range m.Proof {
		if len(sib) != 32 {
			errs = append(errs, fmt.Sprintf("proof level %d is %d bytes, want 32", i, len(sib)))
		}
	}
	return errs
}

// preflightMessages refuses, before anything is signed, a message the chain is
// known to refuse only after the fee is paid.
func preflightMessages(messages []Msg) error {
	for _, m := range messages {
		switch v := m.(type) {
		case MsgCreateRollup:
			if e := RollupIDError(v.RollupID); e != "" {
				return &RollupConfigError{Errors: []string{fmt.Sprintf("rollupId %q %s", v.RollupID, e)}}
			}
		case MsgExecuteWithdrawal:
			if errs := WithdrawalErrors(v); len(errs) > 0 {
				return &RollupConfigError{Errors: append([]string{"withdrawal would be refused by the chain"}, errs...)}
			}
		}
	}
	return nil
}

// DataHashError says why a batch with dataHash would be refused for a rollup on
// daBackend, or returns "" if the chain accepts it.
//
// On a "native" or "both" rollup the chain accepts a non-empty data_hash only
// when a matching blob is stored on chain, and no transaction stores one: the
// batch is refused as data unavailable. Leave it empty there; the batch's state
// roots and proof still bind it. ("celestia" is not checked by the chain, and
// is not active on the network.)
func DataHashError(daBackend string, dataHash []byte) string {
	if len(dataHash) == 0 || (daBackend != "native" && daBackend != "both") {
		return ""
	}
	return "data_hash must be empty on a rollup with " + daBackend + " data availability: no transaction " +
		"stores a data-availability blob on chain, so the chain refuses a batch that claims one"
}
