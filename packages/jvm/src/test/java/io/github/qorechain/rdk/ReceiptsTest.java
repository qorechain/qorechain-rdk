package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.receipts.Receipts;
import io.github.qorechain.rdk.receipts.Receipts.ReceiptVerification;
import io.github.qorechain.rdk.receipts.Receipts.SettlementReceipt;
import io.github.qorechain.rdk.util.Bytes;
import java.nio.charset.StandardCharsets;
import network.qorechain.pqc.Pqc;
import org.junit.jupiter.api.Test;

class ReceiptsTest {

    @Test
    void anchorSignBytesMatchesGolden() {
        Golden g = Golden.load();
        byte[] bytes =
                Receipts.anchorSignBytes(
                        g.anchorSignBytes.layerId,
                        g.anchorSignBytes.layerHeight,
                        g.anchorSignBytes.stateRoot,
                        g.anchorSignBytes.validatorSetHash);
        assertEquals(g.anchorSignBytes.expectedHex, Bytes.bytesToHex(bytes));
    }

    @Test
    void mldsaCrossImplVectorVerifies() {
        Golden g = Golden.load();
        boolean ok =
                Pqc.mldsaVerify(
                        "ml-dsa-87",
                        Bytes.hexToBytes(g.mldsaVector.publicKeyHex),
                        g.mldsaVector.messageUtf8.getBytes(StandardCharsets.UTF_8),
                        Bytes.hexToBytes(g.mldsaVector.signatureHex));
        assertTrue(ok, "golden ML-DSA-87 vector must verify under the chain's PQC library");
    }

    /**
     * A mock transport that anchors a freshly-built receipt and a PQC account whose key actually
     * signed the canonical anchor message, so a full build→verify round-trip can run offline.
     */
    private Transport receiptTransport(
            String stateRootHex, String vshHex, String pubKeyHex, String sigHex, String creator) {
        return req -> {
            if (req.url.contains("/qorechain/rdk/v1/rollup/")) {
                return new Transport.Response(
                        200,
                        "{\"rollup\":{\"rollup_id\":\"r1\",\"creator\":\""
                                + creator
                                + "\",\"status\":\"active\",\"layer_id\":\"layer-r1\"}}");
            }
            if (req.url.contains("/qorechain/rdk/v1/batch/")) {
                return new Transport.Response(
                        200,
                        "{\"batch\":{\"rollup_id\":\"r1\",\"batch_index\":7,\"state_root\":\""
                                + stateRootHex
                                + "\"}}");
            }
            if (req.url.contains("/qorechain/multilayer/v1/anchors/")) {
                return new Transport.Response(
                        200,
                        "{\"anchors\":[{\"layer_id\":\"layer-r1\",\"layer_height\":42,"
                                + "\"state_root\":\""
                                + stateRootHex
                                + "\",\"validator_set_hash\":\""
                                + vshHex
                                + "\",\"main_chain_height\":1000,\"anchored_at\":123,"
                                + "\"pqc_aggregate_signature\":\""
                                + sigHex
                                + "\",\"transaction_count\":5}]}");
            }
            if (req.url.contains("/qorechain/pqc/v1/accounts/")) {
                return new Transport.Response(
                        200,
                        "{\"account\":{\"address\":\""
                                + creator
                                + "\",\"public_key\":\""
                                + pubKeyHex
                                + "\",\"algorithm_id\":1,\"algorithm_name\":\"ML-DSA-87\"}}");
            }
            return new Transport.Response(404, "{}");
        };
    }

    @Test
    void receiptRoundTripBuildsAndVerifies() {
        // Generate a keypair and sign the exact canonical message the anchor commits to.
        byte[][] kp = Pqc.mldsaKeygen("ml-dsa-87");
        byte[] pub = kp[0];
        byte[] sec = kp[1];
        String stateRootHex =
                "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d";
        String vshHex =
                "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
        String creator = "qor1creator";

        byte[] message = Receipts.anchorSignBytes("layer-r1", 42, stateRootHex, vshHex);
        byte[] sig = Pqc.mldsaSign("ml-dsa-87", sec, message);
        String pubHex = Bytes.bytesToHex(pub);
        String sigHex = Bytes.bytesToHex(sig);

        RdkClient.Options opts = new RdkClient.Options();
        opts.transport = receiptTransport(stateRootHex, vshHex, pubHex, sigHex, creator);
        RdkClient client = new RdkClient(opts);

        SettlementReceipt receipt = Receipts.buildSettlementReceipt(client, "r1", 7);
        assertEquals(1, receipt.version);
        assertEquals("r1", receipt.rollupId);
        assertEquals("layer-r1", receipt.layerId);
        assertEquals("ML-DSA-87", receipt.algorithm);
        assertEquals(stateRootHex, receipt.stateRoot);
        assertEquals(stateRootHex, receipt.batchStateRoot);
        assertEquals(42, receipt.layerHeight);

        // Verify with a supplied key (offline) and via the client's PQC account fetch.
        ReceiptVerification offline =
                Receipts.verifySettlementReceipt(receipt, pubHex, null);
        assertTrue(offline.valid);
        assertTrue(offline.checks.stateRootBinding);
        assertTrue(offline.checks.pqcSignature);
        assertTrue(offline.checks.hasMaterial);

        ReceiptVerification viaClient =
                Receipts.verifySettlementReceipt(receipt, null, client);
        assertTrue(viaClient.valid);

        // Tamper: flip the batch state root binding -> invalid.
        receipt.batchStateRoot =
                "0000000000000000000000000000000000000000000000000000000000000000";
        ReceiptVerification tampered =
                Receipts.verifySettlementReceipt(receipt, pubHex, null);
        assertFalse(tampered.valid);
        assertFalse(tampered.checks.stateRootBinding);
    }
}
