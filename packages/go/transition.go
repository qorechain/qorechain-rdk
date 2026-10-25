package rdk

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"

	pqc "github.com/qorechain/qorechain-pqc/go"
)

// The canonical batch transition root: the state root a protocol-following
// sequencer publishes for a settlement batch.
//
// The chain judges an optimistic batch by it. A fraud challenge is upheld when
// the batch's published state_root differs from this root and the challenger
// names this root (see FraudProof); from chain v3.2.5 any account may resolve
// that challenge, and an upheld one is paid from the rollup's escrow. A batch
// that publishes anything else, such as a placeholder, is provably fraudulent.
// The test vectors come from the chain's own BatchTransitionRoot.

const (
	// FeatureRDKWithdrawalsBinding switches batches to the v2 binding.
	FeatureRDKWithdrawalsBinding = "rdk-withdrawals-binding"
	// WithdrawalsBindingUpgrade is the chain upgrade that turns it on.
	WithdrawalsBindingUpgrade = "v3.2.5"
)

// TransitionInput is what the transition binding covers. ChainID, RollupID and
// WithdrawalsRoot are used by v2 only.
type TransitionInput struct {
	ChainID         string
	RollupID        string
	PrevStateRoot   []byte
	DataHash        []byte
	TxCount         uint64
	WithdrawalsRoot []byte
}

func shake32(parts ...[]byte) []byte {
	var all []byte
	for _, p := range parts {
		all = append(all, p...)
	}
	return pqc.Shake256(all, 32)
}

func u64Bytes(n uint64) []byte {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], n)
	return b[:]
}

func lenPrefixed(b []byte) []byte {
	var l [4]byte
	binary.BigEndian.PutUint32(l[:], uint32(len(b)))
	return append(l[:], b...)
}

// BatchTransitionRootV1 is the original binding, used for every batch before
// the chain's rdk-withdrawals-binding switch:
// SHAKE-256(prev_state_root || data_hash || tx_count(8B BE)), 32 bytes.
func BatchTransitionRootV1(in TransitionInput) []byte {
	return shake32(in.PrevStateRoot, in.DataHash, u64Bytes(in.TxCount))
}

// BatchTransitionRootV2 is the v2 binding (chain v3.2.5,
// rdk-withdrawals-binding), which also covers the chain id, the rollup id and
// the withdrawals root. Every variable-length field carries a 4-byte
// big-endian length prefix.
func BatchTransitionRootV2(in TransitionInput) ([]byte, error) {
	if in.ChainID == "" || in.RollupID == "" {
		return nil, errors.New("the v2 transition root covers the chain id and the rollup id; pass both")
	}
	if n := len(in.WithdrawalsRoot); n != 0 && n != 32 {
		return nil, fmt.Errorf("withdrawals root must be empty or 32 bytes, got %d", n)
	}
	return shake32(
		lenPrefixed([]byte("qorechain-rdk-transition/v2")),
		lenPrefixed([]byte(in.ChainID)),
		lenPrefixed([]byte(in.RollupID)),
		lenPrefixed(in.PrevStateRoot),
		lenPrefixed(in.DataHash),
		u64Bytes(in.TxCount),
		lenPrefixed(in.WithdrawalsRoot),
	), nil
}

// BatchTransitionRoot is the transition root under version ("v1" or "v2").
func BatchTransitionRoot(in TransitionInput, version string) ([]byte, error) {
	switch version {
	case "v1":
		return BatchTransitionRootV1(in), nil
	case "v2":
		return BatchTransitionRootV2(in)
	}
	return nil, fmt.Errorf("unknown transition root version %q", version)
}

// TransitionRootVersionFor says which binding a batch submitted now is judged
// by: "v2" once the chain reports rdk-withdrawals-binding enabled, "v1" before.
// A batch keeps the binding it was submitted under, so compute the root right
// before submitting.
func TransitionRootVersionFor(ctx context.Context, rest *RestClient) (string, error) {
	on, err := rest.IsProtocolFeatureEnabled(ctx, FeatureRDKWithdrawalsBinding)
	if err != nil {
		return "", err
	}
	if on {
		return "v2", nil
	}
	return "v1", nil
}

// TransitionRootVersionForBatch says which binding the chain judges an
// existing batch by. The chain decides once, at submission: a batch is bound to
// v2 exactly when it was included at or above the height where
// WithdrawalsBindingUpgrade was applied (the upgrade block itself included).
// The batch's own WithdrawalsBound is used when the node serves it. Challenge
// only with the root under this version: a fraud proof built on the other
// binding is dismissed and its bond forfeited.
func TransitionRootVersionForBatch(ctx context.Context, rest *RestClient, batch BatchView) (string, error) {
	if batch.WithdrawalsBound {
		return "v2", nil
	}
	applied, err := rest.GetAppliedPlanHeight(ctx, WithdrawalsBindingUpgrade)
	if err != nil {
		return "", err
	}
	if applied > 0 && int64(batch.SubmittedAt) >= applied {
		return "v2", nil
	}
	return "v1", nil
}

// FraudProof is the proof the chain's optimistic verifier reads:
// prev_state_root(32) || correct_state_root(32).
func FraudProof(prevStateRoot, correctStateRoot []byte) ([]byte, error) {
	if len(prevStateRoot) != 32 || len(correctStateRoot) != 32 {
		return nil, errors.New("a fraud proof needs a 32-byte previous root and a 32-byte correct root")
	}
	return append(append([]byte{}, prevStateRoot...), correctStateRoot...), nil
}
