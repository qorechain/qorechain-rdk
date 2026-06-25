package rdk

import "testing"

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

func TestMerkleProofGolden(t *testing.T) {
	g := loadGolden(t)
	leaves := leavesFromGolden(t, g.Merkle.LeavesHex)
	wp, err := AssembleWithdrawalProof(leaves, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if BytesToHex(wp.WithdrawalsRoot) != g.Merkle.Root {
		t.Errorf("withdrawalsRoot: got %s want %s", BytesToHex(wp.WithdrawalsRoot), g.Merkle.Root)
	}
	if len(wp.Proof) != len(g.Merkle.ProofIndex1Siblings) {
		t.Fatalf("proof len: got %d want %d", len(wp.Proof), len(g.Merkle.ProofIndex1Siblings))
	}
	for i, sib := range wp.Proof {
		if BytesToHex(sib) != g.Merkle.ProofIndex1Siblings[i] {
			t.Errorf("sibling %d: got %s want %s", i, BytesToHex(sib), g.Merkle.ProofIndex1Siblings[i])
		}
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
