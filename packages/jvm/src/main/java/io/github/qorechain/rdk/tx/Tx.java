package io.github.qorechain.rdk.tx;

import io.github.qorechain.rdk.accounts.Account;
import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import org.web3j.crypto.ECDSASignature;
import org.web3j.crypto.ECKeyPair;
import org.web3j.crypto.Sign;

/**
 * Hand-encodes the Cosmos transaction envelope and performs SIGN_MODE_DIRECT signing, mirroring the
 * reference clients exactly: Any / TxBody / secp256k1 PubKey / ModeInfo / SignerInfo / Coin / Fee /
 * AuthInfo / SignDoc / TxRaw, then sha256(SignDoc) → secp256k1 ECDSA → 64-byte r||s (low-S).
 */
public final class Tx {
    private Tx() {}

    private static final String TYPE_URL_SECP256K1_PUBKEY = "/cosmos.crypto.secp256k1.PubKey";

    /** SignMode SIGN_MODE_DIRECT (= 1). */
    private static final int SIGN_MODE_DIRECT = 1;

    /** A Cosmos coin (denom + amount). */
    public static final class Coin {
        public final String denom;
        public final String amount;

        public Coin(String denom, String amount) {
            this.denom = denom;
            this.amount = amount;
        }
    }

    /** A transaction fee: the coin amounts and a gas limit. */
    public static final class Fee {
        public final List<Coin> amount;
        public final long gasLimit;

        public Fee(List<Coin> amount, long gasLimit) {
            this.amount = amount;
            this.gasLimit = gasLimit;
        }
    }

    static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    /** Encode a {@code google.protobuf.Any{1:type_url, 2:value}}. */
    static byte[] encodeAny(String typeUrl, byte[] value) {
        ProtoWriter w = new ProtoWriter();
        w.writeRawString(1, typeUrl);
        w.writeRawBytes(2, value);
        return w.toByteArray();
    }

    /** Encode {@code TxBody{1:repeated Any messages, 2:string memo}}. */
    static byte[] encodeTxBody(List<Msg> messages, String memo) {
        ProtoWriter w = new ProtoWriter();
        for (Msg m : messages) {
            w.writeMessage(1, encodeAny(m.typeUrl(), m.marshal()));
        }
        w.writeString(2, memo);
        return w.toByteArray();
    }

    /** Encode a secp256k1 {@code PubKey{1:bytes compressed-33}}. */
    static byte[] encodePubKey(byte[] compressed) {
        ProtoWriter w = new ProtoWriter();
        w.writeRawBytes(1, compressed);
        return w.toByteArray();
    }

    /** Encode {@code ModeInfo{1:Single{1:enum sign_mode}}}. */
    static byte[] encodeModeInfoSingle(long signMode) {
        ProtoWriter single = new ProtoWriter();
        single.writeEnum(1, signMode);
        ProtoWriter w = new ProtoWriter();
        w.writeMessage(1, single.toByteArray());
        return w.toByteArray();
    }

    /** Encode {@code SignerInfo{1:Any public_key, 2:ModeInfo mode_info, 3:uint64 sequence}}. */
    static byte[] encodeSignerInfo(byte[] compressedPubKey, long sequence) {
        byte[] pubAny = encodeAny(TYPE_URL_SECP256K1_PUBKEY, encodePubKey(compressedPubKey));
        ProtoWriter w = new ProtoWriter();
        w.writeMessage(1, pubAny);
        w.writeMessage(2, encodeModeInfoSingle(SIGN_MODE_DIRECT));
        w.writeUint64(3, sequence);
        return w.toByteArray();
    }

    /** Encode {@code Coin{1:string denom, 2:string amount}}. */
    static byte[] encodeCoin(Coin c) {
        ProtoWriter w = new ProtoWriter();
        w.writeString(1, c.denom);
        w.writeString(2, c.amount);
        return w.toByteArray();
    }

    /** Encode {@code Fee{1:repeated Coin amount, 2:uint64 gas_limit}}. */
    static byte[] encodeFee(Fee fee) {
        ProtoWriter w = new ProtoWriter();
        for (Coin c : fee.amount) {
            w.writeMessage(1, encodeCoin(c));
        }
        w.writeUint64(2, fee.gasLimit);
        return w.toByteArray();
    }

