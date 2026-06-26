package io.github.qorechain.rdk.accounts;

import io.github.qorechain.rdk.config.Constants;
import io.github.qorechain.rdk.util.Bech32;
import io.github.qorechain.rdk.util.Bytes;
import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import org.bouncycastle.crypto.digests.RIPEMD160Digest;
import org.web3j.crypto.Bip32ECKeyPair;
import org.web3j.crypto.MnemonicUtils;
import org.web3j.crypto.Sign;

/**
 * Account and signing helpers.
 *
 * <p>A native QoreChain account is derived from a BIP-39 mnemonic: BIP-39 seed → BIP-44 path
 * {@code m/44'/118'/0'/0/index} → compressed secp256k1 public key → {@code ripemd160(sha256(pubkey))}
 * → bech32 ({@code qor}) address.
 */
public final class Accounts {
    private Accounts() {}

    /**
     * Validate a BIP-39 mnemonic against its checksum. Never throws; returns false for invalid
     * input.
     */
    public static boolean validateMnemonic(String mnemonic) {
        return MnemonicUtils.validateMnemonic(mnemonic);
    }

    private static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static byte[] ripemd160(byte[] data) {
        RIPEMD160Digest d = new RIPEMD160Digest();
        d.update(data, 0, data.length);
        byte[] out = new byte[d.getDigestSize()];
        d.doFinal(out, 0);
        return out;
    }

    /** Left-pad/truncate a BigInteger to a fixed-length big-endian byte array. */
    static byte[] toFixed(BigInteger value, int length) {
        byte[] raw = value.toByteArray();
        byte[] out = new byte[length];
        if (raw.length == length) {
            return raw;
        }
        if (raw.length == length + 1 && raw[0] == 0) {
            System.arraycopy(raw, 1, out, 0, length);
            return out;
        }
        if (raw.length < length) {
            System.arraycopy(raw, 0, out, length - raw.length, raw.length);
            return out;
        }
        // raw longer than length: take the least-significant `length` bytes.
        System.arraycopy(raw, raw.length - length, out, 0, length);
        return out;
    }

    /** The 33-byte compressed secp256k1 public key for a private key. */
    static byte[] compressedPublicKey(BigInteger privateKey) {
        return Sign.publicPointFromPrivate(privateKey).getEncoded(true);
    }

    private static Account build(BigInteger privateKey, String prefix) {
        byte[] priv = toFixed(privateKey, 32);
        byte[] compressed = compressedPublicKey(privateKey);
        byte[] digest = ripemd160(sha256(compressed));
        String address = Bech32.encode(prefix, digest);
        return new Account(address, compressed, priv);
    }

    /**
     * Derive a native QoreChain account (Cosmos-style secp256k1) from a mnemonic at BIP-44 path
     * {@code m/44'/118'/0'/0/index}.
     */
    public static Account deriveNativeAccount(String mnemonic, int index) {
        if (!validateMnemonic(mnemonic)) {
            throw new IllegalArgumentException("invalid mnemonic");
        }
        byte[] seed = MnemonicUtils.generateSeed(mnemonic, "");
        Bip32ECKeyPair master = Bip32ECKeyPair.generateKeyPair(seed);
        int[] path = {
            44 | Bip32ECKeyPair.HARDENED_BIT,
            118 | Bip32ECKeyPair.HARDENED_BIT,
            0 | Bip32ECKeyPair.HARDENED_BIT,
            0,
            index
        };
        Bip32ECKeyPair derived = Bip32ECKeyPair.deriveKeyPair(master, path);
        return build(derived.getPrivateKey(), Constants.ACCOUNT_PREFIX);
    }

    /** Derive the default operator account ({@code index = 0}). */
    public static Account deriveNativeAccount(String mnemonic) {
        return deriveNativeAccount(mnemonic, 0);
    }

    /**
     * Build an {@link Account} from a 32-byte secp256k1 private key and the given bech32 prefix
     * (empty → account prefix).
     */
    public static Account accountFromPrivateKey(byte[] priv, String prefix) {
        if (priv.length != 32) {
            throw new IllegalArgumentException("private key must be 32 bytes, got " + priv.length);
        }
        String p = (prefix == null || prefix.isEmpty()) ? Constants.ACCOUNT_PREFIX : prefix;
        return build(new BigInteger(1, priv), p);
    }

    /** The outcome of resolving a signer from the environment. */
    public static final class SignerResult {
        /** The derived account, or {@code null} when no signer is configured. */
        public final Account account;
        /** True when a variable was present (even if it was malformed). */
        public final boolean present;

        SignerResult(Account account, boolean present) {
            this.account = account;
            this.present = present;
        }
    }

    /**
     * Build an operator {@link Account} from the environment, preferring a hex private key
     * ({@code QORE_OPERATOR_PRIVATE_KEY_HEX}) over a mnemonic ({@code QORE_MNEMONIC}). The prefix
     * selects the bech32 address prefix (empty → account prefix).
     *
     * <p>Returns a result with {@code present = false} when neither variable is set, so callers can
     * give a friendly message; throws when a variable is set but malformed.
     */
    public static SignerResult signerFromEnv(java.util.Map<String, String> env, String prefix) {
        String hex = trim(env.get("QORE_OPERATOR_PRIVATE_KEY_HEX"));
        String mnemonic = trim(env.get("QORE_MNEMONIC"));
        String p = (prefix == null || prefix.isEmpty()) ? Constants.ACCOUNT_PREFIX : prefix;
        if (!hex.isEmpty()) {
            byte[] priv = Bytes.hexToBytes(hex);
            return new SignerResult(accountFromPrivateKey(priv, p), true);
        }
        if (!mnemonic.isEmpty()) {
            Account acc = deriveNativeAccount(mnemonic, 0);
            if (!p.equals(Constants.ACCOUNT_PREFIX)) {
                acc = accountFromPrivateKey(acc.privateKey, p);
            }
            return new SignerResult(acc, true);
        }
        return new SignerResult(null, false);
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }
}
