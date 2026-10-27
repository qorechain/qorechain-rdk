package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.pqc.Pqc;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.rdk.accounts.Accounts;
import io.github.qorechain.rdk.accounts.Accounts.PqcDerivation;
import io.github.qorechain.rdk.accounts.Accounts.ResolvedPqcKeypair;
import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.tx.HybridSigningOptions;
import io.github.qorechain.rdk.util.Bytes;
import io.github.qorechain.tx.Authenticator;
import java.util.Arrays;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Finding the post-quantum key an account uses, checked against a mock chain. */
class PqcKeyResolutionTest {

    private static final Golden G = Golden.load();
    private static final String ADDRESS = G.nativeAddress;
    private static final PqcKeypair CANONICAL = Authenticator.derivePqcCanonical(ADDRESS, G.mnemonic);
    private static final PqcKeypair LEGACY = Authenticator.derivePqcLegacy(G.mnemonic);
    private static final byte[] SEED = filled(32, (byte) 0x42);

    private static byte[] filled(int n, byte b) {
        byte[] out = new byte[n];
        Arrays.fill(out, b);
        return out;
    }

    /** A chain with no PQC record for the account (the node answers 404). */
    private static RdkClient unregistered() {
        return chainWith(null);
    }

    /** A chain whose PQC record for the account holds {@code publicKey} (base64, as the node serves bytes). */
    private static RdkClient chainWith(byte[] publicKey) {
        MockTransport t =
                new MockTransport(
                        req -> {
                            if (publicKey != null && req.url.endsWith("/qorechain/pqc/v1/account/" + ADDRESS)) {
                                return new Transport.Response(
                                        200,
                                        "{\"account\":{\"address\":\""
                                                + ADDRESS
                                                + "\",\"public_key\":\""
                                                + java.util.Base64.getEncoder().encodeToString(publicKey)
                                                + "\",\"algorithm_id\":1,\"algorithm_name\":\"ML-DSA-87\"}}");
                            }
                            return null;
                        });
        RdkClient.Options o = new RdkClient.Options();
        o.transport = t;
        return new RdkClient(o);
    }

    @Test
    void canonicalDerivationMatchesTheGoldenSeedFormula() {
        // shake256("qorechain:pqc:v1|" + address + "|" + mnemonic), 32 bytes, as the seed.
        org.bouncycastle.crypto.digests.SHAKEDigest shake = new org.bouncycastle.crypto.digests.SHAKEDigest(256);
        byte[] in = ("qorechain:pqc:v1|" + ADDRESS + "|" + G.mnemonic).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        shake.update(in, 0, in.length);
        byte[] seed = new byte[32];
        shake.doFinal(seed, 0, 32);
        assertArrayEquals(Pqc.generatePqcKeypair(seed).publicKey, CANONICAL.publicKey);
        assertFalse(Arrays.equals(CANONICAL.publicKey, LEGACY.publicKey));
    }

    @Test
    void notRegisteredResolvesCanonicalAndEmbedsTheKey() {
        ResolvedPqcKeypair r = Accounts.resolvePqcKeypair(unregistered(), ADDRESS, G.mnemonic);
        assertEquals(PqcDerivation.CANONICAL, r.derivation);
        assertFalse(r.registered);
        assertTrue(r.includePqcPublicKey);
        assertArrayEquals(CANONICAL.publicKey, r.keypair.publicKey);

        HybridSigningOptions opts = HybridSigningOptions.from(r);
        assertTrue(opts.includePqcPublicKey);
        assertArrayEquals(CANONICAL.secretKey, opts.pqcKeypair.secretKey);
    }

    @Test
    void registeredCanonicalIsUsedWithoutEmbedding() {
        ResolvedPqcKeypair r = Accounts.resolvePqcKeypair(chainWith(CANONICAL.publicKey), ADDRESS, G.mnemonic);
        assertEquals(PqcDerivation.CANONICAL, r.derivation);
        assertTrue(r.registered);
        assertFalse(r.includePqcPublicKey);
        assertArrayEquals(CANONICAL.publicKey, r.keypair.publicKey);
    }

    @Test
    void registeredLegacyIsUsedWithoutEmbedding() {
        ResolvedPqcKeypair r = Accounts.resolvePqcKeypair(chainWith(LEGACY.publicKey), ADDRESS, G.mnemonic);
        assertEquals(PqcDerivation.LEGACY, r.derivation);
        assertTrue(r.registered);
        assertFalse(r.includePqcPublicKey);
        assertArrayEquals(LEGACY.publicKey, r.keypair.publicKey);
    }

