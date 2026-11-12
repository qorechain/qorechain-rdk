package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.qledger.QledgerEntry;
import io.github.qorechain.rdk.qledger.QledgerExec;
import io.github.qorechain.rdk.qledger.QledgerFraud;
import io.github.qorechain.rdk.qledger.QledgerIncompleteWitnessException;
import io.github.qorechain.rdk.qledger.QledgerLedger;
import io.github.qorechain.rdk.qledger.QledgerPartialTree;
import io.github.qorechain.rdk.qledger.QledgerResult;
import io.github.qorechain.rdk.qledger.QledgerTree;
import io.github.qorechain.rdk.qledger.QledgerTx;
import io.github.qorechain.rdk.qledger.QledgerWithdrawal;
import io.github.qorechain.rdk.qledger.QledgerWitness;
import io.github.qorechain.rdk.util.Bytes;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** qledger-v1 matches the chain, against the {@code qledger} vectors in {@code v328.json}. */
class QledgerTest {
    private static final QledgerFixture Q = QledgerFixture.load();
    private static final List<QledgerEntry> ENTRIES = Q.qledgerEntries();

    private static byte[] h(String hex) {
        return Bytes.hexToBytes(hex);
    }

    private static String hex(byte[] b) {
        return Bytes.bytesToHex(b);
    }

    private static List<String> hexes(List<byte[]> bs) {
        List<String> out = new ArrayList<>();
        for (byte[] b : bs) {
            out.add(hex(b));
        }
        return out;
    }

    @Test
    void emptyRootCounterSlotAndAccountKeys() {
        assertEquals(Q.emptyRoot, hex(QledgerTree.emptyRoot()));
        assertEquals(Q.withdrawalCounterId, hex(QledgerExec.withdrawalCounterId()));
        for (QledgerFixture.Acct a : Q.accounts) {
            QledgerTx.Keypair kp = QledgerTx.keypairFromSeed(h(a.seed));
            assertEquals(a.publicKey, hex(kp.publicKey));
            assertEquals(a.id, hex(kp.accountId));
        }
        assertThrows(IllegalArgumentException.class, () -> QledgerTx.keypairFromSeed(new byte[31]));
    }

    @Test
    void signsTransactionsByteForByte() {
        QledgerTx.Keypair a = QledgerTx.keypairFromSeed(h(Q.accounts.get(0).seed));
        QledgerTx t1 =
                QledgerTx.signTransfer(
                        Q.chainId, Q.rollupId, a.secretKey, a.publicKey, 0, h(Q.accounts.get(1).id), 1_000_000);
        assertEquals(Q.txs.t1.unsigned, hex(t1.unsigned()));
        assertEquals(Q.txs.t1.signingMessage, hex(QledgerTx.signingMessage(Q.chainId, Q.rollupId, t1.unsigned())));
        assertEquals(Q.txs.t1.encoded, hex(t1.encode()));
        QledgerTx t2 = QledgerTx.signWithdrawal(Q.chainId, Q.rollupId, a.secretKey, a.publicKey, 1, Q.recipient, 700_000);
        assertEquals(Q.txs.t2.unsigned, hex(t2.unsigned()));
        assertEquals(Q.txs.t2.signingMessage, hex(QledgerTx.signingMessage(Q.chainId, Q.rollupId, t2.unsigned())));
        assertEquals(Q.txs.t2.encoded, hex(t2.encode()));

        QledgerTx parsed = QledgerTx.decode(h(Q.txs.t2.encoded));
        assertNotNull(parsed);
        assertEquals(Q.recipient, parsed.recipient);
        assertEquals(QledgerTx.KIND_WITHDRAW, parsed.kind);
        assertEquals(1, parsed.nonce);
        assertEquals(700_000, parsed.amount);
        assertTrue(parsed.verify(Q.chainId, Q.rollupId));
        assertFalse(parsed.verify(Q.chainId, "other-rollup"));
        assertFalse(parsed.verify("other-chain", Q.rollupId));
        QledgerTx p1 = QledgerTx.decode(h(Q.txs.t1.encoded));
        assertArrayEquals(h(Q.accounts.get(1).id), p1.to);
        assertTrue(p1.verify(Q.chainId, Q.rollupId));

        byte[] enc = h(Q.txs.t1.encoded);
        assertNull(QledgerTx.decode(Arrays.copyOf(enc, enc.length - 1)));
        assertNull(QledgerTx.decode(Arrays.copyOf(enc, enc.length + 1)));
        byte[] scheme2 = enc.clone();
        scheme2[1] = 2;
        assertNull(QledgerTx.decode(scheme2));
        assertNull(QledgerTx.decode(new byte[] {1}));

        // A recipient the chain would decode as a no-op is refused when signing.
        String tooLong = "qor1" + "q".repeat(87);
        assertEquals(91, tooLong.length());
        assertThrows(
                IllegalArgumentException.class,
                () -> QledgerTx.signWithdrawal(Q.chainId, Q.rollupId, a.secretKey, a.publicKey, 1, tooLong, 1));
        assertThrows(
                IllegalArgumentException.class,
                () -> QledgerTx.signWithdrawal(Q.chainId, Q.rollupId, a.secretKey, a.publicKey, 1, "", 1));
        String ninety = "q".repeat(90);
        assertEquals(90, QledgerTx.signWithdrawal(Q.chainId, Q.rollupId, a.secretKey, a.publicKey, 1, ninety, 1).recipient.length());
    }

