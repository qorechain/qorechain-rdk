package io.github.qorechain.rdk.accounts;

import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.config.Constants;
import io.github.qorechain.rdk.util.Bech32;
import io.github.qorechain.rdk.util.Bytes;
import io.github.qorechain.tx.Authenticator;
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
 *
 * <p>The post-quantum (ML-DSA-87) key that pairs with an account for hybrid signing is found with
 * {@link #resolvePqcKeypair} or {@link #pqcKeypairFromEnv}, using the QoreChain SDK's derivations.
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

    // --- post-quantum key resolution ---

    /** Which derivation produced an operator's post-quantum key. */
    public enum PqcDerivation {
        /** {@code shake256("qorechain:pqc:v1|" + account + "|" + mnemonic)}: address-bound. */
        CANONICAL,
        /** The older chain-bridge scheme: {@code shake256(mnemonic)}, the same key for every account. */
        LEGACY,
        /** A raw 32-byte seed ({@code QORE_PQC_SEED_HEX}). */
        SEED
    }

    /** The outcome of {@link #resolvePqcKeypair} / {@link #pqcKeypairFromEnv}. */
    public static final class ResolvedPqcKeypair {
        /** The ML-DSA-87 keypair to sign with. Its secret key is never logged. */
        public final PqcKeypair keypair;
        public final PqcDerivation derivation;
        /** The chain already holds this key for the account. */
        public final boolean registered;
        /**
         * Pass this as {@code includePqcPublicKey} to the tx client: true when the account has no
         * key on chain yet, so the first hybrid transaction registers it.
         */
        public final boolean includePqcPublicKey;

        ResolvedPqcKeypair(
                PqcKeypair keypair, PqcDerivation derivation, boolean registered, boolean includePqcPublicKey) {
            this.keypair = keypair;
            this.derivation = derivation;
            this.registered = registered;
            this.includePqcPublicKey = includePqcPublicKey;
        }
    }

    /**
     * Find the ML-DSA-87 keypair an account actually uses, by asking the chain.
     *
     * <p>A mnemonic can yield two post-quantum keys, and a wallet may have registered either: the
     * <b>canonical</b> one (address-bound, {@code shake256("qorechain:pqc:v1|" + account + "|" +
     * mnemonic)}, what unified accounts use) or the <b>legacy</b> one (the older chain-bridge
     * scheme). Signing with the wrong one is not a soft failure: the hybrid signature would not
     * match the registered key and every transaction would be refused. So this derives both and
     * returns whichever the chain has registered.
     *
     * <ul>
     *   <li>If the account has <b>no</b> key registered, it returns the canonical key with {@code
     *       includePqcPublicKey = true}, so the first transaction registers it.
     *   <li>If the account has a key that <b>neither</b> derivation produces, it throws: the key was
     *       registered from another secret, and guessing would only cost a refused transaction.
     *       Supply that keypair explicitly instead.
     * </ul>
     */
    public static ResolvedPqcKeypair resolvePqcKeypair(RdkClient client, String address, String mnemonic) {
        PqcKeypair canonical = Authenticator.derivePqcCanonical(address, mnemonic);
        PqcKeypair legacy = Authenticator.derivePqcLegacy(mnemonic);
        String registeredKey = registeredPqcKey(client, address);

        if (registeredKey.isEmpty()) {
            return new ResolvedPqcKeypair(canonical, PqcDerivation.CANONICAL, false, true);
        }
        if (registeredKey.equals(Bytes.bytesToHex(canonical.publicKey).toLowerCase())) {
            return new ResolvedPqcKeypair(canonical, PqcDerivation.CANONICAL, true, false);
        }
        if (registeredKey.equals(Bytes.bytesToHex(legacy.publicKey).toLowerCase())) {
            return new ResolvedPqcKeypair(legacy, PqcDerivation.LEGACY, true, false);
        }
        throw new IllegalStateException(
                "account "
                        + address
                        + " has a post-quantum key on chain that neither the canonical nor the legacy "
                        + "derivation of this mnemonic produces, so it was registered from another secret. Supply that "
                        + "keypair explicitly (QORE_PQC_SEED_HEX), or check that the mnemonic belongs to this account.");
    }

    private static String registeredPqcKey(RdkClient client, String address) {
        try {
            return client.rest.getPqcAccount(address).publicKey.toLowerCase();
        } catch (RuntimeException e) {
            // An account with no record reads as "not registered".
            return "";
        }
    }

    /**
     * The operator's ML-DSA-87 keypair from the environment, checked against the chain, or {@code
     * null} when no source is configured (the caller then signs classical-only, which both public
     * networks refuse on the native lane).
     *
     * <ul>
     *   <li>{@code QORE_MNEMONIC}: resolved with {@link #resolvePqcKeypair}, whichever of the
     *       canonical and legacy derivations the chain has registered.
     *   <li>{@code QORE_PQC_SEED_HEX}: a 32-byte ML-DSA-87 seed, for an operator who signs with a raw
     *       private key ({@code QORE_OPERATOR_PRIVATE_KEY_HEX}) and so has no mnemonic to derive
     *       from. Takes precedence when set. Still checked against the chain, and refused if the
     *       account holds a different key.
     * </ul>
     */
    public static ResolvedPqcKeypair pqcKeypairFromEnv(
            RdkClient client, String address, java.util.Map<String, String> env) {
        String seedHex = trim(env.get("QORE_PQC_SEED_HEX"));
        if (!seedHex.isEmpty()) {
            byte[] seed = Bytes.hexToBytes(seedHex);
            if (seed.length != 32) {
                throw new IllegalArgumentException("QORE_PQC_SEED_HEX must be 32 bytes, got " + seed.length);
            }
            PqcKeypair keypair = Pqc.generatePqcKeypair(seed);
            String registeredKey = registeredPqcKey(client, address);
            if (registeredKey.isEmpty()) {
                return new ResolvedPqcKeypair(keypair, PqcDerivation.SEED, false, true);
            }
            if (registeredKey.equals(Bytes.bytesToHex(keypair.publicKey).toLowerCase())) {
                return new ResolvedPqcKeypair(keypair, PqcDerivation.SEED, true, false);
            }
            throw new IllegalStateException(
                    "QORE_PQC_SEED_HEX does not produce the post-quantum key registered for "
                            + address
                            + "; every hybrid transaction signed with it would be refused");
        }
        String mnemonic = trim(env.get("QORE_MNEMONIC"));
        if (!mnemonic.isEmpty()) {
            return resolvePqcKeypair(client, address, mnemonic);
        }
        return null;
    }

    /** {@link #pqcKeypairFromEnv(RdkClient, String, java.util.Map)} over the process environment. */
    public static ResolvedPqcKeypair pqcKeypairFromEnv(RdkClient client, String address) {
        return pqcKeypairFromEnv(client, address, System.getenv());
    }
}
