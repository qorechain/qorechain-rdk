package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.protobuf.InvalidProtocolBufferException;
import cosmos.tx.v1beta1.TxOuterClass.TxBody;
import cosmos.tx.v1beta1.TxOuterClass.TxRaw;
import io.github.qorechain.pqc.PqcKeypair;
import io.github.qorechain.rdk.accounts.Account;
import io.github.qorechain.rdk.accounts.Accounts;
import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.tx.HybridSigningOptions;
import io.github.qorechain.rdk.tx.Messages.CreateRollupInput;
import io.github.qorechain.rdk.tx.Msg;
import io.github.qorechain.rdk.tx.RdkTxClient;
import io.github.qorechain.rdk.tx.Tx;
import io.github.qorechain.rdk.tx.TxBackend.TxParams;
import io.github.qorechain.rdk.util.Bytes;
import io.github.qorechain.tx.Authenticator;
import io.github.qorechain.tx.HybridTx;
import io.github.qorechain.tx.SignBytes;
import io.github.qorechain.tx.SignBytesResolver.SignBytesResolutionException;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Hybrid (post-quantum) signing: the cross-language golden vectors and the sign-bytes choice. */
class HybridTxTest {

    private static final Golden G = Golden.load();
    private static final Golden.HybridTxSection H = G.hybridTx;

    private static Account signer() {
        Account acc = Accounts.deriveNativeAccount(G.mnemonic, 0);
        assertEquals(G.nativeAddress, acc.address);
        return acc;
    }

    private static PqcKeypair canonicalKey() {
        return Authenticator.derivePqcCanonical(G.nativeAddress, G.mnemonic);
    }

    private static TxParams vectorParams() {
        TxParams p = new TxParams();
        p.accountNumber = H.accountNumber;
        p.sequence = H.sequence;
        Map<String, String> coin = H.fee.amount.get(0);
        p.fee = new Tx.Fee(List.of(new Tx.Coin(coin.get("denom"), coin.get("amount"))), Long.parseLong(H.fee.gas));
        p.memo = H.memo;
        return p;
    }

    private static List<Msg> vectorMessages(RdkTxClient client) {
        assertEquals("/qorechain.rdk.v1.MsgPauseRollup", H.message.typeUrl);
        assertEquals(G.nativeAddress, H.message.creator);
        return List.<Msg>of(client.pauseRollup(H.message.rollupId, H.message.reason, null));
    }

    private static RdkTxClient vectorClient(SignBytes.Mode mode, boolean withKey, RdkClient rdk) {
        HybridSigningOptions opts = new HybridSigningOptions(canonicalKey(), withKey).signBytesVersion(mode);
        return new RdkTxClient(signer(), H.chainId, rdk == null ? null : rdk.rest, opts);
    }

    /** Compare TxRaw part by part first, so a mismatch names the part that differs. */
    private static void assertTxRaw(String expectedHex, byte[] actual) throws InvalidProtocolBufferException {
        TxRaw want = TxRaw.parseFrom(Bytes.hexToBytes(expectedHex));
        TxRaw got = TxRaw.parseFrom(actual);
        TxBody wantBody = TxBody.parseFrom(want.getBodyBytes());
        TxBody gotBody = TxBody.parseFrom(got.getBodyBytes());
        assertEquals(
                Bytes.bytesToHex(wantBody.toBuilder().clearExtensionOptions().build().toByteArray()),
                Bytes.bytesToHex(gotBody.toBuilder().clearExtensionOptions().build().toByteArray()),
                "body (without the PQC extension) differs");
        assertEquals(
                Bytes.bytesToHex(want.getAuthInfoBytes().toByteArray()),
                Bytes.bytesToHex(got.getAuthInfoBytes().toByteArray()),
                "authInfo differs");
        assertEquals(wantBody.getExtensionOptionsCount(), gotBody.getExtensionOptionsCount(), "extension count differs");
        assertEquals(
                Bytes.bytesToHex(wantBody.getExtensionOptions(0).toByteArray()),
                Bytes.bytesToHex(gotBody.getExtensionOptions(0).toByteArray()),
                "PQC extension (ML-DSA-87 signature / embedded key) differs");
        assertEquals(
                Bytes.bytesToHex(want.getSignatures(0).toByteArray()),
                Bytes.bytesToHex(got.getSignatures(0).toByteArray()),
                "classical secp256k1 signature differs");
        assertEquals(expectedHex, Bytes.bytesToHex(actual), "txRaw differs");
    }

