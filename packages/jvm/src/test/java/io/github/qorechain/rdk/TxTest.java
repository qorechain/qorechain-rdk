package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.accounts.Account;
import io.github.qorechain.rdk.accounts.Accounts;
import io.github.qorechain.rdk.tx.Messages;
import io.github.qorechain.rdk.tx.Messages.MsgCreateRollup;
import io.github.qorechain.rdk.tx.Messages.MsgExecuteWithdrawal;
import io.github.qorechain.rdk.tx.Messages.MsgPauseRollup;
import io.github.qorechain.rdk.tx.Messages.MsgSubmitBatch;
import io.github.qorechain.rdk.tx.Msg;
import io.github.qorechain.rdk.tx.Tx;
import io.github.qorechain.rdk.util.Bytes;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class TxTest {

    @Test
    void msgProtoBytesMatchGolden() {
        Golden g = Golden.load();

        MsgCreateRollup createRollup = new MsgCreateRollup();
        createRollup.creator = "qor1creator";
        createRollup.rollupId = "my-rollup";
        createRollup.profile = "defi";
        createRollup.vmType = "evm";
        createRollup.stakeAmount = 10000000000L;

        MsgPauseRollup pauseRollup = new MsgPauseRollup();
        pauseRollup.creator = "qor1creator";
        pauseRollup.rollupId = "r1";
        pauseRollup.reason = "x";

        MsgSubmitBatch submitBatch = new MsgSubmitBatch();
        submitBatch.sequencer = "qor1seq";
        submitBatch.rollupId = "r";
        submitBatch.batchIndex = 7;
        submitBatch.stateRoot = new byte[] {0x01, 0x02, 0x03};
        submitBatch.prevStateRoot = new byte[] {0x04, 0x05};
        submitBatch.txCount = 42;
        submitBatch.dataHash = new byte[] {0x09, 0x09};
        submitBatch.proof = new byte[] {0x08};
        submitBatch.withdrawalsRoot = new byte[] {0x07, 0x07, 0x07};

        MsgExecuteWithdrawal executeWithdrawal = new MsgExecuteWithdrawal();
        executeWithdrawal.submitter = "qor1sub";
        executeWithdrawal.rollupId = "r";
        executeWithdrawal.batchIndex = 3;
        executeWithdrawal.withdrawalIndex = 1;
        executeWithdrawal.recipient = "qor1dest";
        executeWithdrawal.denom = "uqor";
        executeWithdrawal.amount = 500;
        List<byte[]> proof = new ArrayList<>();
        proof.add(new byte[] {0x01});
        proof.add(new byte[] {0x02, 0x02});
        executeWithdrawal.proof = proof;

        assertEquals(g.msgProtoHex.get("MsgCreateRollup"), Bytes.bytesToHex(createRollup.marshal()));
        assertEquals(g.msgProtoHex.get("MsgPauseRollup"), Bytes.bytesToHex(pauseRollup.marshal()));
        assertEquals(g.msgProtoHex.get("MsgSubmitBatch"), Bytes.bytesToHex(submitBatch.marshal()));
        assertEquals(
                g.msgProtoHex.get("MsgExecuteWithdrawal"),
                Bytes.bytesToHex(executeWithdrawal.marshal()));
    }

    @Test
    void typeUrlsMatch() {
        assertEquals("/qorechain.rdk.v1.MsgCreateRollup", Messages.TYPE_URL_MSG_CREATE_ROLLUP);
        assertEquals("/qorechain.rdk.v1.MsgSubmitBatch", new MsgSubmitBatch().typeUrl());
        assertEquals("/qorechain.rdk.v1.MsgExecuteWithdrawal", new MsgExecuteWithdrawal().typeUrl());
    }

    @Test
    void signSignDocRoundTripsThroughVerify() {
        Golden g = Golden.load();
        Account acc = Accounts.deriveNativeAccount(g.mnemonic, 0);

        MsgPauseRollup pause = new MsgPauseRollup();
        pause.creator = acc.address;
        pause.rollupId = "r1";
        pause.reason = "maintenance";

        Tx.Fee fee =
                new Tx.Fee(List.of(new Tx.Coin("uqor", "2000")), 120000);
        byte[] signDoc =
                Tx.signDocBytes(List.<Msg>of(pause), "", fee, acc.publicKey, 0, "qorechain-diana", 0);

        byte[] sig = Tx.signSignDoc(signDoc, acc.privateKey);
        assertEquals(64, sig.length);
        assertTrue(Tx.verifySignature(signDoc, sig, acc.publicKey));

        // A tampered message must not verify.
        byte[] tampered = signDoc.clone();
        tampered[tampered.length - 1] ^= 0x01;
        assertFalse(Tx.verifySignature(tampered, sig, acc.publicKey));
    }

    @Test
    void signTxProducesNonEmptyTxRaw() {
        Golden g = Golden.load();
        Account acc = Accounts.deriveNativeAccount(g.mnemonic, 0);
        MsgPauseRollup pause = new MsgPauseRollup();
        pause.creator = acc.address;
        pause.rollupId = "r1";
        Tx.Fee fee = new Tx.Fee(List.of(new Tx.Coin("uqor", "2000")), 120000);
        byte[] txRaw = Tx.signTx(acc, List.<Msg>of(pause), "", fee, 0, "qorechain-diana", 0);
        assertTrue(txRaw.length > 0);
    }
}
