package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import cosmos.tx.v1beta1.TxOuterClass.AuthInfo;
import cosmos.tx.v1beta1.TxOuterClass.TxBody;
import cosmos.tx.v1beta1.TxOuterClass.TxRaw;
import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.pqc.KeyIntegrity;
import io.github.qorechain.pqc.PqcDx;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.rdk.accounts.Account;
import io.github.qorechain.rdk.accounts.Accounts;
import io.github.qorechain.rdk.client.Json;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.tx.HybridSigningOptions;
import io.github.qorechain.rdk.tx.Msg;
import io.github.qorechain.rdk.tx.RdkTxClient;
import io.github.qorechain.rdk.tx.Tx;
import io.github.qorechain.rdk.tx.TxBackend.TxParams;
import io.github.qorechain.rdk.util.Bytes;
import io.github.qorechain.tx.Authenticator;
import io.github.qorechain.tx.SignBytes;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;
import qorechain.pqc.v1.Tx.MsgRegisterPQCKeyV2;

/**
 * Since chain v3.2.3 a key embedded in the hybrid signature extension is not registered on first
 * use, so a client whose key is not registered yet sends {@code MsgRegisterPQCKeyV2} first.
 */
class PqcRegistrationFirstTest {

    private static final Golden G = Golden.load();
    private static final String CHAIN_ID = G.hybridTx.chainId;
    private static final String TXS = "/cosmos/tx/v1beta1/txs";

    private static Account signer() {
        return Accounts.deriveNativeAccount(G.mnemonic, 0);
    }

    private static PqcKeypair key() {
        return Authenticator.derivePqcCanonical(G.nativeAddress, G.mnemonic);
    }

    private static RdkTxClient client(MockTransport t, boolean keyless) {
        HybridSigningOptions opts = new HybridSigningOptions(key(), keyless).signBytesVersion(SignBytes.Mode.V2);
        return new RdkTxClient(signer(), CHAIN_ID, new RestClient("https://rest.example", t), opts);
    }

    private static TxParams params() {
        TxParams p = new TxParams();
        p.accountNumber = 12;
        p.sequence = 3;
        p.fee = new Tx.Fee(List.of(new Tx.Coin("uqor", "30000")), 200000);
        p.memo = "rdk";
        return p;
    }

    private static List<Msg> pause(RdkTxClient c) {
        return List.<Msg>of(c.pauseRollup("roll-1", "maintenance", null));
    }

    /** A fake node: answers each broadcast in turn, and the registration's inclusion. */
    private static MockTransport node(List<String> broadcastAnswers, String deliveredRegistration) {
        List<String> answers = new ArrayList<>(broadcastAnswers);
        return new MockTransport(
                req -> {
                    if ("POST".equals(req.method) && req.url.endsWith(TXS)) {
                        return new Transport.Response(200, answers.remove(0));
                    }
                    if ("GET".equals(req.method) && req.url.endsWith(TXS + "/REG")) {
                        return new Transport.Response(200, deliveredRegistration);
                    }
                    return null;
                });
    }

    private static byte[] sentTx(Transport.Request req) {
        Map<String, Object> payload = Json.parseObject(req.body);
        return Base64.getDecoder().decode((String) payload.get("tx_bytes"));
    }

    private static boolean contains(byte[] hay, byte[] needle) {
        outer:
        for (int i = 0; i + needle.length <= hay.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return true;
        }
        return false;
    }

    private static final String OK_REG = "{\"tx_response\":{\"code\":0,\"txhash\":\"REG\"}}";
    private static final String OK_TX = "{\"tx_response\":{\"code\":0,\"txhash\":\"REAL\"}}";
    private static final String DELIVERED_OK = "{\"tx_response\":{\"code\":0,\"txhash\":\"REG\",\"height\":\"9\"}}";

