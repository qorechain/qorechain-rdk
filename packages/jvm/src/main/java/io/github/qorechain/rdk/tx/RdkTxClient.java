package io.github.qorechain.rdk.tx;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import io.github.qorechain.tx.HybridTx;
import io.github.qorechain.tx.SignBytes;
import io.github.qorechain.tx.SignBytesResolver;
import java.util.List;
import java.util.Map;

/**
 * Signs and broadcasts {@code rdk} transactions (rollup lifecycle, settlement batches, withdrawals).
 * It builds the Cosmos tx envelope, signs the SignDoc, and broadcasts TxRaw via the REST txs
 * endpoint.
 *
 * <p>Two signing paths:
 *
 * <ul>
 *   <li><b>Hybrid (post-quantum)</b>: pass {@link HybridSigningOptions} with a {@code pqcKeypair}.
 *       Every transaction is then built and signed by the QoreChain SDK's {@link
 *       HybridTx#buildHybridTx}, which attaches the ML-DSA-87 half as a tx-body extension alongside
 *       the classical secp256k1 signature. Both public networks only accept this path on the native
 *       lane. The sign-bytes form (v1 or v2) is resolved from the network over {@link #rest} unless
 *       forced.
 *   <li><b>Classical</b> (no PQC keypair): SIGN_MODE_DIRECT with secp256k1 only. The public
 *       networks refuse such a transaction on the native lane; it remains for local devnets and
 *       offline use.
 * </ul>
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
    /**
     * The post-quantum signing configuration, or {@code null} when this client signs
     * classical-only.
     */
    public final HybridSigningOptions hybrid;

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Resolves the hybrid sign-bytes form through {@link #rest}'s transport. */
    private final SignBytesResolver signBytesResolver;

    /** A classical-only client (see the class note: the public networks refuse its transactions). */
    public RdkTxClient(Account account, String chainId, RestClient rest) {
        this(account, chainId, rest, null, null);
    }

    /**
     * A client that signs hybrid (post-quantum) when {@code hybrid} carries a {@code pqcKeypair},
     * and classical-only when {@code hybrid} is {@code null} or has no keypair. The options are
     * copied, so later changes to {@code hybrid} do not affect this client.
     */
    public RdkTxClient(Account account, String chainId, RestClient rest, HybridSigningOptions hybrid) {
        this(account, chainId, rest, null, hybrid);
    }

    private RdkTxClient(
            Account account,
            String chainId,
            RestClient rest,
            TxBackend backend,
            HybridSigningOptions hybrid) {
        this.account = account;
        this.chainId = chainId;
        this.rest = rest;
        this.backend = backend;
        this.hybrid = hybrid == null || hybrid.pqcKeypair == null ? null : hybrid.copy();
        this.signBytesResolver = this.hybrid == null ? null : resolverFor(rest);
    }

    private static SignBytesResolver resolverFor(RestClient rest) {
        if (rest == null) {
            // Explicit V1/V2 and non-legacy chains need no network; AUTO on a legacy chain
            // then fails with the SDK's explanation instead of guessing.
            return SignBytesResolver.shared();
        }
        return new SignBytesResolver(
                (restUrl, path) -> JSON.valueToTree(rest.getJson(path)),
                SignBytesResolver.DEFAULT_TTL_MS,
                System::currentTimeMillis);
    }

    /** A copy of this client wired to a custom sign-and-broadcast backend. */
    public RdkTxClient withBackend(TxBackend backend) {
        return new RdkTxClient(account, chainId, rest, backend, hybrid);
    }

    /**
     * A copy of this client that signs hybrid with {@code hybrid} (or classical-only when it is
     * {@code null} or has no keypair).
     */
    public RdkTxClient withHybrid(HybridSigningOptions hybrid) {
        return new RdkTxClient(account, chainId, rest, backend, hybrid);
    }

    /** Whether this client signs hybrid (post-quantum) transactions. */
    public boolean isHybrid() {
        return hybrid != null;
    }

    /**
     * Build and sign a transaction, returning the TxRaw bytes ready to broadcast: hybrid when this
     * client holds a PQC keypair, classical-only otherwise.
     */
    public byte[] sign(List<Msg> messages, TxParams p) {
        if (hybrid != null) {
            return signHybrid(messages, p).txRawBytes;
        }
        return Tx.signTx(account, messages, p.memo, p.fee, p.sequence, chainId, p.accountNumber);
    }

    /**
     * The hybrid sign-bytes form this client signs right now: the forced form, or for {@code AUTO}
     * the one the network verifies (asked over {@link #rest} on a network that has switched forms;
     * cached for a minute).
     *
     * @throws IllegalStateException when this client does not sign hybrid.
     * @throws SignBytesResolver.SignBytesResolutionException when {@code AUTO} cannot be answered.
     */
    public SignBytes.Version signBytesVersion() {
        if (hybrid == null) {
            throw new IllegalStateException("this client does not sign hybrid: it holds no PQC keypair");
        }
        String restUrl = rest == null ? null : rest.baseUrl();
        return signBytesResolver.resolve(hybrid.signBytesVersion, chainId, restUrl);
    }

    /**
     * Build and sign a hybrid transaction with the QoreChain SDK's builder: the same messages, fee,
     * memo, chain id, account number and sequence the classical path signs. The result carries the
     * TxRaw bytes and the exact bytes the ML-DSA-87 signature covers.
     *
     * @throws IllegalStateException when this client does not sign hybrid.
     */
    public HybridTx.Built signHybrid(List<Msg> messages, TxParams p) {
        if (hybrid == null) {
            throw new IllegalStateException("this client does not sign hybrid: it holds no PQC keypair");
        }
        HybridTx.Options o = new HybridTx.Options();
        o.messages = SdkMessages.typed(messages);
        o.secp256k1PrivateKey = account.privateKey;
        o.secp256k1PublicKey = account.publicKey;
        o.pqcKeypair = hybrid.pqcKeypair;
        o.fee = SdkMessages.fee(p.fee);
        o.memo = p.memo == null ? "" : p.memo;
        o.chainId = chainId;
        o.accountNumber = p.accountNumber;
        o.sequence = p.sequence;
        o.includePqcPublicKey = hybrid.includePqcPublicKey;
        o.signBytesVersion = signBytesVersion();
        return HybridTx.buildHybridTx(o);
    }

    /**
     * Sign and broadcast the messages and return the raw response. When a backend is configured it is
     * used; otherwise the messages are signed locally (hybrid when this client holds a PQC keypair)
     * and broadcast via the REST txs endpoint, which requires a non-null REST client.
     */
    public Map<String, Object> broadcast(List<Msg> messages, TxParams p) {
        // Catch what the chain would refuse only after the fee is paid.
        io.github.qorechain.rdk.rules.Rules.preflight(messages);
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
