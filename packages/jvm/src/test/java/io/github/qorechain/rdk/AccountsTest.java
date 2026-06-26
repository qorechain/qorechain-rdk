package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.accounts.Account;
import io.github.qorechain.rdk.accounts.Accounts;
import io.github.qorechain.rdk.accounts.Accounts.SignerResult;
import io.github.qorechain.rdk.util.Bech32;
import io.github.qorechain.rdk.util.Bytes;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AccountsTest {

    @Test
    void deriveNativeAccountMatchesGoldenAddress() {
        Golden g = Golden.load();
        Account acc = Accounts.deriveNativeAccount(g.mnemonic, 0);
        assertEquals(g.nativeAddress, acc.address);
        assertEquals(g.privateKeyHex, Bytes.bytesToHex(acc.privateKey));
        assertEquals(33, acc.publicKey.length);
    }

    @Test
    void accountFromGoldenPrivateKeyMatches() {
        Golden g = Golden.load();
        Account acc = Accounts.accountFromPrivateKey(Bytes.hexToBytes(g.privateKeyHex), "qor");
        assertEquals(g.nativeAddress, acc.address);
    }

    @Test
    void signerFromEnvPrefersHexOverMnemonic() {
        Golden g = Golden.load();
        Map<String, String> env = new HashMap<>();
        env.put("QORE_OPERATOR_PRIVATE_KEY_HEX", g.privateKeyHex);
        env.put("QORE_MNEMONIC", "this would be ignored");
        SignerResult result = Accounts.signerFromEnv(env, "qor");
        assertTrue(result.present);
        assertNotNull(result.account);
        assertEquals(g.nativeAddress, result.account.address);
    }

    @Test
    void signerFromEnvMnemonic() {
        Golden g = Golden.load();
        Map<String, String> env = new HashMap<>();
        env.put("QORE_MNEMONIC", g.mnemonic);
        SignerResult result = Accounts.signerFromEnv(env, "");
        assertTrue(result.present);
        assertEquals(g.nativeAddress, result.account.address);
    }

    @Test
    void signerFromEnvUnset() {
        SignerResult result = Accounts.signerFromEnv(new HashMap<>(), "");
        assertFalse(result.present);
        assertNull(result.account);
    }

    @Test
    void signerFromEnvInvalidHexThrows() {
        Map<String, String> env = new HashMap<>();
        env.put("QORE_OPERATOR_PRIVATE_KEY_HEX", "zzzz");
        assertThrows(IllegalArgumentException.class, () -> Accounts.signerFromEnv(env, ""));
    }

    @Test
    void bech32RoundTripsHex() {
        Golden g = Golden.load();
        String hex = Bech32.bech32ToHex(g.nativeAddress);
        String back = Bech32.hexToBech32(hex, "qor");
        assertEquals(g.nativeAddress, back);
        assertEquals("qor", Bech32.bech32Prefix(g.nativeAddress));
    }
}