    @Test
    void executesEveryEntryToTheChainsRoot() {
        QledgerLedger led = new QledgerLedger();
        for (int i = 0; i < ENTRIES.size(); i++) {
            QledgerExec.execute(Q.chainId, Q.rollupId, led, List.of(ENTRIES.get(i)));
            assertEquals(Q.entries.get(i).rootAfter, hex(led.root()), Q.entries.get(i).note);
        }
    }

    @Test
    void producesTheBatchRootsWithdrawalsAndProofs() {
        QledgerResult res = QledgerExec.execute(Q.chainId, Q.rollupId, new QledgerLedger(), ENTRIES);
        assertEquals(Q.batch.stateRoot, hex(res.stateRoot));
        assertEquals(Q.batch.withdrawalsRoot, hex(res.withdrawalsRoot));
        assertEquals(Q.batch.withdrawals.size(), res.withdrawals.size());
        for (int i = 0; i < res.withdrawals.size(); i++) {
            QledgerWithdrawal w = res.withdrawals.get(i);
            QledgerFixture.W want = Q.batch.withdrawals.get(i);
            assertEquals(want.index, w.index);
            assertEquals(want.recipient, w.recipient);
            assertEquals(want.amount, w.amount);
            assertEquals(want.leaf, hex(QledgerExec.withdrawalLeaf(Q.chainId, Q.rollupId, w.index, w.recipient, w.amount)));
            assertEquals(Q.batch.proofs.get(i), hexes(QledgerExec.withdrawalProof(Q.chainId, Q.rollupId, res.withdrawals, i)));
        }
        List<QledgerWithdrawal> later = new ArrayList<>();
        for (int k = 0; k < 3; k++) {
            later.add(new QledgerWithdrawal(5 + k, Q.recipient, k + 1));
        }
        assertEquals(Q.laterWithdrawals.root, hex(QledgerExec.withdrawalsRoot(Q.chainId, Q.rollupId, later)));
        assertEquals(Q.laterWithdrawals.proofOfIndex7, hexes(QledgerExec.withdrawalProof(Q.chainId, Q.rollupId, later, 2)));
        assertEquals(0, QledgerExec.withdrawalsRoot(Q.chainId, Q.rollupId, List.of()).length);
        assertThrows(
                IllegalArgumentException.class,
                () -> QledgerExec.withdrawalProof(Q.chainId, Q.rollupId, later, 3));
    }

    @Test
    void buildsTheChainsWitnessesAndAPartialTreeRecomputesTheRoot() {
        QledgerLedger led = new QledgerLedger();
        QledgerExec.execute(Q.chainId, Q.rollupId, led, ENTRIES);
        assertEquals(Q.witnessesAfterBatch.root, hex(led.root()));
        List<QledgerWitness> ws = new ArrayList<>();
        for (QledgerFixture.Wit w : Q.witnessesAfterBatch.witnesses) {
            QledgerWitness got = led.witness(h(w.id));
            assertEquals(w.id, hex(got.id));
            assertEquals(w.balance, got.balance);
            assertEquals(w.nonce, got.nonce);
            assertEquals(w.bitmap, hex(got.bitmap));
            assertEquals(w.siblings == null ? List.of() : w.siblings, hexes(got.siblings));
            ws.add(got);
        }
        QledgerPartialTree tree = new QledgerPartialTree(led.root(), ws);
        assertEquals(hex(led.root()), hex(tree.root()));
        byte[] id = h(Q.witnessesAfterBatch.witnesses.get(3).id);
        tree.set(id, 1, 0);
        led.set(id, 1, 0);
        assertEquals(hex(led.root()), hex(tree.root()));
        byte[] nines = new byte[32];
        Arrays.fill(nines, (byte) 9);
        QledgerIncompleteWitnessException e =
                assertThrows(QledgerIncompleteWitnessException.class, () -> tree.get(nines));
        assertTrue(e.getMessage().contains("does not open"));
        // A witness against another root is refused.
        assertThrows(IllegalArgumentException.class, () -> new QledgerPartialTree(QledgerTree.emptyRoot(), ws));
    }

