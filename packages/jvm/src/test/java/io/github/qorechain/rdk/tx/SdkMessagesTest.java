package io.github.qorechain.rdk.tx;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.github.qorechain.messages.TypedMessage;
import io.github.qorechain.rdk.tx.Messages.MsgChallengeBatch;
import io.github.qorechain.rdk.tx.Messages.MsgCreateRollup;
import io.github.qorechain.rdk.tx.Messages.MsgExecuteWithdrawal;
import io.github.qorechain.rdk.tx.Messages.MsgPauseRollup;
import io.github.qorechain.rdk.tx.Messages.MsgResolveChallenge;
import io.github.qorechain.rdk.tx.Messages.MsgResumeRollup;
import io.github.qorechain.rdk.tx.Messages.MsgStopRollup;
import io.github.qorechain.rdk.tx.Messages.MsgSubmitBatch;
import io.github.qorechain.tx.StdFee;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The RDK's own encodings reach the SDK's hybrid builder byte-for-byte. */
class SdkMessagesTest {

    private static List<Msg> everyMessage() {
        MsgCreateRollup create = new MsgCreateRollup();
        create.creator = "qor1creator";
        create.rollupId = "my-rollup";
        create.profile = "defi";
        create.vmType = "evm";
        create.stakeAmount = 10000000000L;

        MsgSubmitBatch batch = new MsgSubmitBatch();
        batch.sequencer = "qor1seq";
        batch.rollupId = "r";
        batch.batchIndex = 7;
        batch.stateRoot = new byte[] {1, 2, 3};
        batch.prevStateRoot = new byte[] {4, 5};
        batch.txCount = 42;
        batch.dataHash = new byte[] {9, 9};
        batch.proof = new byte[] {8};
        batch.withdrawalsRoot = new byte[] {7, 7, 7};

        MsgChallengeBatch challenge = new MsgChallengeBatch();
        challenge.challenger = "qor1ch";
        challenge.rollupId = "r";
        challenge.batchIndex = 3;
        challenge.proof = new byte[] {1, 2};

        MsgResolveChallenge resolve = new MsgResolveChallenge();
        resolve.resolver = "qor1res";
        resolve.rollupId = "r";
        resolve.batchIndex = 3;
        resolve.fraudUpheld = true;

        MsgPauseRollup pause = new MsgPauseRollup();
        pause.creator = "qor1creator";
        pause.rollupId = "r1";
        pause.reason = "x";

        MsgResumeRollup resume = new MsgResumeRollup();
        resume.creator = "qor1creator";
        resume.rollupId = "r1";

        MsgStopRollup stop = new MsgStopRollup();
        stop.creator = "qor1creator";
        stop.rollupId = "r1";

        MsgExecuteWithdrawal withdrawal = new MsgExecuteWithdrawal();
        withdrawal.submitter = "qor1sub";
        withdrawal.rollupId = "r";
        withdrawal.batchIndex = 3;
        withdrawal.withdrawalIndex = 1;
        withdrawal.recipient = "qor1dest";
        withdrawal.denom = "uqor";
        withdrawal.amount = 500;
        withdrawal.proof = List.of(new byte[] {1}, new byte[] {2, 2});

        return List.of(create, batch, challenge, resolve, pause, resume, stop, withdrawal);
    }

    @Test
    void everyRdkMessageIsCarriedVerbatim() {
        for (Msg m : everyMessage()) {
            TypedMessage tm = SdkMessages.typed(m);
            assertEquals(m.typeUrl(), tm.typeUrl);
            assertArrayEquals(m.marshal(), tm.message.toByteArray(), m.typeUrl());
        }
    }

    @Test
    void theHybridBodyCarriesTheClassicalBodyMessages() {
        // B0 (the body without the PQC extension) is exactly the body the classical path signs.
        List<Msg> msgs = everyMessage();
        TxBackend.TxParams p = new TxBackend.TxParams();
        p.fee = new Tx.Fee(List.of(new Tx.Coin("uqor", "2000")), 120000);
        p.memo = "m";
        byte[] priv = new byte[32];
        priv[31] = 1;
        io.github.qorechain.rdk.accounts.Account acc =
                io.github.qorechain.rdk.accounts.Accounts.accountFromPrivateKey(priv, "");
        RdkTxClient client =
                new RdkTxClient(
                        acc,
                        "qorechain-next",
                        null,
                        new HybridSigningOptions(io.github.qorechain.pqc.Pqc.generatePqcKeypair(new byte[32])));
        assertArrayEquals(Tx.encodeTxBody(msgs, "m"), client.signHybrid(msgs, p).b0Bytes);
        assertArrayEquals(
                Tx.encodeAuthInfo(acc.publicKey, 0, p.fee), client.signHybrid(msgs, p).authInfoBytes);
    }

    @Test
    void anOutOfOrderEncodingIsRefusedRatherThanReordered() {
        Msg outOfOrder =
                new Msg() {
                    @Override
                    public String typeUrl() {
                        return "/qorechain.rdk.v1.MsgPauseRollup";
                    }

                    @Override
                    public byte[] marshal() {
                        ProtoWriter w = new ProtoWriter();
                        w.writeString(2, "r1");
                        w.writeString(1, "qor1creator");
                        return w.toByteArray();
                    }
                };
        assertThrows(IllegalStateException.class, () -> SdkMessages.typed(outOfOrder));
    }

    @Test
    void feeIsConvertedWithoutPayerOrGranter() {
        StdFee f = SdkMessages.fee(new Tx.Fee(List.of(new Tx.Coin("uqor", "30000")), 200000));
        assertEquals("200000", f.gas);
        assertEquals("uqor", f.amount.get(0).denom);
        assertEquals("30000", f.amount.get(0).amount);
        assertEquals("", f.payer);
        assertEquals("", f.granter);
    }
}
