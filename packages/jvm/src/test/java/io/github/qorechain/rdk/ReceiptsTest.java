package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.receipts.Receipts;
import io.github.qorechain.rdk.receipts.Receipts.ReceiptVerification;
import io.github.qorechain.rdk.receipts.Receipts.ReceiptVerificationMode;
import io.github.qorechain.rdk.receipts.Receipts.SettlementReceipt;
import io.github.qorechain.rdk.receipts.Receipts.VerifyReceiptOptions;
import io.github.qorechain.rdk.util.Bytes;
import java.nio.charset.StandardCharsets;
import network.qorechain.pqc.Pqc;
import org.junit.jupiter.api.Test;

class ReceiptsTest {

    private static final String STATE_ROOT =
            "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d";
    private static final String VSH =
            "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
    private static final String CREATOR = "qor1creator";

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
     * A mock transport standing in for a node that really anchored the batch: the rollup belongs to
     * {@code layer-r1}, the batch carries {@code stateRootHex}, an anchor commits it, and the
     * creator's registered PQC key is {@code pubKeyHex}.
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

    private RdkClient client(String pubKeyHex, String sigHex) {
        RdkClient.Options opts = new RdkClient.Options();
        opts.transport = receiptTransport(STATE_ROOT, VSH, pubKeyHex, sigHex, CREATOR);
        return new RdkClient(opts);
    }

    @Test
    void receiptRoundTripBuildsAndVerifiesAgainstChain() {
        // Generate a keypair and sign the exact canonical message the anchor commits to.
        byte[][] kp = Pqc.mldsaKeygen("ml-dsa-87");
        String pubHex = Bytes.bytesToHex(kp[0]);
        byte[] message = Receipts.anchorSignBytes("layer-r1", 42, STATE_ROOT, VSH);
        String sigHex = Bytes.bytesToHex(Pqc.mldsaSign("ml-dsa-87", kp[1], message));

        RdkClient c = client(pubHex, sigHex);
        SettlementReceipt receipt = Receipts.buildSettlementReceipt(c, "r1", 7);
        assertEquals(1, receipt.version);
        assertEquals("r1", receipt.rollupId);
        assertEquals("layer-r1", receipt.layerId);
        assertEquals("ML-DSA-87", receipt.algorithm);
        assertEquals(STATE_ROOT, receipt.stateRoot);
        assertEquals(STATE_ROOT, receipt.batchStateRoot);
        assertEquals(42, receipt.layerHeight);
        assertEquals(CREATOR, receipt.creator);

        ReceiptVerification v = Receipts.verifySettlementReceipt(receipt, c);
        assertTrue(v.valid);
        assertEquals(ReceiptVerificationMode.CHAIN, v.mode);
        assertTrue(v.checks.rollupLayerBinding);
        assertTrue(v.checks.batchStateRoot);
        assertTrue(v.checks.anchorOnChain);
        assertTrue(v.checks.creatorAuthority);
        assertTrue(v.checks.pqcSignature);
    }

    @Test
    void signatureOnlyIsNeverValidEvenForAGenuineReceipt() {
        byte[][] kp = Pqc.mldsaKeygen("ml-dsa-87");
        String pubHex = Bytes.bytesToHex(kp[0]);
        byte[] message = Receipts.anchorSignBytes("layer-r1", 42, STATE_ROOT, VSH);
        String sigHex = Bytes.bytesToHex(Pqc.mldsaSign("ml-dsa-87", kp[1], message));

        SettlementReceipt receipt =
                Receipts.buildSettlementReceipt(client(pubHex, sigHex), "r1", 7);

        ReceiptVerification v =
                Receipts.verifySettlementReceipt(
                        receipt, new VerifyReceiptOptions().creatorPublicKeyHex(pubHex));
        assertTrue(v.checks.pqcSignature, "the signature really is good");
        assertFalse(v.valid, "but nothing was checked against the chain");
        assertEquals(ReceiptVerificationMode.SIGNATURE_ONLY, v.mode);
        assertNotNull(v.reason);
    }

    @Test
    void refusesToVerifyWithNoClientAtAll() {
        byte[][] kp = Pqc.mldsaKeygen("ml-dsa-87");
        String pubHex = Bytes.bytesToHex(kp[0]);
        byte[] message = Receipts.anchorSignBytes("layer-r1", 42, STATE_ROOT, VSH);
        String sigHex = Bytes.bytesToHex(Pqc.mldsaSign("ml-dsa-87", kp[1], message));

        SettlementReceipt receipt =
                Receipts.buildSettlementReceipt(client(pubHex, sigHex), "r1", 7);

        ReceiptVerification v =
                Receipts.verifySettlementReceipt(receipt, new VerifyReceiptOptions());
        assertFalse(v.valid);
        assertEquals(ReceiptVerificationMode.SIGNATURE_ONLY, v.mode);
        assertFalse(v.checks.pqcSignature);
        assertNotNull(v.reason);
    }