    @Test
    void buildsTheChainsFraudProofAndDecidesItAsTheChainDoes() {
        QledgerLedger parent = new QledgerLedger();
        QledgerExec.execute(Q.chainId, Q.rollupId, parent, ENTRIES.subList(0, Q.fraud.entriesFrom));
        assertEquals(Q.fraud.parentRoot, hex(parent.root()));
        List<QledgerEntry> rest = ENTRIES.subList(Q.fraud.entriesFrom, ENTRIES.size());
        QledgerFraud.Built built = QledgerFraud.build(Q.chainId, Q.rollupId, parent, h(Q.batch.accFrom), rest);
        assertEquals(Q.fraud.proof, hex(built.proof));
        assertEquals(Q.fraud.honestStateRoot, hex(built.honest.stateRoot));
        assertEquals(Q.fraud.honestWithdrawalsRoot, hex(built.honest.withdrawalsRoot));
        assertEquals(Q.fraud.parentRoot, hex(parent.root()), "build leaves the parent alone");
        assertEquals(Q.fraud.proof, hex(QledgerFraud.encode(QledgerFraud.decode(built.proof))));

        QledgerFraud.Claim claim =
                new QledgerFraud.Claim(
                        Q.fraud.inboxStart,
                        Q.fraud.inboxEnd,
                        h(Q.fraud.dataHash),
                        h(Q.fraud.parentRoot),
                        h(Q.fraud.honestStateRoot),
                        h(Q.fraud.honestWithdrawalsRoot));
        assertFalse(QledgerFraud.check(Q.chainId, Q.rollupId, claim, built.proof));
        QledgerFraud.Claim wrong =
                new QledgerFraud.Claim(
                        claim.inboxStart, claim.inboxEnd, claim.dataHash, claim.prevStateRoot,
                        h(Q.fraud.wrongStateRoot), claim.withdrawalsRoot);
        assertTrue(QledgerFraud.check(Q.chainId, Q.rollupId, wrong, built.proof));
        QledgerFraud.Claim wrongWithdrawals =
                new QledgerFraud.Claim(
                        claim.inboxStart, claim.inboxEnd, claim.dataHash, claim.prevStateRoot,
                        claim.stateRoot, new byte[32]);
        assertTrue(QledgerFraud.check(Q.chainId, Q.rollupId, wrongWithdrawals, built.proof));

        QledgerFraud.Claim longer =
                new QledgerFraud.Claim(
                        claim.inboxStart, claim.inboxEnd + 1, claim.dataHash, claim.prevStateRoot,
                        claim.stateRoot, claim.withdrawalsRoot);
        assertTrue(
                assertThrows(IllegalArgumentException.class, () -> QledgerFraud.check(Q.chainId, Q.rollupId, longer, built.proof))
                        .getMessage()
                        .contains("does not apply"));
        QledgerFraud.Claim otherRange =
                new QledgerFraud.Claim(
                        claim.inboxStart, claim.inboxEnd, new byte[32], claim.prevStateRoot,
                        claim.stateRoot, claim.withdrawalsRoot);
        assertTrue(
                assertThrows(
                                IllegalArgumentException.class,
                                () -> QledgerFraud.check(Q.chainId, Q.rollupId, otherRange, built.proof))
                        .getMessage()
                        .contains("does not apply"));
        byte[] p = built.proof;
        assertThrows(IllegalArgumentException.class, () -> QledgerFraud.decode(Arrays.copyOf(p, p.length - 1)));
        assertThrows(IllegalArgumentException.class, () -> QledgerFraud.decode(Arrays.copyOf(p, p.length + 1)));
    }

    @Test
    void canonicalRecipientsAndDepositPayloads() {
        assertTrue(QledgerExec.isCanonicalQorAddress(Q.recipient));
        assertFalse(QledgerExec.isCanonicalQorAddress(Q.recipient.toUpperCase()));
        assertFalse(QledgerExec.isCanonicalQorAddress("cosmos1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnuddlrw"));
        QledgerEntry dep = ENTRIES.get(0);
        assertTrue(dep.poster.startsWith(QledgerTx.DEPOSIT_POSTER_PREFIX));
        assertEquals(hex(dep.payload), hex(QledgerTx.encodeDeposit(h(Q.accounts.get(0).id), 5_000_000)));
        QledgerTx.Deposit d = QledgerTx.decodeDeposit(dep.payload);
        assertEquals(Q.accounts.get(0).id, hex(d.account));
        assertEquals(5_000_000, d.amount);
        assertNull(QledgerTx.decodeDeposit(new byte[43]));
    }
}
