package io.github.qorechain.rdk.receipts;

import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Views.AnchorView;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.client.Views.PqcAccountView;
import io.github.qorechain.rdk.client.Views.RollupView;
import io.github.qorechain.rdk.util.Bytes;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import network.qorechain.pqc.Pqc;

/**
 * Quantum-Safe Settlement Receipts.
 *
 * <p>A settlement receipt is a portable, self-contained proof that a rollup's settlement batch was
 * anchored to the QoreChain Main Chain under a post-quantum (ML-DSA-87 / Dilithium-5) signature. It
 * can be verified fully offline: reconstruct the canonical anchor message, fetch (or supply) the
 * layer creator's registered PQC key, and check the Dilithium-5 signature plus the batch↔anchor
 * state-root binding.
 *
 * <p>Canonical anchor message (matches the chain's {@code anchorSignBytes}):
 * {@code layer_id || layer_height(8-byte big-endian) || state_root || validator_set_hash}.
 */
public final class Receipts {
    private Receipts() {}

    /** The post-quantum algorithm the anchor signature uses. */
    public static final String RECEIPT_ALGORITHM = "ML-DSA-87";

    /** The {@link Pqc} security level identifier for the receipt algorithm. */
    public static final String PQC_LEVEL = "ml-dsa-87";

    /** Current receipt schema version. */
    public static final int RECEIPT_VERSION = 1;

    /** A portable, offline-verifiable settlement receipt. */
    public static final class SettlementReceipt {
        public int version = RECEIPT_VERSION;
        public String rollupId = "";
        public String layerId = "";
        public int batchIndex;
        /** The layer creator — the registered signer of the anchor's PQC signature. */
        public String creator = "";
        public String algorithm = RECEIPT_ALGORITHM;
        /** The anchored state root (hex). */
        public String stateRoot = "";
        public long layerHeight;
        public String validatorSetHash = "";
        public long mainChainHeight;
        public long anchoredAt;
        /** The Dilithium-5 anchor signature (hex). */
        public String pqcSignature = "";
        /** The state root read from the settlement batch (hex), for the binding check. */
        public String batchStateRoot = "";
    }

    /** The individual structural and cryptographic checks a verification ran. */
    public static final class ReceiptChecks {
        /** The batch's state root equals the anchored state root. */
        public boolean stateRootBinding;
        /** The Dilithium-5 signature over the canonical message verified. */
        public boolean pqcSignature;
        /** A non-empty signature and key were present to check. */
        public boolean hasMaterial;
    }

    /** The outcome of verifying a receipt. */
    public static final class ReceiptVerification {
        public boolean valid;
        public final ReceiptChecks checks = new ReceiptChecks();
        public String reason;
    }

    /** Encode a uint64 as 8 big-endian bytes. */
    static byte[] u64be(long value) {
        byte[] out = new byte[8];
        for (int i = 7; i >= 0; i--) {
            out[i] = (byte) (value & 0xff);
            value >>>= 8;
        }
        return out;
    }

    /**
     * Reconstruct the canonical message the chain signs for a state anchor:
     * {@code layer_id || layer_height(8B BE) || state_root || validator_set_hash}. Inputs are taken
     * in hex ({@code stateRootHex}, {@code vshHex}) and a numeric height.
     */
    public static byte[] anchorSignBytes(
            String layerId, long layerHeight, String stateRootHex, String vshHex) {
        byte[] id = layerId.getBytes(StandardCharsets.UTF_8);
        byte[] height = u64be(layerHeight);
        byte[] stateRoot = Bytes.hexToBytes(stateRootHex);
        byte[] vsh = Bytes.hexToBytes(vshHex);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(id);
        out.writeBytes(height);
        out.writeBytes(stateRoot);
        out.writeBytes(vsh);
        return out.toByteArray();
    }

    private static SettlementReceipt receiptFromParts(
            String rollupId,
            String layerId,
            int batchIndex,
            String creator,
            AnchorView anchor,
            String batchStateRootHex) {
        SettlementReceipt r = new SettlementReceipt();
        r.version = RECEIPT_VERSION;
        r.rollupId = rollupId;
        r.layerId = layerId;
        r.batchIndex = batchIndex;
        r.creator = creator;
        r.algorithm = RECEIPT_ALGORITHM;
        r.stateRoot = anchor.stateRoot;
        r.layerHeight = anchor.layerHeight;
        r.validatorSetHash = anchor.validatorSetHash;
        r.mainChainHeight = anchor.mainChainHeight;
        r.anchoredAt = anchor.anchoredAt;
        r.pqcSignature = anchor.pqcSignature;
        r.batchStateRoot = batchStateRootHex;
        return r;
    }

