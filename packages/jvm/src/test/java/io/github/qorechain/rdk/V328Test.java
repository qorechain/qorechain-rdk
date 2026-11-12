package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import io.github.qorechain.rdk.accounts.Account;
import io.github.qorechain.rdk.accounts.Accounts;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.client.Views;
import io.github.qorechain.rdk.config.CreateRollupMsgInput;
import io.github.qorechain.rdk.config.Enums;
import io.github.qorechain.rdk.config.Enums.ProfileName;
import io.github.qorechain.rdk.config.Enums.ProofSystem;
import io.github.qorechain.rdk.config.Enums.SettlementParadigm;
import io.github.qorechain.rdk.config.Matrix;
import io.github.qorechain.rdk.config.RollupConfig;
import io.github.qorechain.rdk.config.Validate;
import io.github.qorechain.rdk.config.ValidationResult;
import io.github.qorechain.rdk.errors.RdkErrors;
import io.github.qorechain.rdk.inbox.Inbox;
import io.github.qorechain.rdk.presets.Presets;
import io.github.qorechain.rdk.privpost.Privpost;
import io.github.qorechain.rdk.privpost.Privpost.Recipient;
import io.github.qorechain.rdk.rules.Rules;
import io.github.qorechain.rdk.tx.Messages;
import io.github.qorechain.rdk.tx.Messages.CreateRollupInput;
import io.github.qorechain.rdk.tx.Messages.MsgPostRollupDataResponse;
import io.github.qorechain.rdk.tx.Messages.SetVerificationKeyInput;
import io.github.qorechain.rdk.tx.Messages.SubmitBatchInput;
import io.github.qorechain.rdk.tx.Msg;
import io.github.qorechain.rdk.tx.MockTxClient;
import io.github.qorechain.rdk.tx.RdkTxClient;
import io.github.qorechain.rdk.tx.TxBackend.TxParams;
import io.github.qorechain.rdk.util.Bytes;
import io.github.qorechain.rdk.zk.Zk;
import io.github.qorechain.rdk.zk.Zk.ZkBatchInputs;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.function.IntFunction;
import org.junit.jupiter.api.Test;

/** Chain v3.2.7 and v3.2.8 support, against the vectors in {@code v328.json}. */
class V328Test {

    static final class Fixture {
        InboxSection inbox;
        PrivpostSection privpost;
        Map<String, String> msgProtoHex;
        ZkSection zk;
    }

    static final class InboxSection {
        String chainId;
        String rollupId;
        List<Post> posts;
        String range_0_3;
        String range_1_3;
    }

    static final class Post {
        String acc;
        String dataHash;
        String dataHex;
        long height;
        String poster;
        long sequence;
    }

    static final class PrivpostSection {
        String chainId;
        String rollupId;
        String envelope;
        String envelopeSha256;
        long epoch;
        List<Member> members;
        String plaintextHex;
    }

    static final class Member {
        String ekSha256;
        String member;
        String seed;
    }

    static final class ZkSection {
        String modulus;
        List<ZkCase> cases;
    }

    static final class ZkCase {
        String value;
        boolean canonical;
        String reduced;
    }

    private static final Fixture V = load();

    private static Fixture load() {
        try (InputStream in = V328Test.class.getResourceAsStream("/v328.json")) {
            return new Gson().fromJson(new InputStreamReader(in, StandardCharsets.UTF_8), Fixture.class);
        } catch (Exception e) {
            throw new RuntimeException("failed to load v328.json", e);
        }
    }

    private static String hex(Msg m) {
        return Bytes.bytesToHex(m.marshal());
    }

    private static byte[] h(String hex) {
        return Bytes.hexToBytes(hex);
    }

