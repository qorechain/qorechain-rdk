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
    void withdrawalProofMatchesGolden() {
        Golden g = Golden.load();
        WithdrawalProof proof = Withdrawal.assembleWithdrawalProof(leaves(g), 1, null);
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
        WithdrawalProof proof = Withdrawal.assembleWithdrawalProof(ls, 1, null);
        assertTrue(
                Merkle.verifyBinaryMerkleProof(
                        ls.get(1), 1, proof.proof, proof.withdrawalsRoot, null));
    }
}