    @Test
    void rejectsATamperedSignatureAgainstTheChain() {
        byte[][] kp = Pqc.mldsaKeygen("ml-dsa-87");
        String pubHex = Bytes.bytesToHex(kp[0]);
        byte[] message = Receipts.anchorSignBytes("layer-r1", 42, STATE_ROOT, VSH);
        byte[] sig = Pqc.mldsaSign("ml-dsa-87", kp[1], message);
        sig[10] ^= (byte) 0xff;
        String badSigHex = Bytes.bytesToHex(sig);

        RdkClient c = client(pubHex, badSigHex);
        SettlementReceipt receipt = Receipts.buildSettlementReceipt(c, "r1", 7);

        ReceiptVerification v = Receipts.verifySettlementReceipt(receipt, c);
        assertFalse(v.valid);
        assertEquals(ReceiptVerificationMode.CHAIN, v.mode);
        assertTrue(v.checks.anchorOnChain, "the chain really does carry this (bad) signature");
        assertFalse(v.checks.pqcSignature);
    }

    /**
     * QSR-2026-0055 regression: a receipt is a claim, not evidence. An attacker who generates their
     * own ML-DSA-87 keypair, invents a state root and signs it must never get {@code valid = true},
     * however internally consistent the receipt looks.
     */
    @Test
    void qsr20260055RejectsAFabricatedReceiptSignedByAnAttackersOwnKey() {
        byte[][] evil = Pqc.mldsaKeygen("ml-dsa-87");
        String evilPubHex = Bytes.bytesToHex(evil[0]);

        SettlementReceipt fake = new SettlementReceipt();
        fake.version = Receipts.RECEIPT_VERSION;
        fake.rollupId = "victim-rollup";
        fake.layerId = "layer-victim";
        fake.batchIndex = 999;
        fake.creator = "qor1attackerownaddress";
        fake.algorithm = Receipts.RECEIPT_ALGORITHM;
        fake.stateRoot = "de".repeat(32);
        fake.layerHeight = 123456;
        fake.validatorSetHash = "ab".repeat(32);
        fake.mainChainHeight = 999999;
        fake.anchoredAt = 1757000000L;
        // The attacker controls both sides of the old "binding" check.
        fake.batchStateRoot = fake.stateRoot;
        fake.pqcSignature =
                Bytes.bytesToHex(
                        Pqc.mldsaSign(
                                "ml-dsa-87",
                                evil[1],
                                Receipts.anchorSignBytes(
                                        fake.layerId,
                                        fake.layerHeight,
                                        fake.stateRoot,
                                        fake.validatorSetHash)));

        // Signature-only: the signature is internally consistent, but proves nothing.
        ReceiptVerification sigOnly =
                Receipts.verifySettlementReceipt(
                        fake, new VerifyReceiptOptions().creatorPublicKeyHex(evilPubHex));
        assertTrue(sigOnly.checks.pqcSignature, "the attacker did sign their own bytes");
        assertFalse(sigOnly.valid, "signature-only can never be valid");
        assertEquals(ReceiptVerificationMode.SIGNATURE_ONLY, sigOnly.mode);

        // The legacy 3-arg form must not be a back door either.
        ReceiptVerification legacy = Receipts.verifySettlementReceipt(fake, evilPubHex, null);
        assertFalse(legacy.valid);
        assertEquals(ReceiptVerificationMode.SIGNATURE_ONLY, legacy.mode);

        // Against a chain that knows nothing of this rollup or layer: not valid.
        byte[][] kp = Pqc.mldsaKeygen("ml-dsa-87");
        RdkClient honest =
                client(
                        Bytes.bytesToHex(kp[0]),
                        Bytes.bytesToHex(
                                Pqc.mldsaSign(
                                        "ml-dsa-87",
                                        kp[1],
                                        Receipts.anchorSignBytes("layer-r1", 42, STATE_ROOT, VSH))));
        ReceiptVerification onChain = Receipts.verifySettlementReceipt(fake, honest);
        assertFalse(onChain.valid);
        assertEquals(ReceiptVerificationMode.CHAIN, onChain.mode);
        assertFalse(onChain.checks.rollupLayerBinding);
        assertFalse(onChain.checks.anchorOnChain);
        assertFalse(onChain.checks.pqcSignature);
        assertNotNull(onChain.reason);
    }
}