    @Test
    void aForeignRegisteredKeyIsRefused() {
        byte[] foreign = Pqc.generatePqcKeypair(filled(32, (byte) 0x07)).publicKey;
        IllegalStateException e =
                assertThrows(
                        IllegalStateException.class,
                        () -> Accounts.resolvePqcKeypair(chainWith(foreign), ADDRESS, G.mnemonic));
        assertEquals(
                "account "
                        + ADDRESS
                        + " has a post-quantum key on chain that neither the canonical nor the legacy derivation of"
                        + " this mnemonic produces, so it was registered from another secret. Supply that keypair"
                        + " explicitly (QORE_PQC_SEED_HEX), or check that the mnemonic belongs to this account.",
                e.getMessage());
    }

    @Test
    void envSeedNotRegisteredIsEmbedded() {
        ResolvedPqcKeypair r =
                Accounts.pqcKeypairFromEnv(unregistered(), ADDRESS, Map.of("QORE_PQC_SEED_HEX", Bytes.bytesToHex(SEED)));
        assertEquals(PqcDerivation.SEED, r.derivation);
        assertFalse(r.registered);
        assertTrue(r.includePqcPublicKey);
        assertArrayEquals(Pqc.generatePqcKeypair(SEED).publicKey, r.keypair.publicKey);
    }

    @Test
    void envSeedMatchingTheRegisteredKey() {
        byte[] pub = Pqc.generatePqcKeypair(SEED).publicKey;
        ResolvedPqcKeypair r =
                Accounts.pqcKeypairFromEnv(
                        chainWith(pub), ADDRESS, Map.of("QORE_PQC_SEED_HEX", " 0x" + Bytes.bytesToHex(SEED) + " "));
        assertEquals(PqcDerivation.SEED, r.derivation);
        assertTrue(r.registered);
        assertFalse(r.includePqcPublicKey);
    }

    @Test
    void envSeedMismatchIsRefused() {
        IllegalStateException e =
                assertThrows(
                        IllegalStateException.class,
                        () ->
                                Accounts.pqcKeypairFromEnv(
                                        chainWith(CANONICAL.publicKey),
                                        ADDRESS,
                                        Map.of("QORE_PQC_SEED_HEX", Bytes.bytesToHex(SEED))));
        assertEquals(
                "QORE_PQC_SEED_HEX does not produce the post-quantum key registered for "
                        + ADDRESS
                        + "; every hybrid transaction signed with it would be refused",
                e.getMessage());
    }

    @Test
    void envSeedOfTheWrongLengthIsRefused() {
        IllegalArgumentException e =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> Accounts.pqcKeypairFromEnv(unregistered(), ADDRESS, Map.of("QORE_PQC_SEED_HEX", "abcd")));
        assertEquals("QORE_PQC_SEED_HEX must be 32 bytes, got 2", e.getMessage());
    }

    @Test
    void envSeedTakesPrecedenceOverTheMnemonic() {
        ResolvedPqcKeypair r =
                Accounts.pqcKeypairFromEnv(
                        unregistered(),
                        ADDRESS,
                        Map.of("QORE_PQC_SEED_HEX", Bytes.bytesToHex(SEED), "QORE_MNEMONIC", G.mnemonic));
        assertEquals(PqcDerivation.SEED, r.derivation);
    }

    @Test
    void envMnemonicResolvesAgainstTheChain() {
        ResolvedPqcKeypair r =
                Accounts.pqcKeypairFromEnv(
                        chainWith(LEGACY.publicKey), ADDRESS, Map.of("QORE_MNEMONIC", "  " + G.mnemonic + "\n"));
        assertEquals(PqcDerivation.LEGACY, r.derivation);
        assertTrue(r.registered);
    }

    @Test
    void envWithNoSourceIsNull() {
        assertNull(Accounts.pqcKeypairFromEnv(unregistered(), ADDRESS, Map.of()));
        assertNull(Accounts.pqcKeypairFromEnv(unregistered(), ADDRESS, Map.of("QORE_PQC_SEED_HEX", "  ", "QORE_MNEMONIC", "")));
    }
}