    /** Encode {@code AuthInfo{1:repeated SignerInfo, 2:Fee}}. */
    static byte[] encodeAuthInfo(byte[] compressedPubKey, long sequence, Fee fee) {
        ProtoWriter w = new ProtoWriter();
        w.writeMessage(1, encodeSignerInfo(compressedPubKey, sequence));
        w.writeMessage(2, encodeFee(fee));
        return w.toByteArray();
    }

    /**
     * Encode {@code SignDoc{1:bytes body_bytes, 2:bytes auth_info_bytes, 3:string chain_id, 4:uint64
     * account_number}}.
     */
    static byte[] encodeSignDoc(byte[] bodyBytes, byte[] authInfoBytes, String chainId, long accountNumber) {
        ProtoWriter w = new ProtoWriter();
        w.writeRawBytes(1, bodyBytes);
        w.writeRawBytes(2, authInfoBytes);
        w.writeString(3, chainId);
        w.writeUint64(4, accountNumber);
        return w.toByteArray();
    }

    /** Encode {@code TxRaw{1:bytes body_bytes, 2:bytes auth_info_bytes, 3:repeated bytes signatures}}. */
    static byte[] encodeTxRaw(byte[] bodyBytes, byte[] authInfoBytes, List<byte[]> signatures) {
        ProtoWriter w = new ProtoWriter();
        w.writeRawBytes(1, bodyBytes);
        w.writeRawBytes(2, authInfoBytes);
        w.writeRepeatedBytes(3, signatures);
        return w.toByteArray();
    }

    /** Build the canonical SignDoc bytes for a transaction. */
    public static byte[] signDocBytes(
            List<Msg> messages,
            String memo,
            Fee fee,
            byte[] compressedPubKey,
            long sequence,
            String chainId,
            long accountNumber) {
        byte[] body = encodeTxBody(messages, memo);
        byte[] authInfo = encodeAuthInfo(compressedPubKey, sequence, fee);
        return encodeSignDoc(body, authInfo, chainId, accountNumber);
    }

    /**
     * Sign the sha256 digest of the SignDoc bytes with a secp256k1 private key and return the 64-byte
     * compact signature ({@code r || s}) with low-S enforced (the form Cosmos expects).
     */
    public static byte[] signSignDoc(byte[] signDocBytes, byte[] priv) {
        byte[] digest = sha256(signDocBytes);
        ECKeyPair keyPair = ECKeyPair.create(new BigInteger(1, priv));
        ECDSASignature sig = keyPair.sign(digest).toCanonicalised();
        byte[] out = new byte[64];
        System.arraycopy(Ecdsa.toFixed(sig.r, 32), 0, out, 0, 32);
        System.arraycopy(Ecdsa.toFixed(sig.s, 32), 0, out, 32, 32);
        return out;
    }

    /**
     * Verify a 64-byte compact ({@code r || s}) signature over the sha256 digest of the message
     * against a compressed secp256k1 public key.
     */
    public static boolean verifySignature(byte[] message, byte[] signature, byte[] compressedPubKey) {
        if (signature.length != 64) {
            return false;
        }
        byte[] digest = sha256(message);
        BigInteger r = new BigInteger(1, java.util.Arrays.copyOfRange(signature, 0, 32));
        BigInteger s = new BigInteger(1, java.util.Arrays.copyOfRange(signature, 32, 64));
        org.bouncycastle.math.ec.ECPoint pub;
        try {
            pub = Sign.CURVE_PARAMS.getCurve().decodePoint(compressedPubKey);
        } catch (RuntimeException e) {
            return false;
        }
        return Ecdsa.verify(digest, r, s, pub);
    }

    /**
     * Build, sign, and serialize a transaction into TxRaw bytes ready to broadcast.
     */
    public static byte[] signTx(
            Account account,
            List<Msg> messages,
            String memo,
            Fee fee,
            long sequence,
            String chainId,
            long accountNumber) {
        byte[] body = encodeTxBody(messages, memo);
        byte[] authInfo = encodeAuthInfo(account.publicKey, sequence, fee);
        byte[] signDoc = encodeSignDoc(body, authInfo, chainId, accountNumber);
        byte[] signature = signSignDoc(signDoc, account.privateKey);
        return encodeTxRaw(body, authInfo, List.of(signature));
    }
}
