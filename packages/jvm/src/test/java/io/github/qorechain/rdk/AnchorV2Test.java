package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.receipts.Receipts;
import io.github.qorechain.rdk.receipts.Receipts.AnchorSignBytesVersion;
import io.github.qorechain.rdk.receipts.Receipts.ReceiptVerification;
import io.github.qorechain.rdk.receipts.Receipts.SettlementReceipt;
import io.github.qorechain.rdk.util.Bytes;
import org.junit.jupiter.api.Test;

/** The v2 anchor message (chain v3.2.2+), checked against the chain-generated vector. */
class AnchorV2Test {

    @Test
    void v2MatchesTheChainGeneratedVector() {
        Golden.AnchorV2Section v = Golden.load().anchorSignBytes.v2;
        byte[] bytes =
                Receipts.anchorSignBytesV2(
                        v.chainId,
                        v.layerId,
                        v.layerHeight,
                        v.stateRoot,
                        v.validatorSetHash,
                        v.transactionCount,
                        v.compressedStateProof);
        assertEquals(v.expectedHex, Bytes.bytesToHex(bytes));
    }

    @Test
    void v1StillMatchesForAnchorsBeforeTheSwitch() {
        Golden.AnchorSignBytesSection a = Golden.load().anchorSignBytes;
        byte[] bytes =
                Receipts.anchorSignBytesV1(a.layerId, a.layerHeight, a.stateRoot, a.validatorSetHash);
        assertEquals(a.expectedHexV1, Bytes.bytesToHex(bytes));
    }

    @Test
    void v2BindsTheChainId() {
        // The weakness v2 closes: v1 has no chain id, so the same anchor signs identically on
        // every network.
        Golden.AnchorSignBytesSection a = Golden.load().anchorSignBytes;
        String diana =
                Bytes.bytesToHex(
                        Receipts.anchorSignBytesV2(
                                "qorechain-diana", a.layerId, a.layerHeight, a.stateRoot,
                                a.validatorSetHash, 7, ""));
        String vladi =
                Bytes.bytesToHex(
                        Receipts.anchorSignBytesV2(
                                "qorechain-vladi", a.layerId, a.layerHeight, a.stateRoot,
                                a.validatorSetHash, 7, ""));
        assertNotEquals(diana, vladi);
    }

    @Test
    void formIsSelectedByHeight() {
        assertEquals(AnchorSignBytesVersion.V1, Receipts.anchorSignBytesVersionFor(6_905_033, 6_905_034));
        assertEquals(AnchorSignBytesVersion.V2, Receipts.anchorSignBytesVersionFor(6_905_034, 6_905_034));
        assertEquals(AnchorSignBytesVersion.V2, Receipts.anchorSignBytesVersionFor(9_000_000, 6_905_034));
        // A fresh chain enables the feature at genesis.
        assertEquals(AnchorSignBytesVersion.V2, Receipts.anchorSignBytesVersionFor(1, 0));
    }

    @Test
    void bareRestClientWithoutANetworkIsRefusedRatherThanGuessed() {
        // A RestClient does not know its chain; guessing the chain id is exactly what v2 exists
        // to stop, so the verifier must refuse.
        SettlementReceipt r = new SettlementReceipt();
        r.rollupId = "roll-1";
        ReceiptVerification v =
                Receipts.verifySettlementReceipt(
                        r, new Receipts.VerifyReceiptOptions().rest(new RestClient("http://unused", new io.github.qorechain.rdk.client.HttpTransport())));
        assertFalse(v.valid);
        assertTrue(v.reason.contains("network is unknown"), v.reason);
    }
}
