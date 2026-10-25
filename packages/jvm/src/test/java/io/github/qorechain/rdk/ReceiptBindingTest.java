package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.receipts.Receipts;
import io.github.qorechain.rdk.receipts.Receipts.ReceiptVerification;
import io.github.qorechain.rdk.receipts.Receipts.SettlementReceipt;
import io.github.qorechain.rdk.util.Bytes;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import network.qorechain.pqc.Pqc;
import org.junit.jupiter.api.Test;

/** Every field a receipt states is bound to the chain, and unknown schemas are refused. */
class ReceiptBindingTest {

    private static final String STATE_ROOT =
            "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d";
    private static final String VSH =
            "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
    private static final String CREATOR = "qor1creator";

    private final RdkClient chain;

    ReceiptBindingTest() {
        byte[][] kp = Pqc.mldsaKeygen("ml-dsa-87");
        String pubHex = Bytes.bytesToHex(kp[0]);
        String sigHex =
                Bytes.bytesToHex(
                        Pqc.mldsaSign(
                                "ml-dsa-87", kp[1], Receipts.anchorSignBytes("layer-r1", 42, STATE_ROOT, VSH)));
        Transport t =
                req -> {
                    if (req.url.contains("/qorechain/rdk/v1/rollup/")) {
                        return new Transport.Response(
                                200,
                                "{\"rollup\":{\"rollup_id\":\"r1\",\"creator\":\"" + CREATOR
                                        + "\",\"status\":\"active\",\"layer_id\":\"layer-r1\"}}");
                    }
                    if (req.url.contains("/qorechain/rdk/v1/batch/")) {
                        return new Transport.Response(
                                200,
                                "{\"batch\":{\"rollup_id\":\"r1\",\"batch_index\":7,\"state_root\":\""
                                        + STATE_ROOT + "\"}}");
                    }
                    if (req.url.contains("/qorechain/multilayer/v1/anchors/")) {
                        return new Transport.Response(
                                200,
                                "{\"anchors\":[{\"layer_id\":\"layer-r1\",\"layer_height\":42,\"state_root\":\""
                                        + STATE_ROOT + "\",\"validator_set_hash\":\"" + VSH
                                        + "\",\"main_chain_height\":1000,\"anchored_at\":123,"
                                        + "\"pqc_aggregate_signature\":\"" + sigHex
                                        + "\",\"transaction_count\":5}]}");
                    }
                    if (req.url.contains("/qorechain/pqc/v1/account/")) {
                        return new Transport.Response(
                                200,
                                "{\"account\":{\"address\":\"" + CREATOR + "\",\"public_key\":\"" + pubHex
                                        + "\",\"algorithm_id\":1,\"algorithm_name\":\"ML-DSA-87\"}}");
                    }
                    return new Transport.Response(404, "{}");
                };
        RdkClient.Options opts = new RdkClient.Options();
        opts.transport = t;
        chain = new RdkClient(opts);
    }

    private SettlementReceipt genuine() {
        return Receipts.buildSettlementReceipt(chain, "r1", 7);
    }

    private SettlementReceipt forged(Consumer<SettlementReceipt> change) {
        SettlementReceipt r = genuine();
        change.accept(r);
        return r;
    }

    @Test
    void aValidResultCarriesTheChainAnchorAndTheRebuiltReceipt() {
        SettlementReceipt receipt = genuine();
        ReceiptVerification v = Receipts.verifySettlementReceipt(receipt, chain);
        assertTrue(v.valid, v.reason);
        assertNotNull(v.anchor);
        assertEquals(1000, v.anchor.mainChainHeight);
        assertNotNull(v.verifiedReceipt);
        assertEquals(receipt.mainChainHeight, v.verifiedReceipt.mainChainHeight);
        assertEquals(receipt.anchoredAt, v.verifiedReceipt.anchoredAt);
        assertEquals(receipt.chainId, v.verifiedReceipt.chainId);
    }

    private void assertRefusedNaming(String field, Consumer<SettlementReceipt> change) {
        ReceiptVerification v = Receipts.verifySettlementReceipt(forged(change), chain);
        assertFalse(v.valid, "forged " + field + " accepted");
        assertFalse(v.checks.anchorOnChain);
        assertNull(v.verifiedReceipt);
        assertTrue(v.reason != null && v.reason.contains(field), v.reason);
    }

    // Each forged copy keeps a genuine signature, so only the field comparison can catch it.
    @Test
    void forgedAnchorMetadataIsRefused() {
        assertRefusedNaming("mainChainHeight", r -> r.mainChainHeight = 999999);
        assertRefusedNaming("anchoredAt", r -> r.anchoredAt = 9999999999L);
        assertRefusedNaming("validatorSetHash", r -> r.validatorSetHash = "00".repeat(32));
        assertRefusedNaming("transactionCount", r -> r.transactionCount = 6);
        assertRefusedNaming("compressedStateProof", r -> r.compressedStateProof = "deadbeef");
        assertRefusedNaming("batchStateRoot", r -> r.batchStateRoot = "11".repeat(32));
    }

    @Test
    void anUnknownSchemaIsRefusedBeforeReadingTheChain() {
        AtomicInteger calls = new AtomicInteger();
        RdkClient.Options opts = new RdkClient.Options();
        opts.transport =
                req -> {
                    calls.incrementAndGet();
                    return new Transport.Response(404, "{}");
                };
        RdkClient counting = new RdkClient(opts);
        String[][] cases = {{"99", "unsupported receipt version 99"}, {"0", "unsupported receipt version 0"}};
        for (String[] c : cases) {
            ReceiptVerification v =
                    Receipts.verifySettlementReceipt(forged(r -> r.version = Integer.parseInt(c[0])), counting);
            assertFalse(v.valid);
            assertTrue(v.reason.contains(c[1]), v.reason);
        }
        ReceiptVerification alg =
                Receipts.verifySettlementReceipt(forged(r -> r.algorithm = "ML-DSA-44"), counting);
        assertTrue(alg.reason.contains("unsupported algorithm \"ML-DSA-44\""), alg.reason);
        ReceiptVerification noChain = Receipts.verifySettlementReceipt(forged(r -> r.chainId = null), counting);
        assertTrue(noChain.reason.contains("chainId"), noChain.reason);
        assertEquals(0, calls.get(), "the schema check read the chain");
    }

    @Test
    void aVersion1ReceiptWithoutV2FieldsStillVerifies() {
        SettlementReceipt r =
                forged(
                        x -> {
                            x.version = 1;
                            x.chainId = null;
                            x.transactionCount = 0;
                            x.compressedStateProof = "";
                        });
        ReceiptVerification v = Receipts.verifySettlementReceipt(r, chain);
        assertTrue(v.valid, v.reason);
    }
}