    private static void checkVector(Golden.HybridVector v, SignBytes.Mode mode, boolean withKey) throws Exception {
        RdkTxClient client = vectorClient(mode, withKey, null);
        assertTrue(client.isHybrid());
        HybridTx.Built built = client.signHybrid(vectorMessages(client), vectorParams());
        assertEquals(v.pqcSignedMessageHex, Bytes.bytesToHex(built.pqcSignedMessage), "PQC signed message differs");
        assertTxRaw(v.txRawHex, built.txRawBytes);
        // sign() is the path broadcast and simulate use.
        assertEquals(v.txRawHex, Bytes.bytesToHex(client.sign(vectorMessages(client), vectorParams())));
    }

    @Test
    void goldenV1() throws Exception {
        checkVector(H.v1, SignBytes.Mode.V1, false);
    }

    @Test
    void goldenV1WithKey() throws Exception {
        checkVector(H.v1WithKey, SignBytes.Mode.V1, true);
    }

    @Test
    void goldenV2() throws Exception {
        checkVector(H.v2, SignBytes.Mode.V2, false);
    }

    @Test
    void goldenV2WithKey() throws Exception {
        checkVector(H.v2WithKey, SignBytes.Mode.V2, true);
    }

    // --- sign-bytes form resolved from the network (AUTO) ---

    private static RdkClient planClient(MockTransport transport) {
        RdkClient.Options o = new RdkClient.Options();
        o.network = "testnet";
        o.transport = transport;
        return new RdkClient(o);
    }

    private static MockTransport plans(String v320Height, String v3198Height) {
        return new MockTransport(
                req -> {
                    if (req.url.endsWith("/cosmos/upgrade/v1beta1/applied_plan/v3.2.0")) {
                        return new Transport.Response(200, "{\"height\":\"" + v320Height + "\"}");
                    }
                    if (req.url.endsWith("/cosmos/upgrade/v1beta1/applied_plan/v3.1.98")) {
                        return new Transport.Response(200, "{\"height\":\"" + v3198Height + "\"}");
                    }
                    return null;
                });
    }

    @Test
    void autoSignsV2OnceEitherUpgradeNameIsApplied() throws Exception {
        MockTransport t = plans("0", "1234");
        RdkTxClient client = vectorClient(SignBytes.Mode.AUTO, false, planClient(t));
        assertEquals(SignBytes.Version.V2, client.signBytesVersion());
        assertTxRaw(H.v2.txRawHex, client.sign(vectorMessages(client), vectorParams()));
        assertTrue(t.requests.stream().allMatch(r -> "GET".equals(r.method)));
    }

    @Test
    void autoSignsV1WhenNoUpgradeIsApplied() throws Exception {
        RdkTxClient client = vectorClient(SignBytes.Mode.AUTO, true, planClient(plans("0", "0")));
        assertEquals(SignBytes.Version.V1, client.signBytesVersion());
        assertTxRaw(H.v1WithKey.txRawHex, client.sign(vectorMessages(client), vectorParams()));
    }

    @Test
    void autoWithoutRestOnALegacyChainRefusesToGuess() {
        RdkTxClient client = vectorClient(SignBytes.Mode.AUTO, false, null);
        assertThrows(SignBytesResolutionException.class, client::signBytesVersion);
    }

    @Test
    void autoFailsLoudWhenTheNetworkCannotBeAsked() {
        MockTransport down = new MockTransport(req -> new Transport.Response(503, "{}"));
        RdkTxClient client = vectorClient(SignBytes.Mode.AUTO, false, planClient(down));
        assertThrows(SignBytesResolutionException.class, () -> client.sign(vectorMessages(client), vectorParams()));
    }

    @Test
    void autoOnANonLegacyChainIsV2WithoutAskingTheNetwork() {
        MockTransport t = plans("0", "0");
        RdkTxClient client =
                new RdkTxClient(signer(), "qorechain-next", planClient(t).rest, new HybridSigningOptions(canonicalKey()));
        assertEquals(SignBytes.Version.V2, client.signBytesVersion());
        assertTrue(t.requests.isEmpty());
    }

    // --- broadcast ---

