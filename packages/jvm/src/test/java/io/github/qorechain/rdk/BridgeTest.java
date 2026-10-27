package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.bridge.Merkle;
import io.github.qorechain.rdk.bridge.Withdrawal;
import io.github.qorechain.rdk.bridge.Withdrawal.WithdrawalProof;
import io.github.qorechain.rdk.util.Bytes;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class BridgeTest {

    private static List<byte[]> leaves(Golden g) {
        List<byte[]> out = new ArrayList<>();
        for (String hex : g.merkle.leavesHex) {
            out.add(Bytes.hexToBytes(hex));
        }
        return out;
    }

    @Test
    void merkleRootMatchesGolden() {
        Golden g = Golden.load();
        byte[] root = Merkle.binaryMerkleRoot(leaves(g), null);
        assertEquals(g.merkle.root, Bytes.bytesToHex(root));
    }

    @Test
    void sha256StillAvailableExplicitly() {
        // The pre-0.7.0 default, kept for rebuilding a tree made by an earlier release.
        Golden g = Golden.load();
        Merkle.MerkleOptions o = new Merkle.MerkleOptions();
        o.hash = Merkle::sha256;
        assertEquals(g.merkle.sha256Legacy.root, Bytes.bytesToHex(Merkle.binaryMerkleRoot(leaves(g), o)));
        List<String> siblings = new ArrayList<>();
        for (byte[] s : Merkle.binaryMerkleProof(leaves(g), 1, o).siblings) {
            siblings.add(Bytes.bytesToHex(s));
        }
        assertEquals(g.merkle.sha256Legacy.proofIndex1Siblings, siblings);
    }

    @Test
    void withdrawalProofMatchesGolden() {
        Golden g = Golden.load();
        // The golden merkle vector hashes each leaf (the generic defaults), so ask for them; the
        // withdrawal default is the chain's tree, which does not.
        WithdrawalProof proof =
                Withdrawal.assembleWithdrawalProof(leaves(g), 1, new Merkle.MerkleOptions());
        assertEquals(g.merkle.root, Bytes.bytesToHex(proof.withdrawalsRoot));

        List<String> siblings = new ArrayList<>();
        for (byte[] s : proof.proof) {
            siblings.add(Bytes.bytesToHex(s));
        }
        assertEquals(g.merkle.proofIndex1Siblings, siblings);
    }

    @Test
    void assembledProofVerifies() {
        Golden g = Golden.load();
        List<byte[]> ls = leaves(g);
        WithdrawalProof proof = Withdrawal.assembleWithdrawalProof(ls, 1);
        // The chain's tree does not re-hash leaves: verify the same way.
        Merkle.MerkleOptions chain = new Merkle.MerkleOptions();
        chain.hashLeaves = false;
        assertTrue(
                Merkle.verifyBinaryMerkleProof(
                        ls.get(1), 1, proof.proof, proof.withdrawalsRoot, chain));
    }
}