    @Test
    void aKeylessClientRegistersItsKeyFirstThenSendsTheTransaction() throws Exception {
        MockTransport t = node(List.of(OK_REG, OK_TX), DELIVERED_OK);
        RdkTxClient c = client(t, true);
        PqcKeypair kp = key();

        Map<String, Object> res = c.broadcast(pause(c), params());

        assertEquals("REAL", ((Map<?, ?>) res.get("tx_response")).get("txhash"));
        assertEquals(3, t.requests.size());
        assertEquals("POST", t.requests.get(0).method);
        assertTrue(t.requests.get(1).url.endsWith(TXS + "/REG"), "waits for the registration to be included");
        assertEquals("POST", t.requests.get(2).method);

        // 1. MsgRegisterPQCKeyV2 alone, at the caller's sequence, fixed fee, key embedded.
        TxRaw reg = TxRaw.parseFrom(sentTx(t.requests.get(0)));
        TxBody regBody = TxBody.parseFrom(reg.getBodyBytes());
        assertEquals(1, regBody.getMessagesCount());
        assertEquals("/qorechain.pqc.v1.MsgRegisterPQCKeyV2", regBody.getMessages(0).getTypeUrl());
        MsgRegisterPQCKeyV2 m = MsgRegisterPQCKeyV2.parseFrom(regBody.getMessages(0).getValue());
        assertEquals(G.nativeAddress, m.getSender());
        assertArrayEquals(kp.publicKey, m.getPublicKey().toByteArray());
        assertEquals(1, m.getAlgorithmId());
        assertEquals("hybrid", m.getKeyType());
        assertTrue(m.getEcdsaPubkey().isEmpty());
        assertTrue(
                KeyIntegrity.verifyProofOfPossession(
                        CHAIN_ID, G.nativeAddress, kp.publicKey, m.getProofOfPossession().toByteArray()));
        assertEquals(
                "qorechain-pqc-pop-v1|" + CHAIN_ID + "|1|" + G.nativeAddress + "|"
                        + Bytes.bytesToHex(kp.publicKey).toLowerCase(Locale.ROOT),
                new String(
                        KeyIntegrity.proofOfPossessionSignBytes(CHAIN_ID, 1, G.nativeAddress, kp.publicKey),
                        StandardCharsets.UTF_8));
        AuthInfo regAuth = AuthInfo.parseFrom(reg.getAuthInfoBytes());
        assertEquals(600000, regAuth.getFee().getGasLimit());
        assertEquals("uqor", regAuth.getFee().getAmount(0).getDenom());
        assertEquals("90000", regAuth.getFee().getAmount(0).getAmount());
        assertEquals(3, regAuth.getSignerInfos(0).getSequence());
        assertTrue(contains(regBody.getExtensionOptions(0).toByteArray(), kp.publicKey));

        // 2. The transaction asked for, at the next sequence, without the embedded key.
        byte[] realBytes = sentTx(t.requests.get(2));
        TxRaw real = TxRaw.parseFrom(realBytes);
        TxBody realBody = TxBody.parseFrom(real.getBodyBytes());
        assertEquals("/qorechain.rdk.v1.MsgPauseRollup", realBody.getMessages(0).getTypeUrl());
        AuthInfo realAuth = AuthInfo.parseFrom(real.getAuthInfoBytes());
        assertEquals(4, realAuth.getSignerInfos(0).getSequence());
        assertEquals(200000, realAuth.getFee().getGasLimit());
        assertFalse(contains(realBody.getExtensionOptions(0).toByteArray(), kp.publicKey));
        assertFalse(c.hybrid.includePqcPublicKey);
        TxParams next = params();
        next.sequence = 4;
        assertArrayEquals(c.sign(pause(c), next), realBytes);

        // 3. Registered now: the next transaction goes straight out.
        MockTransport again = node(List.of(OK_TX), DELIVERED_OK);
        RdkTxClient registered = client(again, false);
        registered.broadcast(pause(registered), params());
        assertEquals(1, again.requests.size());
    }

