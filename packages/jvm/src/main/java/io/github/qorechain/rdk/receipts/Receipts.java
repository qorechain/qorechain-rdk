package io.github.qorechain.rdk.receipts;

import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.config.Networks.NetworkConfig;
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
 * <p>A settlement receipt is a portable record that a rollup's settlement batch was anchored to the
 * QoreChain Main Chain under a post-quantum (ML-DSA-87 / Dilithium-5) signature.
 *
 * <p>A receipt is a <b>claim, not evidence</b> — every field in it is supplied by whoever hands it
 * to you. {@link #verifySettlementReceipt} therefore re-reads the claim from live chain state (the
 * rollup's layer, the batch's state root, the anchor, and the creator's registered key) and only
 * then reports it valid. Checking the signature alone, against a key you were handed, proves that
 * someone signed those bytes — not that QoreChain anchored anything.
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
    /**
     * Current receipt schema version. v2 adds {@code chainId}: the v2 anchor message binds the
     * signature to one network, and a receipt shown to a third party should say which network it
     * is for. Version-1 receipts still verify.
     */
    public static final int RECEIPT_VERSION = 2;

    /** Domain tag of the v2 anchor sign bytes (chain v3.2.2 and above). */
    public static final String ANCHOR_SIGN_DOMAIN_V2 = "qorechain-multilayer-anchor-v2";

    /** Which canonical anchor message a signature covers. */
    public enum AnchorSignBytesVersion {
        V1,
        V2;

        @Override
        public String toString() {
            return name().toLowerCase();
        }
    }

    /** A portable settlement receipt. Verify it with {@link #verifySettlementReceipt}. */
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
        /**
         * The state root read from the settlement batch (hex) when the receipt was built.
         * Informational only — verification compares the receipt against the chain's batch, never
         * against this copy of it.
         */
        public String batchStateRoot = "";
        /**
         * The chain the receipt was built on (e.g. {@code qorechain-vladi}). Bound into the v2
         * anchor signature and cross-checked against the node being queried. {@code null} on
         * version-1 receipts.
         */
        public String chainId;
        /** The anchor's transaction count, covered by the v2 signature (the chain's copy is used). */
        public long transactionCount;
        /** The anchor's compressed state proof (hex), covered by v2. Empty for a settlement batch. */
        public String compressedStateProof = "";
    }

    /**
     * How a receipt was checked.
     *
     * <ul>
     *   <li>{@link #CHAIN} — every field was reproduced from live chain state. Only this mode can
     *       yield {@code valid = true}.
     *   <li>{@link #SIGNATURE_ONLY} — the ML-DSA-87 signature was checked against a key the caller
     *       supplied. That proves whoever holds that key signed these bytes; it does <b>not</b>
     *       prove the anchor exists on QoreChain. Always {@code valid = false}.
     * </ul>
     */
    public enum ReceiptVerificationMode {
        CHAIN("chain"),
        SIGNATURE_ONLY("signature-only");

        private final String wire;

        ReceiptVerificationMode(String wire) {
            this.wire = wire;
        }

        /** The wire spelling used by the other RDK clients ({@code chain} / {@code signature-only}). */
        public String wire() {
            return wire;
        }

        @Override
        public String toString() {
            return wire;
        }
    }

    /** The individual structural and cryptographic checks a verification ran. */
    public static final class ReceiptChecks {
        /** The chain says {@code rollupId} belongs to the receipt's {@code layerId}. */
        public boolean rollupLayerBinding;
        /** The chain's batch carries the receipt's state root. */
        public boolean batchStateRoot;
        /** An anchor with this state root, height, validator-set hash and signature exists on chain. */
        public boolean anchorOnChain;
        /** The signing key was resolved from chain, not taken from the receipt. */
        public boolean creatorAuthority;
        /** The Dilithium-5 signature over the canonical message verified. */
        public boolean pqcSignature;
        /**
         * The receipt names the chain that was actually queried. A version-1 receipt carries no
         * chain id and passes on the strength of the anchor having been found on this chain.
         */
        public boolean chainBinding;
    }

    /** The outcome of verifying a receipt. */
    public static final class ReceiptVerification {
        /** True only when the receipt was reproduced from live chain state. */
        public boolean valid;
        /** Which check was actually performed. */
        public ReceiptVerificationMode mode = ReceiptVerificationMode.SIGNATURE_ONLY;
        public final ReceiptChecks checks = new ReceiptChecks();
        /** Which anchor message the signature was checked against ({@code v2} from the switch). */
        public AnchorSignBytesVersion signBytesVersion;
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
     * The <b>pre-v3.2.2</b> canonical anchor message: {@code layer_id || layer_height(8B BE) ||
     * state_root || validator_set_hash}.
     *
     * <p>Kept because anchors written before the chain's {@code rdk-integrity} switch are signed
     * this way and stay valid forever. Do not use it for new work: it has no length prefixes, so
     * field boundaries are ambiguous, and no chain id, so a signature is valid on <b>every</b>
     * chain. Both are why v2 exists.
     */
    public static byte[] anchorSignBytesV1(
            String layerId, long layerHeight, String stateRootHex, String vshHex) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(layerId.getBytes(StandardCharsets.UTF_8));
        out.writeBytes(u64be(layerHeight));
        out.writeBytes(Bytes.hexToBytes(stateRootHex));
        out.writeBytes(Bytes.hexToBytes(vshHex));
        return out.toByteArray();
    }

    /** The v1 message, kept for backwards compatibility; prefer the explicit V1/V2 builders. */
    public static byte[] anchorSignBytes(
            String layerId, long layerHeight, String stateRootHex, String vshHex) {
        return anchorSignBytesV1(layerId, layerHeight, stateRootHex, vshHex);
    }

    private static void lengthPrefixed(ByteArrayOutputStream out, byte[] b) {
        out.writeBytes(u64be(b.length));
        out.writeBytes(b);
    }

    /**
     * The <b>v3.2.2 and later</b> canonical anchor message. Every variable-length field carries
     * an 8-byte big-endian length, the chain id binds the signature to one network, and the
     * transaction count and compressed state proof are covered too, because the chain computes its
     * anchor fraud check from them:
     *
     * <pre>
     * "qorechain-multilayer-anchor-v2"
     *  | BE64 len(chain_id)               chain_id
     *  | BE64 len(layer_id)               layer_id
     *  | BE64                             layer_height
     *  | BE64 len(state_root)             state_root
     *  | BE64 len(validator_set_hash)     validator_set_hash
     *  | BE64                             transaction_count
     *  | BE64 len(compressed_state_proof) compressed_state_proof
     * </pre>
     *
     * For a settlement batch the chain maps these as: {@code layer_id} is the rollup's layer id,
     * {@code layer_height} the <b>batch index</b>, {@code state_root} the batch state root,
     * {@code transaction_count} the batch's transaction count, and the proof empty.
     */
    public static byte[] anchorSignBytesV2(
            String chainId,
            String layerId,
            long layerHeight,
            String stateRootHex,
            String vshHex,
            long transactionCount,
            String compressedStateProofHex) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(ANCHOR_SIGN_DOMAIN_V2.getBytes(StandardCharsets.UTF_8));
        lengthPrefixed(out, chainId.getBytes(StandardCharsets.UTF_8));
        lengthPrefixed(out, layerId.getBytes(StandardCharsets.UTF_8));
        out.writeBytes(u64be(layerHeight));
        lengthPrefixed(out, Bytes.hexToBytes(stateRootHex));
        lengthPrefixed(out, Bytes.hexToBytes(vshHex));
        out.writeBytes(u64be(transactionCount));
        lengthPrefixed(
                out,
                Bytes.hexToBytes(compressedStateProofHex == null ? "" : compressedStateProofHex));
        return out.toByteArray();
    }

    /**
     * Which anchor message a given anchor was signed over: the form in force at the Main Chain
     * height it was recorded at. Deciding by height rather than trying both forms matters — a v1
     * signature covers no chain id, so it is valid on every chain; accepting v1 where v2 is in
     * force would re-admit exactly the weakness v2 was introduced to close.
     */
    public static AnchorSignBytesVersion anchorSignBytesVersionFor(
            long anchorMainChainHeight, long v2Height) {
        return anchorMainChainHeight >= v2Height
                ? AnchorSignBytesVersion.V2
                : AnchorSignBytesVersion.V1;
    }

    private static SettlementReceipt receiptFromParts(
            String rollupId,
            String layerId,
            int batchIndex,
            String creator,
            AnchorView anchor,
            String batchStateRootHex,
            String chainId) {
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
        r.chainId = chainId;
        r.transactionCount = anchor.transactionCount;
        r.compressedStateProof = anchor.compressedStateProof;
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
        SettlementReceipt r = buildSettlementReceipt(client.rest, rollupId, batchIndex);
        r.chainId = client.network.chainId;
        r.version = RECEIPT_VERSION;
        return r;
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
        // A bare RestClient does not know its chain, so the receipt is version-1
        // shaped (no chain id); the RdkClient overload fills it in.
        SettlementReceipt r =
                receiptFromParts(
                        rollupId,
                        rollup.layerId,
                        batchIndex,
                        rollup.creator,
                        anchor,
                        batchStateRootHex,
                        null);
        r.version = 1;
        return r;
    }

    /** Options for {@link #verifySettlementReceipt(SettlementReceipt, VerifyReceiptOptions)}. */
    public static final class VerifyReceiptOptions {
        /**
         * A read client for the network the receipt claims to come from. <b>Required for a real
         * verification</b> — every field is re-read from chain state, so a fabricated receipt
         * cannot pass.
         */
        public RestClient rest;

        /**
         * Signature-only mode: check the ML-DSA-87 signature against a key obtained out-of-band.
         * This proves only that the holder of that key signed these bytes — <b>never</b> that
         * QoreChain anchored the batch — so the result is always {@code valid = false} with
         * {@link ReceiptVerificationMode#SIGNATURE_ONLY}. Ignored when {@link #rest} is supplied.
         */
        public String creatorPublicKeyHex;

        /**
         * The network being verified against: its chain id (bound into the v2 anchor message and
         * cross-checked against the receipt) and its v2 switch height. Set by {@link
         * #client(RdkClient)}; <b>required</b> with a bare {@link RestClient}, which does not know
         * its own chain.
         */
        public NetworkConfig network;

        /** Verify against live chain state through {@code client}'s REST reads. */
        public VerifyReceiptOptions client(RdkClient client) {
            this.rest = client == null ? null : client.rest;
            this.network = client == null ? null : client.network;
            return this;
        }

        /** The network a bare {@link RestClient} reads from. */
        public VerifyReceiptOptions network(NetworkConfig network) {
            this.network = network;
            return this;
        }

        /** Verify against live chain state through a bare {@link RestClient}. */
        public VerifyReceiptOptions rest(RestClient rest) {
            this.rest = rest;
            return this;
        }

        /** Signature-only mode against a key obtained out-of-band. Never yields {@code valid}. */
        public VerifyReceiptOptions creatorPublicKeyHex(String publicKeyHex) {
            this.creatorPublicKeyHex = publicKeyHex;
            return this;
        }
    }

    /**
     * Verify an anchor's post-quantum signature. Every signed field is taken from the chain's
     * anchor, never from the receipt — the receipt only says which anchor to look for. {@code
     * chainId} likewise comes from the network being queried.
     */
    private static boolean signatureOver(
            AnchorView anchor, String publicKeyHex, String chainId, AnchorSignBytesVersion version) {
        if (publicKeyHex == null
                || publicKeyHex.isEmpty()
                || anchor.pqcSignature == null
                || anchor.pqcSignature.isEmpty()) {
            return false;
        }
        try {
            byte[] message =
                    version == AnchorSignBytesVersion.V2
                            ? anchorSignBytesV2(
                                    chainId,
                                    anchor.layerId,
                                    anchor.layerHeight,
                                    anchor.stateRoot,
                                    anchor.validatorSetHash,
                                    anchor.transactionCount,
                                    anchor.compressedStateProof)
                            : anchorSignBytesV1(
                                    anchor.layerId,
                                    anchor.layerHeight,
                                    anchor.stateRoot,
                                    anchor.validatorSetHash);
            return Pqc.mldsaVerify(
                    PQC_LEVEL,
                    Bytes.hexToBytes(publicKeyHex),
                    message,
                    Bytes.hexToBytes(anchor.pqcSignature));
        } catch (RuntimeException err) {
            return false;
        }
    }

    /** The receipt's own copies of the signed fields, for signature-only mode. */
    private static AnchorView receiptAsAnchor(SettlementReceipt r) {
        AnchorView a = new AnchorView();
        a.layerId = r.layerId;
        a.layerHeight = r.layerHeight;
        a.stateRoot = r.stateRoot;
        a.validatorSetHash = r.validatorSetHash;
        a.mainChainHeight = r.mainChainHeight;
        a.anchoredAt = r.anchoredAt;
        a.pqcSignature = r.pqcSignature;
        a.transactionCount = (int) r.transactionCount;
        a.compressedStateProof = r.compressedStateProof == null ? "" : r.compressedStateProof;
        return a;
    }

    private static ReceiptVerification fail(ReceiptVerification v, String reason) {
        v.valid = false;
        v.reason = reason;
        return v;
    }

    /**
     * Verify a settlement receipt against live chain state.
     *
     * <p>A receipt is a <i>claim</i>, not evidence: every field in it is supplied by whoever hands
     * it to you. Verification therefore re-reads the claim from the chain — the rollup's layer, the
     * batch's state root, the anchor itself, and the signing key — and reports {@code valid = true}
     * only when the receipt reproduces what the chain actually holds. Supply a client for this.
     *
     * <p>Without a client you can still check the signature ({@code creatorPublicKeyHex}), but that
     * is {@link ReceiptVerificationMode#SIGNATURE_ONLY} and never valid: a signature proves someone
     * signed these bytes, not that the anchor exists.
     */
    public static ReceiptVerification verifySettlementReceipt(
            SettlementReceipt receipt, VerifyReceiptOptions options) {
        ReceiptVerification v = new ReceiptVerification();
        VerifyReceiptOptions opts = options == null ? new VerifyReceiptOptions() : options;

        if (opts.rest == null) {
            v.mode = ReceiptVerificationMode.SIGNATURE_ONLY;
            if (opts.creatorPublicKeyHex == null || opts.creatorPublicKeyHex.isEmpty()) {
                return fail(
                        v,
                        "no client supplied — pass a client to verify against chain state; a"
                                + " receipt on its own proves nothing");
            }
            // Without a client there is no chain to read, so the receipt's own copies are all
            // there is — which is why this mode is never valid. Both forms are tried because
            // nothing here reveals the anchor's height.
            AnchorView own = receiptAsAnchor(receipt);
            if (receipt.chainId != null
                    && signatureOver(
                            own, opts.creatorPublicKeyHex, receipt.chainId, AnchorSignBytesVersion.V2)) {
                v.checks.pqcSignature = true;
                v.signBytesVersion = AnchorSignBytesVersion.V2;
            } else if (signatureOver(own, opts.creatorPublicKeyHex, "", AnchorSignBytesVersion.V1)) {
                v.checks.pqcSignature = true;
                v.signBytesVersion = AnchorSignBytesVersion.V1;
            }
            return fail(
                    v,
                    v.checks.pqcSignature
                            ? "signature is valid for the supplied key, but nothing was checked"
                                    + " against the chain — pass a client to verify settlement"
                            : "signature did not verify against the supplied key");
        }

        RestClient rest = opts.rest;
        v.mode = ReceiptVerificationMode.CHAIN;
        if (opts.network == null || opts.network.chainId == null || opts.network.chainId.isEmpty()) {
            // Refuse rather than guess: the chain id is bound into the v2 anchor message and is
            // what stops a receipt from one network passing on another.
            return fail(
                    v,
                    "the network is unknown — verify through an RdkClient, or pass"
                            + " VerifyReceiptOptions.network(...) with a bare RestClient");
        }

        // 1. The rollup must exist on chain and belong to the layer the receipt names.
        RollupView rollup;
        try {
            rollup = rest.getRollup(receipt.rollupId);
        } catch (RuntimeException err) {
            return fail(
                    v,
                    "rollup \"" + receipt.rollupId + "\" not found on chain: " + err.getMessage());
        }
        v.checks.rollupLayerBinding =
                rollup.layerId != null
                        && !rollup.layerId.isEmpty()
                        && rollup.layerId.equals(receipt.layerId);
        if (!v.checks.rollupLayerBinding) {
            String actual =
                    (rollup.layerId == null || rollup.layerId.isEmpty()) ? "(none)" : rollup.layerId;
            return fail(
                    v,
                    "rollup \""
                            + receipt.rollupId
                            + "\" is anchored to layer \""
                            + actual
                            + "\", not \""
                            + receipt.layerId
                            + "\"");
        }

        // 2. The chain's batch must carry the receipt's state root (not the receipt's own copy).
        try {
            BatchView batch = rest.getBatch(receipt.rollupId, receipt.batchIndex);
            String onChainRoot =
                    (batch.stateRoot == null || batch.stateRoot.isEmpty())
                            ? ""
                            : Bytes.bytesToHex(Bytes.decodeWireBytes(batch.stateRoot));
            v.checks.batchStateRoot = !onChainRoot.isEmpty() && onChainRoot.equals(receipt.stateRoot);
        } catch (RuntimeException err) {
            return fail(
                    v,
                    "batch " + receipt.batchIndex + " not found on chain: " + err.getMessage());
        }
        if (!v.checks.batchStateRoot) {
            return fail(v, "the chain's batch does not carry the receipt's state root");
        }

        // 3. An anchor matching this receipt must actually exist on chain.
        // The matched anchor is kept: it, not the receipt, is what step 6 verifies.
        AnchorView matched = null;
        try {
            List<AnchorView> anchors = rest.getAnchors(receipt.layerId);
            for (AnchorView a : anchors) {
                if (eq(a.stateRoot, receipt.stateRoot)
                        && a.layerHeight == receipt.layerHeight
                        && eq(a.validatorSetHash, receipt.validatorSetHash)
                        && eq(a.pqcSignature, receipt.pqcSignature)) {
                    v.checks.anchorOnChain = true;
                    matched = a;
                    break;
                }
            }
        } catch (RuntimeException err) {
            return fail(
                    v,
                    "could not read anchors for layer \""
                            + receipt.layerId
                            + "\": "
                            + err.getMessage());
        }
        if (!v.checks.anchorOnChain) {
            return fail(v, "no anchor on chain matches this receipt — it is fabricated or superseded");
        }

        // 4. The signing key is resolved from the chain, never taken from the receipt.
        String publicKeyHex;
        try {
            PqcAccountView account = rest.getPqcAccount(rollup.creator);
            publicKeyHex = account.publicKey;
        } catch (RuntimeException err) {
            return fail(v, "could not resolve the creator's post-quantum key: " + err.getMessage());
        }
        if (!eq(receipt.creator, rollup.creator)) {
            return fail(
                    v,
                    "receipt names creator \""
                            + receipt.creator
                            + "\" but the chain says the rollup's creator is \""
                            + rollup.creator
                            + "\"");
        }
        v.checks.creatorAuthority = publicKeyHex != null && !publicKeyHex.isEmpty();
        if (!v.checks.creatorAuthority) {
            return fail(v, "no post-quantum key is registered for creator " + rollup.creator);
        }

        // 5. The receipt must name the chain we actually queried. A version-1 receipt carries no
        // chain id; it still verifies, because step 3 already required the anchor to exist on this
        // chain, but the binding is the chain read rather than the receipt's own word.
        String chainId = opts.network.chainId;
        if (receipt.chainId != null && !receipt.chainId.equals(chainId)) {
            return fail(
                    v,
                    "receipt is for chain \""
                            + receipt.chainId
                            + "\" but this client is connected to \""
                            + chainId
                            + "\" — verify it against a node for its own network");
        }
        v.checks.chainBinding = true;

        // 6. Finally the post-quantum signature, over the form the chain had in force at the
        // height this anchor was recorded at.
        AnchorSignBytesVersion version =
                anchorSignBytesVersionFor(matched.mainChainHeight, opts.network.anchorSignV2Height);
        v.signBytesVersion = version;
        v.checks.pqcSignature = signatureOver(matched, publicKeyHex, chainId, version);
        if (!v.checks.pqcSignature) {
            return fail(
                    v,
                    "Dilithium-5 anchor signature did not verify against the creator's registered"
                            + " key (checked as "
                            + version
                            + ", for an anchor at height "
                            + matched.mainChainHeight
                            + ")");
        }
        v.valid = true;
        v.reason = null;
        return v;
    }

    private static boolean eq(String a, String b) {
        return a != null && !a.isEmpty() && a.equals(b);
    }

    /** Verify {@code receipt} against live chain state read through {@code client}. */
    public static ReceiptVerification verifySettlementReceipt(
            SettlementReceipt receipt, RdkClient client) {
        return verifySettlementReceipt(receipt, new VerifyReceiptOptions().client(client));
    }

    /**
     * Verify {@code receipt} against live chain state read through a bare {@link RestClient} for
     * {@code network}. The network is required: a RestClient does not know its own chain.
     */
    public static ReceiptVerification verifySettlementReceipt(
            SettlementReceipt receipt, RestClient rest, NetworkConfig network) {
        return verifySettlementReceipt(
                receipt, new VerifyReceiptOptions().rest(rest).network(network));
    }

    /**
     * Verify {@code receipt}, preferring live chain state.
     *
     * <p>When {@code client} is non-null every field is re-read from the chain and
     * {@code creatorPublicKeyHex} is ignored — the signing key is always the one the chain
     * registers for the rollup's creator. When it is null, the result is
     * {@link ReceiptVerificationMode#SIGNATURE_ONLY} and {@code valid} is always {@code false}.
     */
    public static ReceiptVerification verifySettlementReceipt(
            SettlementReceipt receipt, String creatorPublicKeyHex, RdkClient client) {
        VerifyReceiptOptions opts =
                new VerifyReceiptOptions().creatorPublicKeyHex(creatorPublicKeyHex).client(client);
        return verifySettlementReceipt(receipt, opts);
    }
}
