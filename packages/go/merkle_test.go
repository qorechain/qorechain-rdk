package rdk

import (
	"crypto/sha256"
	"testing"
)

func leavesFromGolden(t *testing.T, hexes []string) [][]byte {
	t.Helper()
	out := make([][]byte, len(hexes))
	for i, h := range hexes {
		b, err := HexToBytes(h)
		if err != nil {
			t.Fatal(err)
		}
		out[i] = b
	}
	return out
}

func TestMerkleRootGolden(t *testing.T) {
	g := loadGolden(t)
	leaves := leavesFromGolden(t, g.Merkle.LeavesHex)
	root := BinaryMerkleRoot(leaves, nil)
	if BytesToHex(root) != g.Merkle.Root {
		t.Errorf("root: got %s want %s", BytesToHex(root), g.Merkle.Root)
	}
}

func checkSiblings(t *testing.T, got [][]byte, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("proof len: got %d want %d", len(got), len(want))
	}
	for i, sib := range got {
		if BytesToHex(sib) != want[i] {
			t.Errorf("sibling %d: got %s want %s", i, BytesToHex(sib), want[i])
		}
	}
}

// The generic helpers hash with SHAKE-256 by default.
func TestMerkleProofGolden(t *testing.T) {
	g := loadGolden(t)
	leaves := leavesFromGolden(t, g.Merkle.LeavesHex)
	p, err := BinaryMerkleProof(leaves, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if BytesToHex(p.Root) != g.Merkle.Root {
		t.Errorf("root: got %s want %s", BytesToHex(p.Root), g.Merkle.Root)
	}
	checkSiblings(t, p.Siblings, g.Merkle.ProofIndex1Siblings)
}

// SHA-256, the default before 0.7.0, is still available when passed explicitly.
func TestMerkleSha256Legacy(t *testing.T) {
	g := loadGolden(t)
	leaves := leavesFromGolden(t, g.Merkle.LeavesHex)
	sha := &MerkleOptions{Hash: func(b []byte) []byte { s := sha256.Sum256(b); return s[:] }}
	if root := BinaryMerkleRoot(leaves, sha); BytesToHex(root) != g.Merkle.Sha256Legacy.Root {
		t.Errorf("root: got %s want %s", BytesToHex(root), g.Merkle.Sha256Legacy.Root)
	}
	p, err := BinaryMerkleProof(leaves, 1, sha)
	if err != nil {
		t.Fatal(err)
	}
	checkSiblings(t, p.Siblings, g.Merkle.Sha256Legacy.ProofIndex1Siblings)
}

// AssembleWithdrawalProof defaults to the chain's tree, which does not re-hash
// leaves: verify the same way.
func TestAssembleWithdrawalProofDefaultsToTheChainTree(t *testing.T) {
	leaves := [][]byte{Qorehash([]byte{1}), Qorehash([]byte{2}), Qorehash([]byte{3})}
	w, err := AssembleWithdrawalProof(leaves, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if w.WithdrawalIndex != 1 {
		t.Errorf("withdrawal index = %d", w.WithdrawalIndex)
	}
	if !VerifyBinaryMerkleProof(leaves[1], 1, w.Proof, w.WithdrawalsRoot, &MerkleOptions{HashLeaves: boolPtr(false)}) {
		t.Error("proof does not verify over the un-hashed leaves")
	}
	if BytesToHex(w.WithdrawalsRoot) != BytesToHex(BinaryMerkleRoot(leaves, chainTree())) {
		t.Error("root is not the chain tree's root")
	}
}

func TestMerkleVerify(t *testing.T) {
	g := loadGolden(t)
	leaves := leavesFromGolden(t, g.Merkle.LeavesHex)
	for idx := range leaves {
		proof, err := BinaryMerkleProof(leaves, idx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if !VerifyBinaryMerkleProof(leaves[idx], idx, proof.Siblings, proof.Root, nil) {
			t.Errorf("proof for leaf %d failed to verify", idx)
		}
	}
	// tampered leaf must fail
	proof, _ := BinaryMerkleProof(leaves, 0, nil)
	if VerifyBinaryMerkleProof([]byte{0xff}, 0, proof.Siblings, proof.Root, nil) {
		t.Error("tampered leaf verified")
	}
}