    @Test
    void hybridBroadcastPostsTheHybridTx() throws Exception {
        MockTransport t =
                new MockTransport(
                        req -> {
                            if (req.url.endsWith("/cosmos/tx/v1beta1/txs")) {
                                return new Transport.Response(200, "{\"tx_response\":{\"code\":0,\"txhash\":\"AB\"}}");
                            }
                            return null;
                        });
        RdkTxClient client = vectorClient(SignBytes.Mode.V2, false, planClient(t));
        client.broadcast(vectorMessages(client), vectorParams());
        assertEquals(1, t.requests.size());
        Map<String, Object> payload = io.github.qorechain.rdk.client.Json.parseObject(t.requests.get(0).body);
        byte[] sent = Base64.getDecoder().decode((String) payload.get("tx_bytes"));
        assertTxRaw(H.v2.txRawHex, sent);
    }

    @Test
    void preflightStillRunsBeforeHybridSigning() {
        MockTransport t = new MockTransport(req -> new Transport.Response(200, "{}"));
        RdkTxClient client = vectorClient(SignBytes.Mode.V2, false, planClient(t));
        CreateRollupInput bad = new CreateRollupInput();
        bad.rollupId = "Bad Id!";
        bad.profile = "defi";
        bad.vmType = "evm";
        bad.stakeAmount = 1;
        assertThrows(
                IllegalArgumentException.class,
                () -> client.broadcast(List.<Msg>of(client.createRollup(bad)), vectorParams()));
        assertTrue(t.requests.isEmpty(), "nothing is signed or sent when preflight refuses");
    }

    // --- the classical path is unchanged ---

    /** The classical TxRaw for the vector input, exactly as the published 0.7.0 signs it. */
    private static final String CLASSICAL_VECTOR_TX_HEX =
            "0a650a5e0a202f716f7265636861696e2e72646b2e76312e4d73675061757365526f6c6c7570123a"
            + "0a2a716f723139726c34636d32686d7238616679346b6c6470787a33666b61346a67757130616774"
            + "36373268120c726f6c6c2d766563746f7273120372646b12670a500a460a1f2f636f736d6f732e63"
            + "727970746f2e736563703235366b312e5075624b657912230a21024f4e2ad99c34d60b9ba6283c94"
            + "31a8418af8673212961f97a77b6377fcd05b6212040a020801180312130a0d0a0475716f72120533"
            + "3030303010c09a0c1a40df0a83cbe9e8f19ce7c7bafdca7f82386b9e9f9c6e00f1f20586f56b201f"
            + "d92f03fef7527816ef465f3529a7cb0b2e84a231ef3983fe8ce07f126b82778284a9";

    @Test
    void withoutAPqcKeypairTheClassicalTxIsUnchanged() {
        Account acc = signer();
        RdkTxClient classical = new RdkTxClient(acc, H.chainId, null);
        assertFalse(classical.isHybrid());
        List<Msg> msgs = vectorMessages(classical);
        TxParams p = vectorParams();
        byte[] direct = Tx.signTx(acc, msgs, p.memo, p.fee, p.sequence, H.chainId, p.accountNumber);
        assertArrayEquals(direct, classical.sign(msgs, p));
        assertEquals(CLASSICAL_VECTOR_TX_HEX, Bytes.bytesToHex(classical.sign(msgs, p)));

        // Options without a keypair, or none at all, also mean classical.
        assertFalse(new RdkTxClient(acc, H.chainId, null, null).isHybrid());
        assertFalse(new RdkTxClient(acc, H.chainId, null, new HybridSigningOptions()).isHybrid());
        assertArrayEquals(direct, new RdkTxClient(acc, H.chainId, null, new HybridSigningOptions()).sign(msgs, p));
        assertThrows(IllegalStateException.class, () -> classical.signHybrid(msgs, p));
    }

    @Test
    void hybridOptionsAreCopiedAndCarriedThroughWithBackend() {
        HybridSigningOptions opts = new HybridSigningOptions(canonicalKey()).signBytesVersion(SignBytes.Mode.V1);
        RdkTxClient client = new RdkTxClient(signer(), H.chainId, null, opts);
        opts.signBytesVersion = SignBytes.Mode.V2;
        opts.includePqcPublicKey = true;
        assertEquals(SignBytes.Version.V1, client.signBytesVersion());
        assertFalse(client.hybrid.includePqcPublicKey);
        RdkTxClient copy = client.withBackend((signer, messages, params) -> Map.of());
        assertTrue(copy.isHybrid());
        assertNotNull(copy.withHybrid(null));
        assertFalse(copy.withHybrid(null).isHybrid());
    }
}
