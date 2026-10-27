package rdk

import (
	"bytes"
	"fmt"
)

// Generic binary Merkle tree utilities for assembling withdrawal proofs.
//
// An rdk settlement batch commits its L2 to L1 messages (withdrawals) as a
// binary Merkle root (withdrawals_root), and MsgExecuteWithdrawal carries the
// sibling hashes from a leaf to that root. These helpers build the root and a
// leaf's proof.
//
// The hash defaults to the chain's: SHAKE-256 with a 32-byte output. For a
// batch's withdrawals use NewWithdrawalsTree, which also builds the chain's
// leaves and places each at its withdrawal index; these generic helpers hash
// each input leaf by default, which the chain does not. Releases before 0.7.0
// defaulted to SHA-256, which no chain construction uses.

// MerkleOptions configures binary Merkle tree construction. A nil
// *MerkleOptions, or a nil field, takes the default.
type MerkleOptions struct {
	// Hash is the hash function for internal nodes (and leaves when HashLeaves).
	// Nil means SHAKE-256 (32 bytes), see Qorehash.
	Hash func(data []byte) []byte
	// HashLeaves, when set, says whether to hash each input leaf before
	// building the tree. Default true.
	HashLeaves *bool
	// DuplicateOdd, when set, says whether to duplicate the last node on an odd
	// level. Default true.
	DuplicateOdd *bool
}

func boolPtr(b bool) *bool { return &b }

func qorehashOne(data []byte) []byte { return Qorehash(data) }

type resolvedMerkleOptions struct {
	hash         func([]byte) []byte
	hashLeaves   bool
	duplicateOdd bool
}

func resolveMerkleOptions(opts *MerkleOptions) resolvedMerkleOptions {
	r := resolvedMerkleOptions{hash: qorehashOne, hashLeaves: true, duplicateOdd: true}
	if opts == nil {
		return r
	}
	if opts.Hash != nil {
		r.hash = opts.Hash
	}
	if opts.HashLeaves != nil {
		r.hashLeaves = *opts.HashLeaves
	}
	if opts.DuplicateOdd != nil {
		r.duplicateOdd = *opts.DuplicateOdd
	}
	return r
}

func leafNodes(leaves [][]byte, opts resolvedMerkleOptions) [][]byte {
	out := make([][]byte, len(leaves))
	for i, l := range leaves {
		if opts.hashLeaves {
			out[i] = opts.hash(l)
		} else {
			out[i] = append([]byte(nil), l...)
		}
	}
	return out
}

func concatBytes(a, b []byte) []byte {
	out := make([]byte, 0, len(a)+len(b))
	out = append(out, a...)
	out = append(out, b...)
	return out
}

// BinaryMerkleRoot computes the binary Merkle root of a list of leaves.
func BinaryMerkleRoot(leaves [][]byte, opts *MerkleOptions) []byte {
	o := resolveMerkleOptions(opts)
	if len(leaves) == 0 {
		return o.hash([]byte{})
	}
	level := leafNodes(leaves, o)
	for len(level) > 1 {
		next := make([][]byte, 0, (len(level)+1)/2)
		for i := 0; i < len(level); i += 2 {
			left := level[i]
			if i+1 < len(level) {
				next = append(next, o.hash(concatBytes(left, level[i+1])))
			} else if o.duplicateOdd {
				next = append(next, o.hash(concatBytes(left, left)))
			} else {
				next = append(next, left)
			}
		}
		level = next
	}
	return level[0]
}

// MerkleProof is a leaf's Merkle proof: the sibling hashes from the leaf up to
// the root.
type MerkleProof struct {
	// Siblings are the sibling hashes, leaf level first.
	Siblings [][]byte
	// Root is the computed root.
	Root []byte
	// Index is the leaf index the proof is for.
	Index int
}

