package io.github.qorechain.rdk.tx;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.qorechain.rdk.accounts.Account;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Views.RollupView;
import io.github.qorechain.rdk.config.Constants;
import io.github.qorechain.rdk.config.Enums;
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
import io.github.qorechain.rdk.tx.Messages.MsgBondRollupSubmitter;
import io.github.qorechain.rdk.tx.Messages.MsgDepositToRollup;
import io.github.qorechain.rdk.tx.Messages.MsgPostRollupData;
import io.github.qorechain.rdk.tx.Messages.MsgRegisterKEMKey;
import io.github.qorechain.rdk.tx.Messages.MsgSetRollupMembers;
import io.github.qorechain.rdk.tx.Messages.MsgSetVerificationKey;
import io.github.qorechain.rdk.tx.Messages.MsgUnbondRollupSubmitter;
import io.github.qorechain.rdk.tx.Messages.SetVerificationKeyInput;
import io.github.qorechain.rdk.qledger.QledgerBatch;
import io.github.qorechain.rdk.rules.Rules;
import io.github.qorechain.rdk.zk.Zk;
import io.github.qorechain.rdk.tx.Messages.PauseRollupInput;
import io.github.qorechain.rdk.tx.Messages.ResolveChallengeInput;
import io.github.qorechain.rdk.tx.Messages.RollupRefInput;
import io.github.qorechain.rdk.tx.Messages.SubmitBatchInput;
import io.github.qorechain.rdk.tx.TxBackend.TxParams;
import io.github.qorechain.tx.HybridTx;
import io.github.qorechain.tx.SignBytes;
import io.github.qorechain.tx.SignBytesResolver;
import java.util.ArrayList;
import java.util.HashSet;
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
     *
     * <p>When this client signs hybrid with {@link HybridSigningOptions#includePqcPublicKey} set
     * (the key is not registered yet) and the messages are not themselves a key registration, it
     * first registers the key: {@code MsgRegisterPQCKeyV2} alone, at {@code p.sequence}, with a
     * fixed fee of 600000 gas and 90000 uqor. It waits for a block to include it, then sends
     * {@code messages} at the next sequence without the embedded key. A "key already registered"
     * answer (pqc code 7) is accepted. Any other refusal throws {@link IllegalStateException}.
     */
    public Map<String, Object> broadcast(List<Msg> messages, TxParams p) {
        // Catch what the chain would refuse only after the fee is paid.
        Rules.preflight(messages);
        // With a REST client, also check each batch against the rollup as the chain records it.
        if (rest != null) {
            for (Msg m : messages) {
                if (m instanceof MsgSubmitBatch) {
                    preflightSubmitBatch((MsgSubmitBatch) m);
                }
            }
        }
        if (backend != null) {
            return backend.signAndBroadcast(account.address, messages, p);
        }
        if (rest == null) {
            throw new IllegalStateException("no REST client configured for broadcast");
        }
        // Since chain v3.2.3 (`pqc-keyless-extension-closed`) a key carried in the signature
        // extension is no longer registered on first use: an account without a registered key
        // may send only a registration. Register it in a transaction of its own first.
        if (hybrid != null && hybrid.includePqcPublicKey && !SdkMessages.isRegistrationOnly(messages)) {
            p = registerPqcKey(p);
        }
        return rest.broadcastTxBytes(sign(messages, p));
    }

    /** The fixed fee of the key registration transaction. */
    static final long REGISTRATION_GAS = 600_000;
    static final String REGISTRATION_FEE_UQOR = "90000";
    /** The pqc codespace's "key already registered" refusal. */
    static final int PQC_ALREADY_REGISTERED_CODE = 7;
    private static final long REGISTRATION_POLL_INTERVAL_MS = 1_000;
    private static final long REGISTRATION_TIMEOUT_MS = 90_000;

    /**
     * Broadcast {@code MsgRegisterPQCKeyV2} (with its proof of possession) at {@code p}'s sequence,
     * wait until a block includes it, then stop embedding the public key. A "key already
     * registered" refusal (pqc code 7) counts as success. Returns the parameters for the next
     * transaction: the sequence moves on by one when the registration took it.
     */
    private TxParams registerPqcKey(TxParams p) {
        Msg reg = SdkMessages.registerPqcKeyV2(account.address, hybrid.pqcKeypair, chainId);
        TxParams rp = new TxParams();
        rp.accountNumber = p.accountNumber;
        rp.sequence = p.sequence;
        rp.fee = new Tx.Fee(List.of(new Tx.Coin("uqor", REGISTRATION_FEE_UQOR)), REGISTRATION_GAS);
        rp.memo = "";
        Map<String, Object> checked = txResponse(rest.broadcastTxBytes(sign(List.of(reg), rp)));
        long code = asLong(checked.get("code"));
        if (isAlreadyRegistered(checked)) {
            // Refused before execution: the sequence was not used.
            hybrid.includePqcPublicKey = false;
            return p;
        }
        if (code != 0) {
            throw registrationFailed(checked);
        }
        Map<String, Object> delivered = awaitTx(String.valueOf(checked.get("txhash")));
        if (asLong(delivered.get("code")) != 0 && !isAlreadyRegistered(delivered)) {
            throw registrationFailed(delivered);
        }
        hybrid.includePqcPublicKey = false;
        TxParams next = new TxParams();
        next.accountNumber = p.accountNumber;
        next.sequence = p.sequence + 1;
        next.fee = p.fee;
        next.memo = p.memo;
        return next;
    }

    /** Poll {@link #rest} for a transaction until a block includes it. */
    private Map<String, Object> awaitTx(String hash) {
        long deadline = System.currentTimeMillis() + REGISTRATION_TIMEOUT_MS;
        while (true) {
            try {
                Map<String, Object> res = txResponse(rest.getTx(hash));
                if (!res.isEmpty()) {
                    return res;
                }
            } catch (RuntimeException notYet) {
                // Not indexed yet.
            }
            if (System.currentTimeMillis() >= deadline) {
                throw new IllegalStateException(
                        "registering this account's post-quantum key: transaction " + hash
                                + " was not included in a block in time");
            }
            try {
                Thread.sleep(REGISTRATION_POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted waiting for the key registration " + hash, e);
            }
        }
    }

    private static boolean isAlreadyRegistered(Map<String, Object> res) {
        Object codespace = res.get("codespace");
        boolean pqcSpace = codespace == null || "".equals(codespace) || "pqc".equals(codespace);
        return pqcSpace && asLong(res.get("code")) == PQC_ALREADY_REGISTERED_CODE;
    }

    private static IllegalStateException registrationFailed(Map<String, Object> res) {
        Object log = res.get("raw_log");
        return new IllegalStateException(
                "registering this account's post-quantum key failed (code " + asLong(res.get("code")) + "): "
                        + (log == null ? "" : log));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> txResponse(Map<String, Object> body) {
        Object r = body == null ? null : body.get("tx_response");
        return r instanceof Map ? (Map<String, Object>) r : Map.of();
    }

    private static long asLong(Object v) {
        if (v instanceof Number) {
            return ((Number) v).longValue();
        }
        if (v instanceof String && !((String) v).isEmpty()) {
            return Long.parseLong((String) v);
        }
        return 0;
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

    /**
     * Build a {@code MsgCreateRollup} with this client's address as creator. When the profile is
     * one of the presets, the chain v3.2.8 mode rules ({@code sequencing}, {@code executionVm},
     * {@code privacy}) are checked against the profile's settlement, so a refused combination costs
     * no fee.
     *
     * @throws IllegalArgumentException when the chain would refuse the combination.
     */
    public MsgCreateRollup createRollup(CreateRollupInput in) {
        in.creator = account.address;
        MsgCreateRollup m = Messages.createRollupMsg(in);
        String err = Rules.createRollupModeError(m);
        if (err != null) {
            throw new IllegalArgumentException(err);
        }
        return m;
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

    /**
     * The checks the chain would make on a batch after the fee is paid, against the rollup as
     * {@link #rest} reads it: a based rollup's inbox range, a native-DA data hash, and (chain
     * v3.2.8) the qledger-v1 admission rules ({@link QledgerBatch#batchErrors}), canonical ZK public
     * inputs and the paused STARK settlement. Does nothing without a
     * REST client. {@link #broadcast} runs it for every batch when a REST client is configured.
     *
     * @throws IllegalArgumentException naming the problem.
     */
    public void preflightSubmitBatch(MsgSubmitBatch in) {
        if (rest == null) {
            return;
        }
        RollupView rollup = rest.getRollup(in.rollupId);
        String prefix = "cannot submit batch " + Long.toUnsignedString(in.batchIndex) + ": ";
        boolean based = Enums.SEQUENCING_BASED.equals(rollup.sequencing);
        boolean hasDataHash = in.dataHash != null && in.dataHash.length > 0;
        if (based && in.inboxEnd == 0) {
            throw new IllegalArgumentException(
                    prefix + "the rollup is based: set inboxEnd and carry the inbox range commitment as dataHash");
        }
        if (!based && in.inboxEnd != 0) {
            throw new IllegalArgumentException(prefix + "inboxEnd must be 0 on a rollup that is not based");
        }
        if (!based && hasDataHash) {
            boolean postedDataEnabled = rest.isProtocolFeatureEnabled(Constants.RdkFeatures.POST_ROLLUP_DATA);
            String err = Rules.dataHashError(rollup.daBackend, in.dataHash, postedDataEnabled);
            if (err != null) {
                throw new IllegalArgumentException(prefix + err);
            }
        }
        if (Enums.EXECUTION_VM_QLEDGER_V1.equals(rollup.executionVm)) {
            // Chain v3.2.8 admission rules for qledger-v1 batches; the submitter is the signer.
            String submitter = in.sequencer == null || in.sequencer.isEmpty() ? account.address : in.sequencer;
            List<String> errors =
                    QledgerBatch.batchErrors(QledgerBatch.readBatchFacts(rest, in.rollupId, submitter, in.inboxEnd, 2));
            if (!errors.isEmpty()) {
                throw new IllegalArgumentException(prefix + String.join("; ", errors));
            }
        }
        if ("zk".equals(rollup.settlementMode)) {
            if (Enums.isPausedProofSystem(rollup.proofSystem)) {
                if (rest.isProtocolFeatureEnabled(Constants.RdkFeatures.STARK_STATEMENT)) {
                    throw new IllegalArgumentException(
                            prefix
                                    + "STARK settlement is paused on the network; governance can move the"
                                    + " rollup to a Groth16 key");
                }
            } else if (rest.isProtocolFeatureEnabled(Constants.RdkFeatures.ZK_CANONICAL_INPUTS)) {
                List<String> errors =
                        Zk.zkPublicInputErrors(
                                new Zk.ZkBatchInputs(
                                        in.prevStateRoot, in.stateRoot, in.dataHash, in.withdrawalsRoot),
                                Zk.isDataHashChainBound(rollup.daBackend, rollup.sequencing, in.dataHash));
                if (!errors.isEmpty()) {
                    throw new IllegalArgumentException(prefix + String.join("; ", errors));
                }
            }
        }
    }

    /**
     * Build a {@code MsgSetVerificationKey} (chain v3.2.7+) with this client's address as creator:
     * register or replace the rollup's ZK verification key, only before the first batch.
     *
     * @throws IllegalArgumentException for a {@code stark} key, which the chain refuses from v3.2.8.
     */
    public MsgSetVerificationKey setVerificationKey(SetVerificationKeyInput in) {
        if (Enums.isPausedProofSystem(in.proofSystem)) {
            throw new IllegalArgumentException(
                    "STARK keys are refused by the chain from v3.2.8; register a snark (Groth16) key");
        }
        in.creator = account.address;
        return Messages.setVerificationKeyMsg(in);
    }

    /**
     * Build a {@code MsgPostRollupData} (chain v3.2.8+) with this client's address as poster. The
     * response carries the inbox sequence and SHA-256; on a private rollup {@code data} must be an
     * envelope ({@code Privpost.sealEnvelope}). The poster pays {@code posted_data_fee_per_byte} per
     * billable byte (at least 1 KiB) on top of gas.
     */
    public MsgPostRollupData postRollupData(String rollupId, byte[] data) {
        if (data == null || data.length == 0) {
            throw new IllegalArgumentException("data cannot be empty");
        }
        return Messages.postRollupDataMsg(account.address, rollupId, data);
    }

    /**
     * Build a {@code MsgDepositToRollup} (chain v3.2.8+): deposit uqor into a qledger-v1 rollup,
     * crediting the 32-byte L2 {@code account} through the rollup's inbox. At least 1 QOR.
     */
    public MsgDepositToRollup depositToRollup(String rollupId, byte[] l2Account, long amount) {
        boolean allZero = true;
        if (l2Account != null) {
            for (byte b : l2Account) {
                if (b != 0) {
                    allZero = false;
                    break;
                }
            }
        }
        if (l2Account == null || l2Account.length != 32 || allZero) {
            throw new IllegalArgumentException("account must be a non-zero 32-byte qledger-v1 account id");
        }
        if (Long.compareUnsigned(amount, Constants.MIN_ROLLUP_DEPOSIT_UQOR) < 0) {
            throw new IllegalArgumentException(
                    "a deposit is at least " + Constants.MIN_ROLLUP_DEPOSIT_UQOR + " uqor (1 QOR)");
        }
        return Messages.depositToRollupMsg(account.address, rollupId, l2Account, amount);
    }

    /** Build a {@code MsgBondRollupSubmitter} (chain v3.2.8+): add to this client's submitter bond. */
    public MsgBondRollupSubmitter bondRollupSubmitter(String rollupId, long amount) {
        if (amount == 0) {
            throw new IllegalArgumentException("amount must be positive");
        }
        return Messages.bondRollupSubmitterMsg(account.address, rollupId, amount);
    }

    /**
     * Build a {@code MsgUnbondRollupSubmitter} (chain v3.2.8+): withdraw this client's whole
     * submitter bond, a full challenge window after its last batch.
     */
    public MsgUnbondRollupSubmitter unbondRollupSubmitter(String rollupId) {
        return Messages.unbondRollupSubmitterMsg(account.address, rollupId);
    }

    /**
     * Build a {@code MsgSetRollupMembers} (chain v3.2.8+) with this client's address as creator:
     * set a private rollup's member list. Each member needs a registered ML-KEM-1024 key. Starts a
     * new membership epoch.
     */
    public MsgSetRollupMembers setRollupMembers(String rollupId, List<String> members) {
        int n = members == null ? 0 : members.size();
        if (n == 0 || n > Enums.MAX_ROLLUP_MEMBERS) {
            throw new IllegalArgumentException(
                    "a private rollup has 1 to " + Enums.MAX_ROLLUP_MEMBERS + " members");
        }
        if (new HashSet<>(members).size() != n) {
            throw new IllegalArgumentException("a member is listed twice");
        }
        return Messages.setRollupMembersMsg(account.address, rollupId, new ArrayList<>(members));
    }

    /**
     * Build a {@code MsgRegisterKEMKey} with this client's address as sender: publish its
     * ML-KEM-1024 encapsulation key in the chain's KEM registry (chain v3.2.5+), so a private
     * rollup can list it as a member. Derive the key pair with {@code Privpost.kemKeypairFromSeed}
     * and keep the seed secret.
     */
    public MsgRegisterKEMKey registerKemKey(byte[] publicKey) {
        int n = publicKey == null ? 0 : publicKey.length;
        if (n != 1568) {
            throw new IllegalArgumentException("an ML-KEM-1024 key is 1568 bytes, got " + n);
        }
        return Messages.registerKemKeyMsg(account.address, publicKey);
    }

    /** Build a {@code MsgExecuteWithdrawal} with this client's address as submitter. */
    public MsgExecuteWithdrawal executeWithdrawal(ExecuteWithdrawalInput in) {
        in.submitter = account.address;
        return Messages.executeWithdrawalMsg(in);
    }
}
