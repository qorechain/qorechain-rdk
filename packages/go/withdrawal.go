package rdk

import (
	"errors"
	"fmt"
)

// Withdrawals exactly as the chain builds them, for MsgExecuteWithdrawal.
//
// A withdrawal is executed by proving its leaf is committed in a finalized
// batch's withdrawals_root. Use NewWithdrawalsTree: it builds the chain's own
// leaves and tree, so its root and proofs are what MsgExecuteWithdrawal
// verifies (tested against the chain's VerifyWithdrawalMerkle). The chain
// places each withdrawal at its index, hashes nodes as SHAKE-256(left ||
// right), and pairs an odd last node with itself. A batch submitted from chain
// v3.2.5 (rdk-withdrawals-binding) commits v2 leaves, which also name the
// chain id; check which with TransitionRootVersionForBatch.

// WithdrawalLeafInput is one L2 to L1 withdrawal as the chain hashes it.
type WithdrawalLeafInput struct {
	RollupID string
	// WithdrawalIndex is the withdrawal's position in its batch; also its leaf
	// position.
	WithdrawalIndex uint64
	Recipient       string
	Denom           string
	Amount          uint64
}

// WithdrawalLeafV1 is the chain's original withdrawal leaf (every batch before
// rdk-withdrawals-binding): SHAKE-256(rollup_id || 0x00 ||
// withdrawal_index(8B BE) || recipient || 0x00 || denom || 0x00 ||
// amount(8B BE)).
func WithdrawalLeafV1(w WithdrawalLeafInput) []byte {
	zero := []byte{0}
	return Qorehash(
		[]byte(w.RollupID),
		zero,
		u64Bytes(w.WithdrawalIndex),
		[]byte(w.Recipient),
		zero,
		[]byte(w.Denom),
		zero,
		u64Bytes(w.Amount),
	)
}

// WithdrawalLeafV2 is the v2 leaf of a batch bound under chain v3.2.5: the
// same fields, length-prefixed, behind a tag and the chain id, so a withdrawal
// committed for one network has no valid proof on another.
func WithdrawalLeafV2(chainID string, w WithdrawalLeafInput) ([]byte, error) {
	if chainID == "" {
		return nil, errors.New("a v2 withdrawal leaf names the chain id; pass it")
	}
	return Qorehash(
		lenPrefixed([]byte("qorechain-rdk-withdrawal/v2")),
		lenPrefixed([]byte(chainID)),
		lenPrefixed([]byte(w.RollupID)),
		u64Bytes(w.WithdrawalIndex),
		lenPrefixed([]byte(w.Recipient)),
		lenPrefixed([]byte(w.Denom)),
		u64Bytes(w.Amount),
	), nil
}

// chainTree is the chain's tree over already-hashed leaves.
func chainTree() *MerkleOptions {
	return &MerkleOptions{HashLeaves: boolPtr(false), DuplicateOdd: boolPtr(true)}
}

// Withdrawal is one entry of a batch's withdrawals; its position in the list
// is its withdrawal index.
type Withdrawal struct {
	Recipient string
	Denom     string
	Amount    uint64
}

// WithdrawalsTreeOptions configures NewWithdrawalsTree.
type WithdrawalsTreeOptions struct {
	RollupID string
	// Version is the binding the chain judges the batch by: "v2" (with
	// ChainID) for a batch submitted from chain v3.2.5's
	// rdk-withdrawals-binding, "v1" before.
	Version string
	// ChainID is required for "v2".
	ChainID string
}

// WithdrawalsTree is a batch's withdrawals, hashed and committed exactly as the
// chain does.
type WithdrawalsTree struct {
	// Root is the batch's withdrawals_root (32 bytes).
	Root []byte
	// Leaves are the leaves, in withdrawal-index order.
	Leaves [][]byte
}

// Proof is the proof for the withdrawal at withdrawalIndex.
func (t *WithdrawalsTree) Proof(withdrawalIndex int) (WithdrawalProof, error) {
	return AssembleWithdrawalProof(t.Leaves, withdrawalIndex, nil)
}

// NewWithdrawalsTree builds a batch's withdrawals tree. Withdrawal i of
// withdrawals is withdrawal index i. It errors on an empty list, an unknown
// version, or a v2 tree without a chain id.
func NewWithdrawalsTree(withdrawals []Withdrawal, opts WithdrawalsTreeOptions) (*WithdrawalsTree, error) {
	if len(withdrawals) == 0 {
		return nil, errors.New("a withdrawals tree needs at least one withdrawal")
	}
	if opts.Version != "v1" && opts.Version != "v2" {
		return nil, fmt.Errorf("unknown withdrawals tree version %q (want v1 or v2)", opts.Version)
	}
	leaves := make([][]byte, len(withdrawals))
	for i, w := range withdrawals {
		in := WithdrawalLeafInput{
			RollupID:        opts.RollupID,
			WithdrawalIndex: uint64(i),
			Recipient:       w.Recipient,
			Denom:           w.Denom,
			Amount:          w.Amount,
		}
		if opts.Version == "v2" {
			leaf, err := WithdrawalLeafV2(opts.ChainID, in)
			if err != nil {
				return nil, err
			}
			leaves[i] = leaf
		} else {
			leaves[i] = WithdrawalLeafV1(in)
		}
	}
	return &WithdrawalsTree{Root: BinaryMerkleRoot(leaves, chainTree()), Leaves: leaves}, nil
}
