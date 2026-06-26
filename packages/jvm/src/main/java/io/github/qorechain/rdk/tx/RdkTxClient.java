package io.github.qorechain.rdk.tx;

import io.github.qorechain.rdk.accounts.Account;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.config.Enums.RollupStatus;
import io.github.qorechain.rdk.config.Lifecycle;
import io.github.qorechain.rdk.config.Lifecycle.RollupAction;
import io.github.qorechain.rdk.tx.Messages.ChallengeBatchInput;
import io.github.qorechain.rdk.tx.Messages.CreateRollupInput;
import io.github.qorechain.rdk.tx.Messages.ExecuteWithdrawalInput;
import io.github.qorechain.rdk.tx.Messages.MsgChallengeBatch;
import io.github.qorechain.rdk.tx.Messages.MsgCreateRollup;
import io.github.qorechain.rdk.tx.Messages.MsgExecuteWithdrawal;
import io.github.qorechain.rdk.tx.Messages.MsgPauseRollup;
import io.github.qorechain.rdk.tx.Messages.MsgResolveChallenge;
import io.github.qorechain.rdk.tx.Messages.MsgResumeRollup;
import io.github.qorechain.rdk.tx.Messages.MsgStopRollup;
import io.github.qorechain.rdk.tx.Messages.MsgSubmitBatch;
import io.github.qorechain.rdk.tx.Messages.PauseRollupInput;
import io.github.qorechain.rdk.tx.Messages.ResolveChallengeInput;
import io.github.qorechain.rdk.tx.Messages.RollupRefInput;
import io.github.qorechain.rdk.tx.Messages.SubmitBatchInput;
import io.github.qorechain.rdk.tx.TxBackend.TxParams;
import java.util.List;
import java.util.Map;

/**
 * Signs and broadcasts {@code rdk} transactions (rollup lifecycle, settlement batches, withdrawals).
 * It builds the Cosmos tx envelope, signs the SignDoc, and broadcasts TxRaw via the REST txs
 * endpoint.
 *
 * <p>Account and chain context (sequence, account number, chain id) must be supplied per call; read
 * the sequence and account number from the chain's auth query before submitting. Broadcasting is
 * only performed when {@link #broadcast} is called with a live REST client (or a backend).
 */
public final class RdkTxClient {
    /** The signing/operator account; its address is the message signer. */
    public final Account account;
    /** The chain id signed into every SignDoc. */
    public final String chainId;
    /** The REST client used to broadcast. May be null for offline use. */
    public final RestClient rest;
    /** When set, replaces the default sign-and-broadcast path (e.g. a {@link MockTxClient}). */
    public final TxBackend backend;

    public RdkTxClient(Account account, String chainId, RestClient rest) {
        this(account, chainId, rest, null);
    }

    private RdkTxClient(Account account, String chainId, RestClient rest, TxBackend backend) {
        this.account = account;
        this.chainId = chainId;
        this.rest = rest;
        this.backend = backend;
    }

    /** A copy of this client wired to a custom sign-and-broadcast backend. */
    public RdkTxClient withBackend(TxBackend backend) {
        return new RdkTxClient(account, chainId, rest, backend);
    }

    /** Build and sign a transaction, returning the TxRaw bytes ready to broadcast. */
    public byte[] sign(List<Msg> messages, TxParams p) {
        return Tx.signTx(account, messages, p.memo, p.fee, p.sequence, chainId, p.accountNumber);
    }

    /**
     * Sign and broadcast the messages and return the raw response. When a backend is configured it is
     * used; otherwise the messages are signed locally and broadcast via the REST txs endpoint, which
     * requires a non-null REST client.
     */
    public Map<String, Object> broadcast(List<Msg> messages, TxParams p) {
        if (backend != null) {
            return backend.signAndBroadcast(account.address, messages, p);
        }
        if (rest == null) {
            throw new IllegalStateException("no REST client configured for broadcast");
        }
        return rest.broadcastTxBytes(sign(messages, p));
    }

    /**
     * Estimate gas for a set of messages without broadcasting — the basis for a dry run. When a
     * backend that supports simulation is configured it is used; otherwise the assembled tx is
     * simulated via the chain's simulate endpoint, which requires a non-null REST client.
     */
    public long simulate(List<Msg> messages, TxParams p) {
        if (backend != null) {
            if (backend instanceof SimulateBackend) {
                return ((SimulateBackend) backend).simulate(account.address, messages, p);
            }
            throw new IllegalStateException("the configured backend does not support simulation");
        }
        if (rest == null) {
            throw new IllegalStateException("no REST client configured for simulation");
        }
        return rest.simulateTxBytes(sign(messages, p));
    }

    // --- message builders that fill in the signer from the client's address ---

    /** Build a {@code MsgCreateRollup} with this client's address as creator. */
    public MsgCreateRollup createRollup(CreateRollupInput in) {
        in.creator = account.address;
        return Messages.createRollupMsg(in);
    }

    /** Build a {@code MsgSubmitBatch} with this client's address as sequencer. */
    public MsgSubmitBatch submitBatch(SubmitBatchInput in) {
        in.sequencer = account.address;
        return Messages.submitBatchMsg(in);
    }

    /** Build a {@code MsgChallengeBatch} with this client's address as challenger. */
    public MsgChallengeBatch challengeBatch(ChallengeBatchInput in) {
        in.challenger = account.address;
        return Messages.challengeBatchMsg(in);
    }

    /** Build a {@code MsgResolveChallenge} with this client's address as resolver. */
    public MsgResolveChallenge resolveChallenge(ResolveChallengeInput in) {
        in.resolver = account.address;
        return Messages.resolveChallengeMsg(in);
    }

    /** Build a {@code MsgPauseRollup}, optionally guarding the transition. */
    public MsgPauseRollup pauseRollup(String rollupId, String reason, RollupStatus currentStatus) {
        if (currentStatus != null) {
            Lifecycle.assertRollupAction(RollupAction.PAUSE, currentStatus);
        }
        PauseRollupInput in = new PauseRollupInput();
        in.creator = account.address;
        in.rollupId = rollupId;
        in.reason = reason;
        return Messages.pauseRollupMsg(in);
    }

    /** Build a {@code MsgResumeRollup}, optionally guarding the transition. */
    public MsgResumeRollup resumeRollup(String rollupId, RollupStatus currentStatus) {
        if (currentStatus != null) {
            Lifecycle.assertRollupAction(RollupAction.RESUME, currentStatus);
        }
        RollupRefInput in = new RollupRefInput();
        in.creator = account.address;
        in.rollupId = rollupId;
        return Messages.resumeRollupMsg(in);
    }

    /** Build a {@code MsgStopRollup}, optionally guarding the transition. */
    public MsgStopRollup stopRollup(String rollupId, RollupStatus currentStatus) {
        if (currentStatus != null) {
            Lifecycle.assertRollupAction(RollupAction.STOP, currentStatus);
        }
        RollupRefInput in = new RollupRefInput();
        in.creator = account.address;
        in.rollupId = rollupId;
        return Messages.stopRollupMsg(in);
    }

    /** Build a {@code MsgExecuteWithdrawal} with this client's address as submitter. */
    public MsgExecuteWithdrawal executeWithdrawal(ExecuteWithdrawalInput in) {
        in.submitter = account.address;
        return Messages.executeWithdrawalMsg(in);
    }
}
