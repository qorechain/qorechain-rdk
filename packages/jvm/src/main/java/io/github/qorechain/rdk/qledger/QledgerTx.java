package io.github.qorechain.rdk.qledger;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import org.bouncycastle.crypto.CryptoException;
import org.bouncycastle.crypto.params.ParametersWithContext;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPrivateKeyParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSAPublicKeyParameters;
import org.bouncycastle.pqc.crypto.mldsa.MLDSASigner;

/**
 * qledger-v1 transactions and deposits (chain v3.2.8+, {@code rdk-optimistic-reexec}).
 *
 * <p>A qledger-v1 rollup is a uqor account ledger. Its inputs are the rollup's inbox entries: user
 * posts carrying one signed transaction each, and deposit entries the chain appends for {@code
 * MsgDepositToRollup}.
 *
 * <pre>
 * tx       = 0x01 | scheme | public_key | kind | be64(nonce) | body | be64(amount) | signature
 * transfer = to[32]
 * withdraw = u8(len) | recipient (bech32)
 * </pre>
 *
 * <p>The only scheme is ML-DSA-44 ({@code scheme} 1), signed deterministically with the FIPS 204
 * context {@code "qledger/v1"} over {@code SHA-256("qledger/v1/tx" | lp(chain_id) | lp(rollup_id)
 * | unsigned)}.
 *
 * <p>Nonces and amounts are uint64 values carried in a {@code long} and read unsigned.
 */
public final class QledgerTx {
    /** ML-DSA-44, the only qledger-v1 account scheme. */
    public static final int SCHEME_MLDSA44 = 1;
    /** A transfer to another account. */
    public static final int KIND_TRANSFER = 1;
    /** A withdrawal to a {@code qor1} address on the chain. */
    public static final int KIND_WITHDRAW = 2;
    /** Longest withdrawal recipient (a bech32 address). */
    public static final int MAX_RECIPIENT_LEN = 90;
    /** Poster prefix of the inbox entries the chain writes for deposits. */
    public static final String DEPOSIT_POSTER_PREFIX = "deposit:";
    /** ML-DSA-44 public key size. */
    public static final int MLDSA44_PUBLIC_KEY_SIZE = 1312;
    /** ML-DSA-44 signature size. */
    public static final int MLDSA44_SIGNATURE_SIZE = 2420;

    private static final int TX_VERSION = 1;
    private static final byte[] CONTEXT = utf8("qledger/v1");
    private static final byte[] DEPOSIT_MAGIC = utf8("QLDP");

    public final int scheme;
    public final byte[] publicKey;
    public final int kind;
    public final long nonce;
    /** The 32-byte account id a transfer pays, or {@code null} for a withdrawal. */
    public final byte[] to;
    /** The {@code qor1} address a withdrawal pays, or {@code null} for a transfer. */
    public final String recipient;
    public final long amount;
    /** Empty for an unsigned transaction. */
    public final byte[] signature;

    public QledgerTx(
            int scheme,
            byte[] publicKey,
            int kind,
            long nonce,
            byte[] to,
            String recipient,
            long amount,
            byte[] signature) {
        this.scheme = scheme;
        this.publicKey = publicKey;
        this.kind = kind;
        this.nonce = nonce;
        this.to = to;
        this.recipient = recipient;
        this.amount = amount;
        this.signature = signature == null ? new byte[0] : signature;
    }

    /** An ML-DSA-44 account key pair and its account id. */
    public static final class Keypair {
        public final byte[] publicKey;
        /** The 32-byte seed the key pair derives from: what {@link #sign} takes. */
        public final byte[] secretKey;
        public final byte[] accountId;

        Keypair(byte[] publicKey, byte[] secretKey, byte[] accountId) {
            this.publicKey = publicKey;
            this.secretKey = secretKey;
            this.accountId = accountId;
        }
    }

    /** A parsed deposit payload. */
    public static final class Deposit {
        public final byte[] account;
        /** uint64, read unsigned. */
        public final long amount;

        Deposit(byte[] account, long amount) {
            this.account = account;
            this.amount = amount;
        }
    }

