package io.github.qorechain.rdk.privpost;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.function.IntFunction;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.bouncycastle.crypto.SecretWithEncapsulation;
import org.bouncycastle.crypto.kems.MLKEMExtractor;
import org.bouncycastle.crypto.kems.MLKEMGenerator;
import org.bouncycastle.crypto.params.MLKEMParameters;
import org.bouncycastle.crypto.params.MLKEMPrivateKeyParameters;
import org.bouncycastle.crypto.params.MLKEMPublicKeyParameters;

/**
 * Private-rollup envelopes (chain v3.2.8+, {@code rdk-private-rollups}).
 *
 * <p>Every post on a private ({@code privacy = "encapsulated"}) rollup is an envelope: the data
 * encrypted once with AES-256-GCM under a fresh content key, and that key encapsulated with
 * ML-KEM-1024 to every member's key from the chain's KEM registry, with a key commitment so all
 * members open the same content. The chain checks the envelope's structure and that every entry
 * names a current member's current key; it never decrypts.
 *
 * <p>Posts, poster, timing, sizes, members, roots and withdrawals stay public.
 *
 * <p>Layout (all integers big-endian):
 *
 * <pre>
 * "QPRV" | 0x01 | be64(epoch) | key_commit(32) | be16(n)
 * n x ( be16(len) | member | fingerprint(32) | kem_ciphertext(1568) | wrapped_key(48) )
 * ciphertext (AES-256-GCM, zero nonce, AAD = everything before it)
 * </pre>
 *
 * <p>Every key here encrypts exactly one message, so the zero nonce is safe. ML-KEM-1024 comes from
 * the BouncyCastle provider the post-quantum signing already depends on.
 */
public final class Privpost {
    private Privpost() {}

    private static final byte[] MAGIC = "QPRV".getBytes(StandardCharsets.US_ASCII);
    private static final int VERSION = 1;
    /** ML-KEM-1024 ciphertext size. */
    public static final int KEM_CIPHERTEXT_SIZE = 1568;
    /** ML-KEM-1024 encapsulation (public) key size. */
    public static final int ENCAPSULATION_KEY_SIZE = 1568;
    /** ML-KEM-1024 expanded decapsulation (secret) key size. */
    public static final int DECAPSULATION_KEY_SIZE = 3168;
    /** ML-KEM-1024 key seed size ({@code d || z}). */
    public static final int KEY_SEED_SIZE = 64;
    private static final int WRAPPED_KEY_SIZE = 48;
    private static final int MIN_PAYLOAD_SIZE = 16;
    /** Most members (envelope entries) a private rollup can have. */
    public static final int MAX_ENVELOPE_MEMBERS = 32;
    private static final int MAX_ADDRESS_LEN = 128;
    private static final int GCM_TAG_BITS = 128;

    /** One member's entry in an envelope. */
    public static final class EnvelopeEntry {
        public final String member;
        /** SHA-256 of the member's ML-KEM-1024 encapsulation key. */
        public final byte[] fingerprint;
        public final byte[] kemCiphertext;
        public final byte[] wrappedKey;

        EnvelopeEntry(String member, byte[] fingerprint, byte[] kemCiphertext, byte[] wrappedKey) {
            this.member = member;
            this.fingerprint = fingerprint;
            this.kemCiphertext = kemCiphertext;
            this.wrappedKey = wrappedKey;
        }
    }

    /** A parsed envelope. */
    public static final class Envelope {
        /** The membership epoch (uint64, read unsigned). */
        public final long epoch;
        public final byte[] keyCommit;
        public final List<EnvelopeEntry> entries;
        public final byte[] ciphertext;
        /** Everything before {@code ciphertext}: the payload's additional data. */
        public final byte[] header;

        Envelope(long epoch, byte[] keyCommit, List<EnvelopeEntry> entries, byte[] ciphertext, byte[] header) {
            this.epoch = epoch;
            this.keyCommit = keyCommit;
            this.entries = entries;
            this.ciphertext = ciphertext;
            this.header = header;
        }
    }

    /** A recipient: a member address and its ML-KEM-1024 encapsulation key. */
    public static final class Recipient {
        public final String member;
        public final byte[] encapsulationKey;

        public Recipient(String member, byte[] encapsulationKey) {
            this.member = member;
            this.encapsulationKey = encapsulationKey;
        }
    }