    private static byte[] sha256(byte[] b) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(b);
    }

    // --- message bytes ---

    @Test
    void createRollupCarriesFields6To9() {
        CreateRollupInput in = new CreateRollupInput();
        in.creator = "qor1creator";
        in.rollupId = "my-rollup";
        in.profile = "nft";
        in.vmType = "native";
        in.stakeAmount = 10_000_000_000L;
        in.verificationKey = new byte[] {9, 8, 7};
        in.sequencing = "based";
        in.executionVm = "qledger-v1";
        in.privacy = "encapsulated";
        assertEquals(V.msgProtoHex.get("MsgCreateRollupV328"), hex(Messages.createRollupMsg(in)));
    }

    @Test
    void submitBatchCarriesInboxEnd() {
        SubmitBatchInput in = new SubmitBatchInput();
        in.sequencer = "qor1seq";
        in.rollupId = "r1";
        in.batchIndex = 7;
        in.stateRoot = new byte[] {1, 2, 3};
        in.txCount = 42;
        in.dataHash = new byte[] {9, 9};
        in.inboxEnd = 300;
        assertEquals(V.msgProtoHex.get("MsgSubmitBatchV328"), hex(Messages.submitBatchMsg(in)));
    }

    @Test
    void newMessagesMatchTheChainBytes() {
        SetVerificationKeyInput vk = new SetVerificationKeyInput();
        vk.creator = "qor1creator";
        vk.rollupId = "r1";
        vk.verificationKey = h("01020304");
        vk.proofSystem = "snark";
        Map<String, Msg> cases =
                Map.of(
                        "MsgSetVerificationKey", Messages.setVerificationKeyMsg(vk),
                        "MsgUpdateVerificationKey",
                                Messages.updateVerificationKeyMsg("qor1gov", "r1", h("0506"), "snark"),
                        "MsgPostRollupData",
                                Messages.postRollupDataMsg(
                                        "qor1poster", "r1", "hello".getBytes(StandardCharsets.UTF_8)),
                        "MsgSetRollupSequencing", Messages.setRollupSequencingMsg("qor1gov", "r1", "based"),
                        "MsgDepositToRollup",
                                Messages.depositToRollupMsg(
                                        "qor1dep", "r1", h("00".repeat(31) + "01"), 1_000_000L),
                        "MsgBondRollupSubmitter",
                                Messages.bondRollupSubmitterMsg("qor1sub", "r1", 1_000_000_000L),
                        "MsgUnbondRollupSubmitter", Messages.unbondRollupSubmitterMsg("qor1sub", "r1"),
                        "MsgSetRollupMembers",
                                Messages.setRollupMembersMsg("qor1creator", "r1", List.of("qor1a", "qor1b")),
                        "MsgRegisterKEMKey", Messages.registerKemKeyMsg("qor1member", h("01020304")));
        for (Map.Entry<String, Msg> e : cases.entrySet()) {
            assertNotNull(V.msgProtoHex.get(e.getKey()), e.getKey());
            assertEquals(V.msgProtoHex.get(e.getKey()), hex(e.getValue()), e.getKey());
        }
        assertEquals("/qorechain.pqc.v1.MsgRegisterKEMKey", cases.get("MsgRegisterKEMKey").typeUrl());
        assertEquals("/qorechain.rdk.v1.MsgSetRollupMembers", cases.get("MsgSetRollupMembers").typeUrl());
        assertEquals(2, Messages.registerKemKeyMsg("a", new byte[] {1}).algorithmId);
    }

    @Test
    void decodesPostRollupDataResponse() {
        MsgPostRollupDataResponse r =
                MsgPostRollupDataResponse.decode(h(V.msgProtoHex.get("MsgPostRollupDataResponse")));
        assertEquals(5, r.sequence);
        assertEquals("aabb", Bytes.bytesToHex(r.dataHash));
        assertEquals(V.msgProtoHex.get("MsgPostRollupDataResponse"), Bytes.bytesToHex(r.marshal()));
        assertEquals(7, Messages.MsgSetRollupMembersResponse.decode(h("0807")).epoch);
    }

    // --- inbox ---

    @Test
    void inboxAccumulatorAndRangeMatchTheChain() {
        InboxSection in = V.inbox;
        byte[] acc = new byte[0];
        List<byte[]> accs = new ArrayList<>();
        for (Post p : in.posts) {
            assertEquals(p.dataHash, Bytes.bytesToHex(Inbox.postedDataHash(h(p.dataHex))));
            acc = Inbox.inboxAccumulate(in.chainId, in.rollupId, acc, p.sequence, p.height, p.poster, h(p.dataHash));
            assertEquals(p.acc, Bytes.bytesToHex(acc));
            accs.add(acc);
        }
        assertEquals(
                in.range_0_3,
                Bytes.bytesToHex(Inbox.inboxRangeHash(in.chainId, in.rollupId, 0, 3, new byte[0], accs.get(2))));
        assertEquals(
                in.range_1_3,
                Bytes.bytesToHex(Inbox.inboxRangeHash(in.chainId, in.rollupId, 1, 3, accs.get(0), accs.get(2))));
        assertArrayEquals(
                Inbox.inboxRangeHash(in.chainId, in.rollupId, 0, 3, Inbox.emptyInboxAcc(), accs.get(2)),
                Inbox.inboxRangeHash(in.chainId, in.rollupId, 0, 3, null, accs.get(2)));
    }

    // --- zk ---

    @Test
    void classifiesAndReducesAgainstTheScalarModulus() {
        String mod = Zk.BLS12_381_SCALAR_MODULUS.toString(16);
        assertEquals(V.zk.modulus, "0".repeat(64 - mod.length()) + mod);
        for (ZkCase c : V.zk.cases) {
            assertEquals(c.canonical, Zk.isCanonicalScalar(h(c.value)), c.value);
            assertEquals(c.reduced, Bytes.bytesToHex(Zk.toCanonicalScalar(h(c.value))), c.value);
        }
        assertEquals(BigInteger.ZERO, new BigInteger(1, Zk.toCanonicalScalar(new byte[0])));
    }

    @Test
    void namesEachRefusedInputAndSkipsABoundDataHash() {
        byte[] high = h("ff".repeat(32));
        byte[] ok = h("00".repeat(31) + "01");
        assertEquals(List.of(), Zk.zkPublicInputErrors(new ZkBatchInputs(ok, ok, ok, null)));
        assertEquals(2, Zk.zkPublicInputErrors(new ZkBatchInputs(null, high, high, high)).size());
        assertEquals(List.of(), Zk.zkPublicInputErrors(new ZkBatchInputs(null, ok, high, null), true));
        assertEquals(List.of(), Zk.zkPublicInputErrors(new ZkBatchInputs(null, ok, null, new byte[0])));
        assertTrue(Zk.isDataHashChainBound("celestia", "based", null));
        assertTrue(Zk.isDataHashChainBound("native", "", high));
        assertFalse(Zk.isDataHashChainBound("native", "", new byte[0]));
        assertFalse(Zk.isDataHashChainBound("celestia", "", high));
    }

    // --- private-rollup envelopes ---

    private static List<Recipient> recipients() {
        List<Recipient> out = new ArrayList<>();
        for (Member m : V.privpost.members) {
            out.add(new Recipient(m.member, Privpost.kemKeypairFromSeed(h(m.seed)).publicKey));
        }
        return out;
    }

    /** Byte i of the stream is byte i mod 32 of SHA-256("qorechain-rdk-test-rand" || be64(i / 32)). */
    private static IntFunction<byte[]> testRandom() {
        long[] n = {0};
        return len -> {
            byte[] out = new byte[len];
            try {
                for (int i = 0; i < len; i++, n[0]++) {
                    MessageDigest d = MessageDigest.getInstance("SHA-256");
                    d.update("qorechain-rdk-test-rand".getBytes(StandardCharsets.UTF_8));
                    d.update(ByteBuffer.allocate(8).putLong(n[0] / 32).array());
                    out[i] = d.digest()[(int) (n[0] % 32)];
                }
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
            return out;
        };
    }

    @Test
    void opensTheChainsEnvelopeAsEachMember() {
        PrivpostSection p = V.privpost;
        Privpost.Envelope env = Privpost.parseEnvelope(h(p.envelope));
        assertEquals(p.epoch, env.epoch);
        assertEquals(p.members.size(), env.entries.size());
        for (int i = 0; i < p.members.size(); i++) {
            Member m = p.members.get(i);
            assertEquals(m.member, env.entries.get(i).member);
            Privpost.KemKeypair kp = Privpost.kemKeypairFromSeed(h(m.seed));
            assertEquals(Privpost.ENCAPSULATION_KEY_SIZE, kp.publicKey.length);
            assertEquals(Privpost.DECAPSULATION_KEY_SIZE, kp.secretKey.length);
            assertEquals(m.ekSha256, Bytes.bytesToHex(Privpost.kemKeyFingerprint(kp.publicKey)));
            byte[] fromSeed = Privpost.openEnvelope(h(p.envelope), p.chainId, p.rollupId, m.member, h(m.seed));
            assertEquals(p.plaintextHex, Bytes.bytesToHex(fromSeed));
            byte[] fromSecret = Privpost.openEnvelope(h(p.envelope), p.chainId, p.rollupId, m.member, kp.secretKey);
            assertEquals(p.plaintextHex, Bytes.bytesToHex(fromSecret));
        }
    }

    @Test
    void sealsByteForByteAsTheChainDoes() throws Exception {
        PrivpostSection p = V.privpost;
        byte[] env =
                Privpost.sealEnvelope(p.chainId, p.rollupId, p.epoch, recipients(), h(p.plaintextHex), testRandom());
        assertEquals(p.envelopeSha256, Bytes.bytesToHex(sha256(env)));
        assertEquals(p.envelope, Bytes.bytesToHex(env));
    }

    @Test
    void refusesAWrongMemberRollupOrTamperedPayloadAndMirrorsTheMembershipCheck() {
        PrivpostSection p = V.privpost;
        Member m = p.members.get(0);
        byte[] envelope = h(p.envelope);
        Privpost.PrivpostException e1 =
                assertThrows(
                        Privpost.PrivpostException.class,
                        () -> Privpost.openEnvelope(envelope, p.chainId, p.rollupId, "qor1nobody", h(m.seed)));
        assertTrue(e1.getMessage().contains("no entry"));
        Privpost.PrivpostException e2 =
                assertThrows(
                        Privpost.PrivpostException.class,
                        () -> Privpost.openEnvelope(envelope, p.chainId, "other", m.member, h(m.seed)));
        assertTrue(e2.getMessage().contains("does not open"));
        byte[] tampered = envelope.clone();
        tampered[tampered.length - 1] ^= 1;
        Privpost.PrivpostException e3 =
                assertThrows(
                        Privpost.PrivpostException.class,
                        () -> Privpost.openEnvelope(tampered, p.chainId, p.rollupId, m.member, h(m.seed)));
        assertTrue(e3.getMessage().contains("does not open"));

        List<Recipient> rs = recipients();
        byte[] pt = h(p.plaintextHex);
        byte[] fresh = Privpost.sealEnvelope(p.chainId, p.rollupId, 1, rs, pt);
        assertEquals(p.plaintextHex, Bytes.bytesToHex(
                Privpost.openEnvelope(fresh, p.chainId, p.rollupId, rs.get(1).member, h(p.members.get(1).seed))));
        assertNull(Privpost.envelopeMembershipError(fresh, 1, rs));
        assertTrue(Privpost.envelopeMembershipError(fresh, 2, rs).contains("epoch"));
        List<Recipient> reversed = new ArrayList<>(rs);
        Collections.reverse(reversed);
        assertTrue(Privpost.envelopeMembershipError(fresh, 1, reversed).contains("entry 0"));
        assertTrue(Privpost.envelopeMembershipError(fresh, 1, rs.subList(0, 1)).contains("2 entries"));
        assertTrue(Privpost.envelopeMembershipError(new byte[] {1, 2}, 1, rs).contains("malformed"));
    }

    // --- configuration rules ---

    @Test
    void optimisticPresetsRunQledgerAndAreBased() {
        for (ProfileName name : List.of(ProfileName.NFT, ProfileName.CUSTOM)) {
            assertEquals("qledger-v1", Presets.PRESET_DEFAULTS.get(name).executionVm);
            assertEquals("based", Presets.PRESET_DEFAULTS.get(name).sequencing);
            RollupConfig cfg = Presets.preset(name, c -> c.rollupId = "my-rollup").get();
            ValidationResult r = Validate.validateRollupConfig(cfg);
            assertEquals(List.of(), r.errors);
            CreateRollupMsgInput msg = Presets.preset(name, c -> c.rollupId = "my-rollup").toCreateMsg("qor1c", "1");
            assertEquals("qledger-v1", msg.executionVm);
            assertEquals("based", msg.sequencing);
        }
    }

    @Test
    void refusesAnOptimisticRollupWithoutAnExecutionVmAndStark() {
        RollupConfig custom =
                Presets.custom(
                                c -> {
                                    c.rollupId = "my-rollup";
                                    c.executionVm = "";
                                    c.sequencing = "";
                                })
                        .get();
        assertFalse(Validate.validateRollupConfig(custom).valid);
        assertFalse(Matrix.isProofCompatible(SettlementParadigm.ZK, ProofSystem.STARK));
        RollupConfig stark =
                Presets.defi(
                                c -> {
                                    c.rollupId = "my-rollup";
                                    c.proofSystem = ProofSystem.STARK;
                                })
                        .get();
        assertTrue(String.join(",", Validate.validateRollupConfig(stark).errors).contains("paused"));
        assertTrue(Enums.isPausedProofSystem("stark"));
        assertNotNull(ProofSystem.fromWire("stark"));
    }

    @Test
    void mirrorsTheChainsModeMatrix() {
        assertEquals(List.of(), Validate.rollupModeErrors("zk", "snark", "based", null, "encapsulated"));
        assertEquals(List.of(), Validate.rollupModeErrors("based", "none", "based", null, null));
        assertEquals(1, Validate.rollupModeErrors("sovereign", "none", "based", null, null).size());
        assertTrue(String.join(",", Validate.rollupModeErrors("zk", "snark", "based", "qledger-v1", null))
                .contains("optimistic"));
        assertTrue(String.join(",", Validate.rollupModeErrors("optimistic", "fraud", null, "qledger-v1", null))
                .contains("based"));
        assertFalse(Validate.rollupModeErrors("optimistic", "fraud", "based", "qledger-v1", "encapsulated").isEmpty());
        assertTrue(String.join(",", Validate.rollupModeErrors("based", "none", null, null, "encapsulated"))
                .contains("private rollup"));
        assertFalse(Validate.rollupModeErrors("zk", "snark", "sometimes", null, null).isEmpty());
    }

    @Test
    void letsANativeDataHashThroughOncePostedDataIsOn() {
        assertNotNull(Rules.dataHashError("native", h("ab")));
        assertNull(Rules.dataHashError("native", h("ab"), true));
    }

    @Test
    void namesTheV328Refusals() {
        assertEquals("invalid_rollup_mode", RdkErrors.decodeRdkTxError(48, "rdk", "").kind);
        assertEquals("stark_statement_unsupported", RdkErrors.decodeRdkTxError(52, "rdk", "").kind);
        assertEquals("invalid_inbox_range", RdkErrors.decodeRdkTxError(46, "rdk", "").kind);
        for (int code = 37; code <= 54; code++) {
            assertNotNull(RdkErrors.RDK_ERRORS.get(code), "code " + code);
        }
        assertTrue(RdkErrors.decodeRdkTxError(42, "rdk", "").message.contains("max_posted_data_bytes"));
        assertEquals("insufficient_funds", RdkErrors.decodeRdkTxError(5, "sdk", "x").kind);
    }

    // --- client pre-checks ---

    private static Account account() {
        return Accounts.deriveNativeAccount(
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    }

    @Test
    void clientBuildersCheckWhatTheChainWouldRefuse() {
        RdkTxClient c = new RdkTxClient(account(), "qorechain-diana", null);
        SetVerificationKeyInput stark = new SetVerificationKeyInput();
        stark.rollupId = "r1";
        stark.verificationKey = new byte[] {1};
        stark.proofSystem = "stark";
        assertThrows(IllegalArgumentException.class, () -> c.setVerificationKey(stark));
        assertThrows(IllegalArgumentException.class, () -> c.postRollupData("r1", new byte[0]));
        byte[] l2 = new byte[32];
        assertThrows(IllegalArgumentException.class, () -> c.depositToRollup("r1", l2, 1_000_000));
        l2[31] = 1;
        assertThrows(IllegalArgumentException.class, () -> c.depositToRollup("r1", l2, 999_999));
        assertThrows(IllegalArgumentException.class, () -> c.depositToRollup("r1", new byte[31], 1_000_000));
        assertEquals(c.account.address, c.depositToRollup("r1", l2, 1_000_000).depositor);
        assertThrows(IllegalArgumentException.class, () -> c.bondRollupSubmitter("r1", 0));
        assertThrows(IllegalArgumentException.class, () -> c.setRollupMembers("r1", List.of()));
        assertThrows(IllegalArgumentException.class, () -> c.setRollupMembers("r1", List.of("a", "a")));
        List<String> many = new ArrayList<>();
        for (int i = 0; i < 33; i++) {
            many.add("qor1m" + i);
        }
        assertThrows(IllegalArgumentException.class, () -> c.setRollupMembers("r1", many));
        assertThrows(IllegalArgumentException.class, () -> c.registerKemKey(new byte[1567]));
        assertEquals(2, c.registerKemKey(new byte[1568]).algorithmId);

        CreateRollupInput nft = new CreateRollupInput();
        nft.rollupId = "my-rollup";
        nft.profile = "nft";
        nft.vmType = "native";
        nft.stakeAmount = 1;
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> c.createRollup(nft));
        assertTrue(e.getMessage().contains("qledger-v1"));
        nft.executionVm = "qledger-v1";
        nft.sequencing = "based";
        assertEquals("qledger-v1", c.createRollup(nft).executionVm);
    }

    @Test
    void newMessagesBroadcastThroughABackend() {
        MockTxClient mock = new MockTxClient();
        RdkTxClient c = new RdkTxClient(account(), "qorechain-diana", null).withBackend(mock);
        c.broadcast(
                List.<Msg>of(
                        c.postRollupData("r1", new byte[] {1}),
                        c.unbondRollupSubmitter("r1"),
                        c.registerKemKey(new byte[1568])),
                new TxParams());
        assertEquals(1, mock.calls.size());
    }

    private static RestClient rest(Map<String, Object> rollup, Map<String, Boolean> features) {
        MockTransport t =
                new MockTransport(
                        req -> {
                            if (req.url.contains("/qorechain/rdk/v1/rollup/")) {
                                return new Transport.Response(200, new Gson().toJson(Map.of("rollup", rollup)));
                            }
                            if (req.url.endsWith("/qorechain/pqc/v1/protocol_features")) {
                                List<Map<String, Object>> fs = new ArrayList<>();
                                features.forEach((k, v) -> fs.add(Map.of("name", k, "enabled", v)));
                                return new Transport.Response(200, new Gson().toJson(Map.of("features", fs)));
                            }
                            return null;
                        });
        return new RestClient("http://node.test", t);
    }

    private static Messages.MsgSubmitBatch batch(byte[] stateRoot, byte[] dataHash, long inboxEnd) {
        SubmitBatchInput in = new SubmitBatchInput();
        in.sequencer = "qor1seq";
        in.rollupId = "r1";
        in.batchIndex = 3;
        in.stateRoot = stateRoot;
        in.dataHash = dataHash;
        in.inboxEnd = inboxEnd;
        return Messages.submitBatchMsg(in);
    }

    @Test
    void submitBatchPrechecksReadTheRollup() {
        byte[] ok = h("00".repeat(31) + "01");
        byte[] high = h("ff".repeat(32));
        RdkTxClient based =
                new RdkTxClient(
                        account(),
                        "qorechain-diana",
                        rest(
                                Map.of("settlement_mode", "zk", "proof_system", "snark", "da_backend", "native",
                                        "sequencing", "based"),
                                Map.of("rdk-zk-canonical-inputs", true)));
        assertTrue(assertThrows(IllegalArgumentException.class, () -> based.preflightSubmitBatch(batch(ok, high, 0)))
                .getMessage().contains("the rollup is based"));
        // A based rollup's data hash is bound by the chain, so only the state root is checked.
        based.preflightSubmitBatch(batch(ok, high, 5));
        assertTrue(assertThrows(IllegalArgumentException.class, () -> based.preflightSubmitBatch(batch(high, high, 5)))
                .getMessage().contains("state_root"));

        RdkTxClient plain =
                new RdkTxClient(
                        account(),
                        "qorechain-diana",
                        rest(Map.of("settlement_mode", "optimistic", "da_backend", "native"), Map.of()));
        assertTrue(assertThrows(IllegalArgumentException.class, () -> plain.preflightSubmitBatch(batch(ok, null, 5)))
                .getMessage().contains("inboxEnd must be 0"));
        assertTrue(assertThrows(IllegalArgumentException.class, () -> plain.preflightSubmitBatch(batch(ok, ok, 0)))
                .getMessage().contains("data_hash must be empty"));
        RdkTxClient posted =
                new RdkTxClient(
                        account(),
                        "qorechain-diana",
                        rest(Map.of("settlement_mode", "optimistic", "da_backend", "native"),
                                Map.of("rdk-post-rollup-data", true)));
        posted.preflightSubmitBatch(batch(ok, ok, 0));

        RdkTxClient stark =
                new RdkTxClient(
                        account(),
                        "qorechain-diana",
                        rest(Map.of("settlement_mode", "zk", "proof_system", "stark", "da_backend", "celestia"),
                                Map.of("rdk-stark-statement", true)));
        assertTrue(assertThrows(IllegalArgumentException.class, () -> stark.preflightSubmitBatch(batch(ok, null, 0)))
                .getMessage().contains("STARK settlement is paused"));
    }

    // --- views and REST ---

    @Test
    void viewsMapTheV328Fields() {
        Views.RollupView r =
                Views.mapRollupView(
                        Map.of(
                                "sequencing", "based",
                                "execution_vm", "qledger-v1",
                                "privacy", "encapsulated",
                                "members", List.of("qor1a", "qor1b"),
                                "members_epoch", "4",
                                "deposit_pool", "1000000"));
        assertEquals("based", r.sequencing);
        assertEquals("qledger-v1", r.executionVm);
        assertEquals("encapsulated", r.privacy);
        assertEquals(List.of("qor1a", "qor1b"), r.members);
        assertEquals(4, r.membersEpoch);
        assertEquals("1000000", r.depositPool);
        Views.RollupView empty = Views.mapRollupView(Map.of());
        assertEquals("", empty.sequencing);
        assertEquals("0", empty.depositPool);
        assertTrue(empty.members.isEmpty());

        Views.BatchView b = Views.mapBatchView(Map.of("inbox_start", "2", "inbox_end", "9"));
        assertEquals(2, b.inboxStart);
        assertEquals(9, b.inboxEnd);

        Views.ParamsView p =
                Views.mapParamsView(Map.of("max_posted_data_bytes", "65536", "min_submitter_bond", "1000000000"));
        assertEquals(65536L, p.maxPostedDataBytes);
        assertEquals("1000000000", p.minSubmitterBond);
        assertNull(p.postedDataFeePerByte);
        assertNull(Views.mapParamsView(Map.of()).minSubmitterBond);
    }

    @Test
    void restReadsTheV328Routes() {
        List<String> urls = new ArrayList<>();
        String ek = "ab".repeat(1568);
        MockTransport t =
                new MockTransport(
                        req -> {
                            urls.add(req.url);
                            String u = req.url;
                            if (u.contains("/inbox/")) {
                                return new Transport.Response(
                                        200, "{\"inbox\":{\"rollup_id\":\"r1\",\"head_sequence\":\"3\",\"range_end\":\"2\",\"range_data_hash\":\"aa\"}}");
                            }
                            if (u.contains("/posted_data/")) {
                                return new Transport.Response(
                                        200, "{\"posted_data\":{\"sequence\":\"2\",\"size\":\"10\",\"height\":\"107\"}}");
                            }
                            if (u.contains("/submitter_bond/")) {
                                return new Transport.Response(200, "{\"amount\":\"5\",\"unbond_after\":\"99\"}");
                            }
                            if (u.endsWith("/kem/qor1a") || u.endsWith("/kem/qor1b")) {
                                return new Transport.Response(
                                        200,
                                        "{\"found\":true,\"key\":{\"address\":\"x\",\"algorithm_id\":2,\"public_key\":\""
                                                + ek + "\",\"registered_height\":\"7\"}}");
                            }
                            if (u.endsWith("/kem/qor1c")) {
                                return new Transport.Response(200, "{\"found\":false}");
                            }
                            if (u.endsWith("/rollup/priv")) {
                                return new Transport.Response(
                                        200,
                                        "{\"rollup\":{\"privacy\":\"encapsulated\",\"members\":[\"qor1a\",\"qor1b\"],\"members_epoch\":\"6\"}}");
                            }
                            if (u.endsWith("/rollup/bad")) {
                                return new Transport.Response(
                                        200,
                                        "{\"rollup\":{\"privacy\":\"encapsulated\",\"members\":[\"qor1a\",\"qor1c\"],\"members_epoch\":\"6\"}}");
                            }
                            if (u.endsWith("/rollup/pub")) {
                                return new Transport.Response(200, "{\"rollup\":{\"privacy\":\"\"}}");
                            }
                            return null;
                        });
        RestClient rest = new RestClient("http://node.test", t);

        assertEquals(3, rest.getInbox("r1").headSequence);
        assertEquals("aa", rest.getInbox("r1", 2).rangeDataHash);
        assertEquals("http://node.test/qorechain/rdk/v1/inbox/r1", urls.get(0));
        assertEquals("http://node.test/qorechain/rdk/v1/inbox/r1?inbox_end=2", urls.get(1));
        assertEquals(107, rest.getPostedData("r1", 2).height);
        assertTrue(urls.get(2).endsWith("/qorechain/rdk/v1/posted_data/r1/2"));
        Views.SubmitterBondView bond = rest.getSubmitterBond("r1", "qor1s");
        assertEquals("5", bond.amount);
        assertEquals(99, bond.unbondAfter);
        assertTrue(urls.get(3).endsWith("/qorechain/rdk/v1/submitter_bond/r1/qor1s"));

        Views.KemKeyView key = rest.getKemKey("qor1a");
        assertEquals(2, key.algorithmId);
        assertEquals(ek, key.publicKey);
        assertEquals(7, key.registeredHeight);
        assertNull(rest.getKemKey("qor1c"));
        assertTrue(urls.get(urls.size() - 1).endsWith("/qorechain/pqc/v1/kem/qor1c"));

        RestClient.PrivateRollupRecipients rs = rest.getPrivateRollupRecipients("priv");
        assertEquals(6, rs.epoch);
        assertEquals(List.of("qor1a", "qor1b"), List.of(rs.recipients.get(0).member, rs.recipients.get(1).member));
        assertEquals(1568, rs.recipients.get(0).encapsulationKey.length);
        assertThrows(IllegalStateException.class, () -> rest.getPrivateRollupRecipients("bad"));
        assertThrows(IllegalStateException.class, () -> rest.getPrivateRollupRecipients("pub"));
    }
}