    static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    static byte[] sha256(byte[]... parts) {
        try {
            MessageDigest h = MessageDigest.getInstance("SHA-256");
            for (byte[] p : parts) {
                h.update(p);
            }
            return h.digest();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static byte[] be64(long v) {
        return ByteBuffer.allocate(8).putLong(v).array();
    }

    static byte[] u32(int v) {
        return ByteBuffer.allocate(4).putInt(v).array();
    }

    /** The account id a public key controls: {@code SHA-256("qledger/v1/account" | scheme | public_key)}. */
    public static byte[] accountId(byte[] publicKey, int scheme) {
        return sha256(utf8("qledger/v1/account"), new byte[] {(byte) scheme}, publicKey);
    }

    /** {@link #accountId(byte[], int)} for an ML-DSA-44 key. */
    public static byte[] accountId(byte[] publicKey) {
        return accountId(publicKey, SCHEME_MLDSA44);
    }

    /** An ML-DSA-44 account key pair from a 32-byte seed (FIPS 204 key generation), and its account id. */
    public static Keypair keypairFromSeed(byte[] seed) {
        if (seed == null || seed.length != 32) {
            throw new IllegalArgumentException(
                    "qledger: an ML-DSA-44 seed is 32 bytes, got " + (seed == null ? 0 : seed.length));
        }
        MLDSAPrivateKeyParameters sk = new MLDSAPrivateKeyParameters(MLDSAParameters.ml_dsa_44, seed);
        byte[] pk = sk.getPublicKeyParameters().getEncoded();
        return new Keypair(pk, seed.clone(), accountId(pk));
    }

    /** The encoding without the signature. */
    public byte[] unsigned() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(TX_VERSION);
        out.write(scheme);
        out.writeBytes(publicKey);
        out.write(kind);
        out.writeBytes(be64(nonce));
        if (kind == KIND_TRANSFER) {
            byte[] t = to == null ? new byte[32] : to;
            if (t.length != 32) {
                throw new IllegalArgumentException("qledger: a transfer's `to` is a 32-byte account id");
            }
            out.writeBytes(t);
        } else if (kind == KIND_WITHDRAW) {
            byte[] r = utf8(recipient == null ? "" : recipient);
            if (r.length > 255) {
                throw new IllegalArgumentException("qledger: recipient too long");
            }
            out.write(r.length);
            out.writeBytes(r);
        }
        out.writeBytes(be64(amount));
        return out.toByteArray();
    }

    /** The transaction as posted. */
    public byte[] encode() {
        byte[] u = unsigned();
        byte[] out = Arrays.copyOf(u, u.length + signature.length);
        System.arraycopy(signature, 0, out, u.length, signature.length);
        return out;
    }

    /** What an account signs: the transaction bound to one chain and one rollup. */
    public static byte[] signingMessage(String chainId, String rollupId, byte[] unsigned) {
        byte[] c = utf8(chainId);
        byte[] r = utf8(rollupId);
        return sha256(utf8("qledger/v1/tx"), u32(c.length), c, u32(r.length), r, unsigned);
    }

    private static MLDSAPrivateKeyParameters privateKey(byte[] secretKey) {
        if (secretKey == null) {
            throw new IllegalArgumentException("qledger: missing secret key");
        }
        // A 32-byte seed or the expanded FIPS 204 private key encoding.
        return new MLDSAPrivateKeyParameters(MLDSAParameters.ml_dsa_44, secretKey);
    }

    private static byte[] mldsaSign(byte[] secretKey, byte[] msg) {
        MLDSASigner signer = new MLDSASigner();
        // No ParametersWithRandom: the signature is deterministic (FIPS 204 rnd = 0^32).
        signer.init(true, new ParametersWithContext(privateKey(secretKey), CONTEXT));
        signer.update(msg, 0, msg.length);
        try {
            return signer.generateSignature();
        } catch (CryptoException e) {
            throw new IllegalStateException("qledger: ML-DSA-44 signing failed", e);
        }
    }

    /**
     * Build and sign (deterministically) a transfer to the 32-byte account id {@code to}. Post the
     * result's {@link #encode} with {@code postRollupData}; one transaction per post.
     *
     * @param secretKey the 32-byte seed ({@link Keypair#secretKey}) or the expanded private key
     */
    public static QledgerTx signTransfer(
            String chainId, String rollupId, byte[] secretKey, byte[] publicKey, long nonce, byte[] to, long amount) {
        if (to == null || to.length != 32) {
            throw new IllegalArgumentException("qledger: a transfer's `to` is a 32-byte account id");
        }
        return sign(chainId, rollupId, secretKey, new QledgerTx(SCHEME_MLDSA44, publicKey, KIND_TRANSFER, nonce, to.clone(), null, amount, null));
    }

    /**
     * Build and sign (deterministically) a withdrawal to the canonical {@code qor1} address {@code
     * recipient}. Post the result's {@link #encode} with {@code postRollupData}.
     *
     * @param secretKey the 32-byte seed ({@link Keypair#secretKey}) or the expanded private key
     */
    public static QledgerTx signWithdrawal(
            String chainId, String rollupId, byte[] secretKey, byte[] publicKey, long nonce, String recipient, long amount) {
        int len = recipient == null ? 0 : utf8(recipient).length;
        if (len == 0 || len > MAX_RECIPIENT_LEN) {
            // The chain would decode such a post as a no-op.
            throw new IllegalArgumentException(
                    "qledger: a withdrawal recipient is 1 to " + MAX_RECIPIENT_LEN + " bytes, got " + len);
        }
        return sign(chainId, rollupId, secretKey, new QledgerTx(SCHEME_MLDSA44, publicKey, KIND_WITHDRAW, nonce, null, recipient, amount, null));
    }

    /** Sign an unsigned transaction (its {@code signature} is ignored) and return the signed copy. */
    public static QledgerTx sign(String chainId, String rollupId, byte[] secretKey, QledgerTx tx) {
        byte[] msg = signingMessage(chainId, rollupId, tx.unsigned());
        byte[] sig = mldsaSign(secretKey, msg);
        return new QledgerTx(tx.scheme, tx.publicKey, tx.kind, tx.nonce, tx.to, tx.recipient, tx.amount, sig);
    }

    /** Parse a posted payload; {@code null} for anything that is not exactly one well-formed transaction. */
    public static QledgerTx decode(byte[] b) {
        if (b == null || b.length < 2 || b[0] != TX_VERSION || b[1] != SCHEME_MLDSA44) {
            return null;
        }
        ByteBuffer buf = ByteBuffer.wrap(b);
        int p = 2;
        if (b.length < p + MLDSA44_PUBLIC_KEY_SIZE + 1 + 8) {
            return null;
        }
        byte[] publicKey = Arrays.copyOfRange(b, p, p + MLDSA44_PUBLIC_KEY_SIZE);
        p += MLDSA44_PUBLIC_KEY_SIZE;
        int kind = b[p] & 0xff;
        p += 1;
        long nonce = buf.getLong(p);
        p += 8;
        byte[] to = null;
        String recipient = null;
        if (kind == KIND_TRANSFER) {
            if (b.length < p + 32) {
                return null;
            }
            to = Arrays.copyOfRange(b, p, p + 32);
            p += 32;
        } else if (kind == KIND_WITHDRAW) {
            if (b.length < p + 1) {
                return null;
            }
            int n = b[p] & 0xff;
            p += 1;
            if (n == 0 || n > MAX_RECIPIENT_LEN || b.length < p + n) {
                return null;
            }
            recipient = new String(b, p, n, StandardCharsets.UTF_8);
            p += n;
        } else {
            return null;
        }
        if (b.length != p + 8 + MLDSA44_SIGNATURE_SIZE) {
            return null;
        }
        long amount = buf.getLong(p);
        p += 8;
        return new QledgerTx(SCHEME_MLDSA44, publicKey, kind, nonce, to, recipient, amount, Arrays.copyOfRange(b, p, b.length));
    }

    /** Whether this transaction carries a valid signature for {@code chainId} / {@code rollupId}. */
    public boolean verify(String chainId, String rollupId) {
        if (scheme != SCHEME_MLDSA44
                || publicKey == null
                || publicKey.length != MLDSA44_PUBLIC_KEY_SIZE
                || signature.length != MLDSA44_SIGNATURE_SIZE) {
            return false;
        }
        byte[] msg = signingMessage(chainId, rollupId, unsigned());
        try {
            MLDSASigner verifier = new MLDSASigner();
            verifier.init(
                    false,
                    new ParametersWithContext(
                            new MLDSAPublicKeyParameters(MLDSAParameters.ml_dsa_44, publicKey), CONTEXT));
            verifier.update(msg, 0, msg.length);
            return verifier.verifySignature(signature);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** The payload of a deposit entry: {@code "QLDP" | account[32] | be64(amount)}. */
    public static byte[] encodeDeposit(byte[] account, long amount) {
        if (account == null || account.length != 32) {
            throw new IllegalArgumentException("qledger: an account id is 32 bytes");
        }
        ByteBuffer b = ByteBuffer.allocate(44);
        b.put(DEPOSIT_MAGIC).put(account).putLong(amount);
        return b.array();
    }

    /** Parse a deposit payload; {@code null} when it is not one. */
    public static Deposit decodeDeposit(byte[] b) {
        if (b == null || b.length != 44) {
            return null;
        }
        for (int i = 0; i < 4; i++) {
            if (b[i] != DEPOSIT_MAGIC[i]) {
                return null;
            }
        }
        return new Deposit(Arrays.copyOfRange(b, 4, 36), ByteBuffer.wrap(b).getLong(36));
    }
}