    /** An ML-KEM-1024 key pair. */
    public static final class KemKeypair {
        /** The 1568-byte encapsulation key. */
        public final byte[] publicKey;
        /** The 3168-byte expanded decapsulation key. */
        public final byte[] secretKey;

        KemKeypair(byte[] publicKey, byte[] secretKey) {
            this.publicKey = publicKey;
            this.secretKey = secretKey;
        }
    }

    /** Thrown when an envelope is malformed, has no entry for a member, or does not open. */
    public static final class PrivpostException extends RuntimeException {
        public PrivpostException(String message) {
            super(message);
        }
    }

    // --- primitives ---

    private static byte[] sha256(byte[]... parts) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            for (byte[] p : parts) {
                d.update(p);
            }
            return d.digest();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] hmacSha256(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** HKDF-SHA256 (RFC 5869) with no salt, for an output of at most 32 bytes. */
    private static byte[] hkdf32(byte[] ikm, byte[] info) {
        byte[] prk = hmacSha256(new byte[32], ikm);
        byte[] in = Arrays.copyOf(info, info.length + 1);
        in[info.length] = 1;
        return hmacSha256(prk, in);
    }

    private static byte[] gcmSeal(byte[] key, byte[] plaintext, byte[] aad) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(GCM_TAG_BITS, new byte[12]));
            if (aad != null) {
                c.updateAAD(aad);
            }
            return c.doFinal(plaintext);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Opens AES-256-GCM with the zero nonce, or returns {@code null} when authentication fails. */
    private static byte[] gcmOpen(byte[] key, byte[] ciphertext, byte[] aad) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(GCM_TAG_BITS, new byte[12]));
            if (aad != null) {
                c.updateAAD(aad);
            }
            return c.doFinal(ciphertext);
        } catch (javax.crypto.AEADBadTagException e) {
            return null;
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] u16(int v) {
        return new byte[] {(byte) (v >>> 8), (byte) v};
    }

    private static byte[] u32(int v) {
        return ByteBuffer.allocate(4).putInt(v).array();
    }

    private static byte[] u64(long v) {
        return ByteBuffer.allocate(8).putLong(v).array();
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] wrapKey(byte[] sharedSecret, String chainId, String rollupId, long epoch, String member) {
        ByteArrayOutputStream info = new ByteArrayOutputStream();
        byte[] c = utf8(chainId);
        byte[] r = utf8(rollupId);
        byte[] m = utf8(member);
        info.writeBytes(utf8("qorechain/rdk/private/v1/wrap"));
        info.writeBytes(u32(c.length));
        info.writeBytes(c);
        info.writeBytes(u32(r.length));
        info.writeBytes(r);
        info.writeBytes(u64(epoch));
        info.writeBytes(u32(m.length));
        info.writeBytes(m);
        return hkdf32(sharedSecret, info.toByteArray());
    }

    private static byte[] keyCommit(byte[] contentKey) {
        return sha256(utf8("qorechain/rdk/private/v1/key"), contentKey);
    }

    /** The fingerprint the chain matches against a member's registered key: SHA-256 of the key. */
    public static byte[] kemKeyFingerprint(byte[] encapsulationKey) {
        return sha256(encapsulationKey);
    }

    // --- parse ---

    private static PrivpostException malformed(String why) {
        return new PrivpostException("privpost: malformed envelope: " + why);
    }

    /** Parse an envelope and check every size (not membership: the chain does that). */
    public static Envelope parseEnvelope(byte[] b) {
        if (b == null
                || b.length < 5 + 8 + 32 + 2
                || !Arrays.equals(Arrays.copyOfRange(b, 0, 4), MAGIC)
                || (b[4] & 0xff) != VERSION) {
            throw malformed("bad header");
        }
        ByteBuffer buf = ByteBuffer.wrap(b);
        int p = 5;
        long epoch = buf.getLong(p);
        p += 8;
        byte[] commit = Arrays.copyOfRange(b, p, p + 32);
        p += 32;
        int n = buf.getShort(p) & 0xffff;
        p += 2;
        if (n == 0 || n > MAX_ENVELOPE_MEMBERS) {
            throw malformed(n + " entries");
        }
        List<EnvelopeEntry> entries = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            if (b.length - p < 2) {
                throw malformed("truncated entry");
            }
            int al = buf.getShort(p) & 0xffff;
            p += 2;
            if (al == 0
                    || al > MAX_ADDRESS_LEN
                    || b.length - p < al + 32 + KEM_CIPHERTEXT_SIZE + WRAPPED_KEY_SIZE) {
                throw malformed("truncated entry");
            }
            String member = new String(b, p, al, StandardCharsets.UTF_8);
            p += al;
            byte[] fp = Arrays.copyOfRange(b, p, p + 32);
            p += 32;
            byte[] ct = Arrays.copyOfRange(b, p, p + KEM_CIPHERTEXT_SIZE);
            p += KEM_CIPHERTEXT_SIZE;
            byte[] wk = Arrays.copyOfRange(b, p, p + WRAPPED_KEY_SIZE);
            p += WRAPPED_KEY_SIZE;
            entries.add(new EnvelopeEntry(member, fp, ct, wk));
        }
        if (b.length - p < MIN_PAYLOAD_SIZE) {
            throw malformed("payload shorter than its tag");
        }
        return new Envelope(
                epoch,
                commit,
                Collections.unmodifiableList(entries),
                Arrays.copyOfRange(b, p, b.length),
                Arrays.copyOfRange(b, 0, p));
    }

    // --- keys ---

    /**
     * An ML-KEM-1024 key pair from a 64-byte seed ({@code d || z}), the form the chain's tooling
     * stores. The secret key (3168 bytes) or the seed both open envelopes.
     */
    public static KemKeypair kemKeypairFromSeed(byte[] seed) {
        if (seed == null || seed.length != KEY_SEED_SIZE) {
            throw new IllegalArgumentException(
                    "privpost: an ML-KEM-1024 seed is 64 bytes, got " + (seed == null ? 0 : seed.length));
        }
        MLKEMPrivateKeyParameters sk = new MLKEMPrivateKeyParameters(MLKEMParameters.ml_kem_1024, seed);
        return new KemKeypair(
                sk.getPublicKeyParameters().getEncoded(),
                sk.withPreferredFormat(MLKEMPrivateKeyParameters.EXPANDED_KEY).getEncoded());
    }

    private static MLKEMPrivateKeyParameters decapsulationKey(byte[] dk) {
        int n = dk == null ? 0 : dk.length;
        if (n != KEY_SEED_SIZE && n != DECAPSULATION_KEY_SIZE) {
            throw new IllegalArgumentException(
                    "privpost: an ML-KEM-1024 key is 64 (seed) or 3168 bytes, got " + n);
        }
        return new MLKEMPrivateKeyParameters(MLKEMParameters.ml_kem_1024, dk);
    }

    // --- seal / open ---

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private static byte[] secureRandom(int n) {
        byte[] out = new byte[n];
        SECURE_RANDOM.nextBytes(out);
        return out;
    }

    /**
     * Encrypt {@code plaintext} to {@code recipients} (in the rollup's member order) for a rollup at
     * its current membership epoch, with fresh randomness. Post the result with {@code
     * MsgPostRollupData}.
     */
    public static byte[] sealEnvelope(
            String chainId, String rollupId, long epoch, List<Recipient> recipients, byte[] plaintext) {
        return sealEnvelope(chainId, rollupId, epoch, recipients, plaintext, Privpost::secureRandom);
    }

    /**
     * {@link #sealEnvelope(String, String, long, List, byte[])} with an explicit randomness source
     * that returns {@code n} bytes per call: 32 for the content key, then 32 per recipient for the
     * ML-KEM encapsulation seed (FIPS 203 message {@code m}). Pass a deterministic one only in
     * tests.
     */
    public static byte[] sealEnvelope(
            String chainId,
            String rollupId,
            long epoch,
            List<Recipient> recipients,
            byte[] plaintext,
            IntFunction<byte[]> random) {
        int count = recipients == null ? 0 : recipients.size();
        if (count == 0 || count > MAX_ENVELOPE_MEMBERS) {
            throw new IllegalArgumentException(
                    "privpost: " + count + " recipients (1 to " + MAX_ENVELOPE_MEMBERS + ")");
        }
        byte[] contentKey = random.apply(32);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(MAGIC);
        out.write(VERSION);
        out.writeBytes(u64(epoch));
        out.writeBytes(keyCommit(contentKey));
        out.writeBytes(u16(count));
        for (Recipient r : recipients) {
            byte[] member = utf8(r.member == null ? "" : r.member);
            if (member.length == 0 || member.length > MAX_ADDRESS_LEN) {
                throw new IllegalArgumentException("privpost: member \"" + r.member + "\"");
            }
            byte[] ek = r.encapsulationKey;
            int ekLen = ek == null ? 0 : ek.length;
            if (ekLen != ENCAPSULATION_KEY_SIZE) {
                throw new IllegalArgumentException(
                        "privpost: key of " + r.member + " is " + ekLen + " bytes, want " + ENCAPSULATION_KEY_SIZE);
            }
            byte[] seed = random.apply(32);
            SecretWithEncapsulation enc =
                    MLKEMGenerator.internalGenerateEncapsulated(
                            new MLKEMPublicKeyParameters(MLKEMParameters.ml_kem_1024, ek), seed);
            byte[] wrapped = gcmSeal(wrapKey(enc.getSecret(), chainId, rollupId, epoch, r.member), contentKey, null);
            out.writeBytes(u16(member.length));
            out.writeBytes(member);
            out.writeBytes(kemKeyFingerprint(ek));
            out.writeBytes(enc.getEncapsulation());
            out.writeBytes(wrapped);
        }
        byte[] header = out.toByteArray();
        out.writeBytes(gcmSeal(contentKey, plaintext == null ? new byte[0] : plaintext, header));
        return out.toByteArray();
    }

    /**
     * Decrypt an envelope as {@code member}. {@code decapsulationKey} is the 64-byte seed or the
     * 3168-byte expanded secret key.
     *
     * @throws PrivpostException if the envelope is malformed, the member has no entry, the key does
     *     not open it, or the content key does not match the envelope's commitment.
     */
    public static byte[] openEnvelope(
            byte[] envelope, String chainId, String rollupId, String member, byte[] decapsulationKey) {
        Envelope e = parseEnvelope(envelope);
        MLKEMPrivateKeyParameters sk = decapsulationKey(decapsulationKey);
        EnvelopeEntry entry = null;
        for (EnvelopeEntry en : e.entries) {
            if (en.member.equals(member)) {
                entry = en;
                break;
            }
        }
        if (entry == null) {
            throw new PrivpostException("privpost: the envelope has no entry for this member");
        }
        byte[] ss = new MLKEMExtractor(sk).extractSecret(entry.kemCiphertext);
        byte[] contentKey = gcmOpen(wrapKey(ss, chainId, rollupId, e.epoch, member), entry.wrappedKey, null);
        if (contentKey == null) {
            throw new PrivpostException("privpost: the envelope does not open with this key");
        }
        if (!MessageDigest.isEqual(keyCommit(contentKey), e.keyCommit)) {
            throw new PrivpostException("privpost: the content key does not match the envelope's commitment");
        }
        byte[] pt = gcmOpen(contentKey, e.ciphertext, e.header);
        if (pt == null) {
            throw new PrivpostException("privpost: the envelope does not open with this key");
        }
        return pt;
    }

    /**
     * Why the chain would refuse {@code envelope} as a post on a private rollup, or {@code null} if
     * it would accept its structure. Mirrors the chain's check: the envelope's epoch is the
     * rollup's membership epoch, there is one entry per member in the rollup's order, and each
     * entry names that member's registered ML-KEM-1024 key. It does not decrypt.
     *
     * @param membersEpoch the rollup's membership epoch
     * @param members the rollup's members in order, each with its registered encapsulation key
     */
    public static String envelopeMembershipError(byte[] envelope, long membersEpoch, List<Recipient> members) {
        if (members == null || members.isEmpty()) {
            return "the rollup has no members yet";
        }
        Envelope e;
        try {
            e = parseEnvelope(envelope);
        } catch (PrivpostException err) {
            return err.getMessage();
        }
        if (e.epoch != membersEpoch) {
            return "envelope epoch "
                    + Long.toUnsignedString(e.epoch)
                    + ", the rollup's membership epoch is "
                    + Long.toUnsignedString(membersEpoch);
        }
        if (e.entries.size() != members.size()) {
            return e.entries.size() + " entries for " + members.size() + " members";
        }
        for (int i = 0; i < members.size(); i++) {
            Recipient want = members.get(i);
            EnvelopeEntry got = e.entries.get(i);
            if (!got.member.equals(want.member)) {
                return "entry " + i + " is for " + got.member + ", member " + i + " is " + want.member;
            }
            if (!MessageDigest.isEqual(got.fingerprint, kemKeyFingerprint(want.encapsulationKey))) {
                return "entry " + i + " does not name " + want.member + "'s registered KEM key";
            }
        }
        return null;
    }
}