// BinaryMerkleProof builds the Merkle proof (sibling path) for the leaf at index.
func BinaryMerkleProof(leaves [][]byte, index int, opts *MerkleOptions) (MerkleProof, error) {
	if index < 0 || index >= len(leaves) {
		return MerkleProof{}, fmt.Errorf("leaf index %d out of range (0..%d)", index, len(leaves)-1)
	}
	o := resolveMerkleOptions(opts)
	siblings := [][]byte{}
	level := leafNodes(leaves, o)
	idx := index
	for len(level) > 1 {
		isRight := idx%2 == 1
		siblingIdx := idx + 1
		if isRight {
			siblingIdx = idx - 1
		}
		if siblingIdx < len(level) {
			siblings = append(siblings, level[siblingIdx])
		} else if o.duplicateOdd {
			siblings = append(siblings, level[idx])
		}
		next := make([][]byte, 0, (len(level)+1)/2)
		for i := 0; i < len(level); i += 2 {
			left := level[i]
			if i+1 < len(level) {
				next = append(next, o.hash(concatBytes(left, level[i+1])))
			} else if o.duplicateOdd {
				next = append(next, o.hash(concatBytes(left, left)))
			} else {
				next = append(next, left)
			}
		}
		level = next
		idx /= 2
	}
	return MerkleProof{Siblings: siblings, Root: level[0], Index: index}, nil
}

// VerifyBinaryMerkleProof verifies a leaf against a Merkle root using a sibling
// path.
func VerifyBinaryMerkleProof(leaf []byte, index int, siblings [][]byte, root []byte, opts *MerkleOptions) bool {
	o := resolveMerkleOptions(opts)
	node := leaf
	if o.hashLeaves {
		node = o.hash(leaf)
	}
	idx := index
	for _, sibling := range siblings {
		if idx%2 == 1 {
			node = o.hash(concatBytes(sibling, node))
		} else {
			node = o.hash(concatBytes(node, sibling))
		}
		idx /= 2
	}
	return bytes.Equal(node, root)
}

// WithdrawalProof is the proof material for a single withdrawal.
type WithdrawalProof struct {
	// Proof are the sibling hashes from the leaf to withdrawals_root, for the
	// proof field of MsgExecuteWithdrawal.
	Proof [][]byte
	// WithdrawalsRoot is the computed withdrawals_root (compare against the
	// batch's).
	WithdrawalsRoot []byte
	// WithdrawalIndex is the withdrawal's index within the batch.
	WithdrawalIndex int
}

// AssembleWithdrawalProof assembles the Merkle proof for the withdrawal at
// withdrawalIndex from the full list of the batch's withdrawal leaves (from
// WithdrawalLeafV1 / WithdrawalLeafV2). Nil opts is the chain's tree: leaves
// are not re-hashed, nodes are SHAKE-256(left || right) and an odd last node is
// paired with itself. Before 0.7.0 nil opts re-hashed each leaf with SHA-256,
// which the chain does not do.
func AssembleWithdrawalProof(leaves [][]byte, withdrawalIndex int, opts *MerkleOptions) (WithdrawalProof, error) {
	if opts == nil {
		opts = chainTree()
	}
	proof, err := BinaryMerkleProof(leaves, withdrawalIndex, opts)
	if err != nil {
		return WithdrawalProof{}, err
	}
	return WithdrawalProof{
		Proof:           proof.Siblings,
		WithdrawalsRoot: proof.Root,
		WithdrawalIndex: withdrawalIndex,
	}, nil
}

// BuildExecuteWithdrawalInput combines a withdrawal's recipient/amount details
// with an assembled proof into an ExecuteWithdrawalInput for the tx client.
func BuildExecuteWithdrawalInput(submitter, rollupID string, batchIndex uint64, recipient, denom string, amount uint64, w WithdrawalProof) ExecuteWithdrawalInput {
	return ExecuteWithdrawalInput{
		Submitter:       submitter,
		RollupID:        rollupID,
		BatchIndex:      batchIndex,
		WithdrawalIndex: uint64(w.WithdrawalIndex),
		Recipient:       recipient,
		Denom:           denom,
		Amount:          int64(amount),
		Proof:           w.Proof,
	}
}