    @Test
    void alreadyRegisteredIsAcceptedAndTheSequenceIsKept() throws Exception {
        String refused =
                "{\"tx_response\":{\"code\":7,\"codespace\":\"pqc\",\"txhash\":\"REG\","
                        + "\"raw_log\":\"PQC account already registered\"}}";
        MockTransport t = node(List.of(refused, OK_TX), DELIVERED_OK);
        RdkTxClient c = client(t, true);

        c.broadcast(pause(c), params());

        assertEquals(2, t.requests.size(), "a refused registration is not waited for");
        TxRaw real = TxRaw.parseFrom(sentTx(t.requests.get(1)));
        assertEquals("/qorechain.rdk.v1.MsgPauseRollup", TxBody.parseFrom(real.getBodyBytes()).getMessages(0).getTypeUrl());
        assertEquals(3, AuthInfo.parseFrom(real.getAuthInfoBytes()).getSignerInfos(0).getSequence());
        assertFalse(c.hybrid.includePqcPublicKey);
    }

    @Test
    void alreadyRegisteredWhenDeliveredIsAcceptedAtTheNextSequence() throws Exception {
        String delivered7 = "{\"tx_response\":{\"code\":7,\"codespace\":\"pqc\",\"txhash\":\"REG\",\"height\":\"9\"}}";
        MockTransport t = node(List.of(OK_REG, OK_TX), delivered7);
        RdkTxClient c = client(t, true);

        c.broadcast(pause(c), params());

        assertEquals(3, t.requests.size());
        TxRaw real = TxRaw.parseFrom(sentTx(t.requests.get(2)));
        assertEquals(4, AuthInfo.parseFrom(real.getAuthInfoBytes()).getSignerInfos(0).getSequence());
    }

    @Test
    void anyOtherRefusalStopsBeforeTheTransaction() {
        String refused = "{\"tx_response\":{\"code\":5,\"codespace\":\"sdk\",\"txhash\":\"REG\",\"raw_log\":\"insufficient funds\"}}";
        MockTransport t = node(List.of(refused), DELIVERED_OK);
        RdkTxClient c = client(t, true);

        IllegalStateException e = assertThrows(IllegalStateException.class, () -> c.broadcast(pause(c), params()));
        assertTrue(e.getMessage().contains("code 5"));
        assertTrue(e.getMessage().contains("insufficient funds"));
        assertEquals(1, t.requests.size());
        assertTrue(c.hybrid.includePqcPublicKey, "still unregistered");

        // Code 7 from another codespace is not "already registered".
        MockTransport t2 = node(List.of("{\"tx_response\":{\"code\":7,\"codespace\":\"sdk\",\"txhash\":\"REG\"}}"), DELIVERED_OK);
        RdkTxClient c2 = client(t2, true);
        assertThrows(IllegalStateException.class, () -> c2.broadcast(pause(c2), params()));
        assertEquals(1, t2.requests.size());
    }

    @Test
    void aRegistrationThatFailsInTheBlockStops() {
        String failed = "{\"tx_response\":{\"code\":231,\"codespace\":\"pqc\",\"txhash\":\"REG\",\"raw_log\":\"bad proof\"}}";
        MockTransport t = node(List.of(OK_REG), failed);
        RdkTxClient c = client(t, true);

        IllegalStateException e = assertThrows(IllegalStateException.class, () -> c.broadcast(pause(c), params()));
        assertTrue(e.getMessage().contains("code 231"));
        assertEquals(2, t.requests.size());
    }

    @Test
    void registrationOnlyMessagesAreSentAsTheyAre() throws Exception {
        PqcDx.Signer s = new PqcDx.Signer();
        s.sender = G.nativeAddress;
        s.pqcKeypair = key();
        TypedMessage typed = PqcDx.buildRegisterPqcKeyMsg(s, new PqcDx.EnsureOptions());
        byte[] encoded = typed.message.toByteArray();
        Msg own =
                new Msg() {
                    @Override
                    public String typeUrl() {
                        return typed.typeUrl;
                    }

                    @Override
                    public byte[] marshal() {
                        return encoded;
                    }
                };
        MockTransport t = node(List.of(OK_TX), DELIVERED_OK);
        RdkTxClient c = client(t, true);

        c.broadcast(List.of(own), params());

        assertEquals(1, t.requests.size());
        TxRaw sent = TxRaw.parseFrom(sentTx(t.requests.get(0)));
        assertEquals(3, AuthInfo.parseFrom(sent.getAuthInfoBytes()).getSignerInfos(0).getSequence());
        assertTrue(c.hybrid.includePqcPublicKey);
    }
}