    /**
     * Build a settlement receipt for {@code rollupId}'s batch {@code batchIndex}: resolve the
     * rollup's layer, read the batch's state root, and find the state anchor that commits that root
     * to the Main Chain. Throws if the rollup has no layer, the batch is missing, or no anchor
     * covers the batch's state root yet.
     */
    public static SettlementReceipt buildSettlementReceipt(
            RdkClient client, String rollupId, int batchIndex) {
        return buildSettlementReceipt(client.rest, rollupId, batchIndex);
    }

    /** {@link #buildSettlementReceipt(RdkClient, String, int)} against a bare {@link RestClient}. */
    public static SettlementReceipt buildSettlementReceipt(
            RestClient rest, String rollupId, int batchIndex) {
        RollupView rollup = rest.getRollup(rollupId);
        if (rollup.layerId == null || rollup.layerId.isEmpty()) {
            throw new RuntimeException(
                    "rollup \""
                            + rollupId
                            + "\" has no layer_id — it is not anchored to a multilayer layer");
        }
        BatchView batch = rest.getBatch(rollupId, batchIndex);
        String batchStateRootHex =
                (batch.stateRoot == null || batch.stateRoot.isEmpty())
                        ? ""
                        : Bytes.bytesToHex(Bytes.decodeWireBytes(batch.stateRoot));

        List<AnchorView> anchors = rest.getAnchors(rollup.layerId);
        AnchorView covering = null;
        for (AnchorView a : anchors) {
            if (a.stateRoot != null && !a.stateRoot.isEmpty() && a.stateRoot.equals(batchStateRootHex)) {
                covering = a;
                break;
            }
        }
        AnchorView anchor = covering != null ? covering : rest.getLatestAnchor(rollup.layerId);
        if (anchor.stateRoot == null || anchor.stateRoot.isEmpty()) {
            throw new RuntimeException("no state anchor found for layer \"" + rollup.layerId + "\"");
        }
        if (covering == null) {
            throw new RuntimeException(
                    "no anchor commits batch "
                            + batchIndex
                            + "'s state root yet (latest anchored height "
                            + anchor.layerHeight
                            + "); the batch may not be anchored to the Main Chain");
        }
        return receiptFromParts(
                rollupId, rollup.layerId, batchIndex, rollup.creator, anchor, batchStateRootHex);
    }

    /**
     * Verify a settlement receipt: the batch↔anchor state-root binding and the Dilithium-5 signature
     * over the canonical anchor message. With {@code creatorPublicKeyHex} supplied this is fully
     * offline; otherwise {@code client} fetches the creator's registered post-quantum key.
     */
    public static ReceiptVerification verifySettlementReceipt(
            SettlementReceipt receipt, String creatorPublicKeyHex, RdkClient client) {
        ReceiptVerification v = new ReceiptVerification();

        v.checks.stateRootBinding =
                receipt.stateRoot != null
                        && !receipt.stateRoot.isEmpty()
                        && receipt.stateRoot.equals(receipt.batchStateRoot);

        String publicKeyHex = creatorPublicKeyHex;
        if (publicKeyHex == null || publicKeyHex.isEmpty()) {
            if (client == null) {
                v.valid = false;
                v.reason =
                        "no creatorPublicKey supplied and no client to fetch the creator's PQC key";
                return v;
            }
            PqcAccountView account = client.rest.getPqcAccount(receipt.creator);
            publicKeyHex = account.publicKey;
        }

        v.checks.hasMaterial =
                publicKeyHex != null
                        && !publicKeyHex.isEmpty()
                        && receipt.pqcSignature != null
                        && !receipt.pqcSignature.isEmpty();
        if (!v.checks.hasMaterial) {
            v.valid = false;
            v.reason = "missing public key or anchor signature";
            return v;
        }

        byte[] message =
                anchorSignBytes(
                        receipt.layerId,
                        receipt.layerHeight,
                        receipt.stateRoot,
                        receipt.validatorSetHash);
        try {
            v.checks.pqcSignature =
                    Pqc.mldsaVerify(
                            PQC_LEVEL,
                            Bytes.hexToBytes(publicKeyHex),
                            message,
                            Bytes.hexToBytes(receipt.pqcSignature));
        } catch (RuntimeException err) {
            v.valid = false;
            v.reason = "signature check failed: " + err.getMessage();
            return v;
        }

        v.valid = v.checks.stateRootBinding && v.checks.pqcSignature;
        if (v.valid) {
            v.reason = null;
        } else if (!v.checks.stateRootBinding) {
            v.reason = "batch state root does not match the anchored state root";
        } else {
            v.reason = "Dilithium-5 anchor signature did not verify";
        }
        return v;
    }
}
