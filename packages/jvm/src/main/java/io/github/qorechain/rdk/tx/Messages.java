package io.github.qorechain.rdk.tx;

import io.github.qorechain.rdk.config.Enums;
import io.github.qorechain.rdk.util.Bytes;
import java.util.ArrayList;
import java.util.List;

/**
 * The {@code qorechain.rdk.v1} transaction messages (and the one {@code qorechain.pqc.v1} message a
 * private-rollup member needs), hand-encoded to protobuf, plus friendly input builders that mirror
 * the reference clients. Field numbers and wire layout match the on-chain {@code tx.proto} exactly.
 */
public final class Messages {
    private Messages() {}

    private static final String TYPE_URL_PREFIX = "/qorechain.rdk.v1.";

    public static final String TYPE_URL_MSG_CREATE_ROLLUP = TYPE_URL_PREFIX + "MsgCreateRollup";
    public static final String TYPE_URL_MSG_SUBMIT_BATCH = TYPE_URL_PREFIX + "MsgSubmitBatch";
    public static final String TYPE_URL_MSG_CHALLENGE_BATCH = TYPE_URL_PREFIX + "MsgChallengeBatch";
    public static final String TYPE_URL_MSG_RESOLVE_CHALLENGE = TYPE_URL_PREFIX + "MsgResolveChallenge";
    public static final String TYPE_URL_MSG_PAUSE_ROLLUP = TYPE_URL_PREFIX + "MsgPauseRollup";
    public static final String TYPE_URL_MSG_RESUME_ROLLUP = TYPE_URL_PREFIX + "MsgResumeRollup";
    public static final String TYPE_URL_MSG_STOP_ROLLUP = TYPE_URL_PREFIX + "MsgStopRollup";
    public static final String TYPE_URL_MSG_EXECUTE_WITHDRAWAL = TYPE_URL_PREFIX + "MsgExecuteWithdrawal";
    // chain v3.2.7+
    public static final String TYPE_URL_MSG_SET_VERIFICATION_KEY = TYPE_URL_PREFIX + "MsgSetVerificationKey";
    public static final String TYPE_URL_MSG_UPDATE_VERIFICATION_KEY =
            TYPE_URL_PREFIX + "MsgUpdateVerificationKey";
    // chain v3.2.8+
    public static final String TYPE_URL_MSG_POST_ROLLUP_DATA = TYPE_URL_PREFIX + "MsgPostRollupData";
    public static final String TYPE_URL_MSG_SET_ROLLUP_SEQUENCING = TYPE_URL_PREFIX + "MsgSetRollupSequencing";
    public static final String TYPE_URL_MSG_DEPOSIT_TO_ROLLUP = TYPE_URL_PREFIX + "MsgDepositToRollup";
    public static final String TYPE_URL_MSG_BOND_ROLLUP_SUBMITTER = TYPE_URL_PREFIX + "MsgBondRollupSubmitter";
    public static final String TYPE_URL_MSG_UNBOND_ROLLUP_SUBMITTER =
            TYPE_URL_PREFIX + "MsgUnbondRollupSubmitter";
    public static final String TYPE_URL_MSG_SET_ROLLUP_MEMBERS = TYPE_URL_PREFIX + "MsgSetRollupMembers";
    /** The {@code x/pqc} KEM registry message (chain v3.2.5+); note the {@code pqc} package. */
    public static final String TYPE_URL_MSG_REGISTER_KEM_KEY = "/qorechain.pqc.v1.MsgRegisterKEMKey";

    /** ML-KEM-1024's id in the chain's algorithm registry. */
    public static final int ML_KEM_1024_ALGORITHM_ID = 2;

    private static byte[] empty() {
        return new byte[0];
    }

    private static byte[] orEmpty(byte[] b) {
        return b == null ? empty() : b;
    }

    private static String orEmptyStr(String s) {
        return s == null ? "" : s;
    }

    // --- Messages ---

    /** Registers a new rollup. */
    public static final class MsgCreateRollup implements Msg {
        public String creator = "";
        public String rollupId = "";
        public String profile = "";
        public String vmType = "";
        public long stakeAmount = 0;
        /**
         * Field 6 (chain v3.2.7+): the rollup's ZK verification key, registered at creation, in the
         * encoding {@code MsgSetVerificationKey} takes. Empty: none.
         */
        public byte[] verificationKey = empty();
        /**
         * Field 7 (chain v3.2.8+): {@code ""} (the rollup's sequencer settles) or {@code "based"}
         * (transactions are ordered by their inclusion on the chain, every batch consumes the inbox
         * in order). zk (snark), based settlement, and qledger-v1 optimistic rollups only.
         */
        public String sequencing = "";
        /** Field 8 (chain v3.2.8+): {@code ""} or {@code "qledger-v1"} (optimistic, must be based). */
        public String executionVm = "";
        /** Field 9 (chain v3.2.8+): {@code ""} or {@code "encapsulated"} (zk with a Groth16 key only). */
        public String privacy = "";

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_CREATE_ROLLUP;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, creator);
            w.writeString(2, rollupId);
            w.writeString(3, profile);
            w.writeString(4, vmType);
            w.writeInt64(5, stakeAmount);
            w.writeBytes(6, verificationKey);
            w.writeString(7, sequencing);
            w.writeString(8, executionVm);
            w.writeString(9, privacy);
            return w.toByteArray();
        }
    }

    /** Submits a settlement batch. */
    public static final class MsgSubmitBatch implements Msg {
        public String sequencer = "";
        public String rollupId = "";
        public long batchIndex = 0;
        public byte[] stateRoot = empty();
        public byte[] prevStateRoot = empty();
        public long txCount = 0;
        public byte[] dataHash = empty();
        public byte[] proof = empty();
        public byte[] withdrawalsRoot = empty();
        /**
         * Field 12 (chain v3.2.8+): for a based rollup, the inbox sequence of the last post this
         * batch consumes; {@code data_hash} must then be the inbox range commitment. Zero for every
         * other rollup. A uint64, read unsigned.
         */
        public long inboxEnd = 0;

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_SUBMIT_BATCH;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, sequencer);
            w.writeString(2, rollupId);
            w.writeUint64(3, batchIndex);
            w.writeBytes(4, stateRoot);
            w.writeBytes(5, prevStateRoot);
            w.writeUint64(6, txCount);
            w.writeBytes(7, dataHash);
            w.writeBytes(8, proof);
            w.writeBytes(9, withdrawalsRoot);
            w.writeUint64(12, inboxEnd);
            return w.toByteArray();
        }
    }

    /** Challenges an optimistic batch with a fraud proof. */
    public static final class MsgChallengeBatch implements Msg {
        public String challenger = "";
        public String rollupId = "";
        public long batchIndex = 0;
        public byte[] proof = empty();

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_CHALLENGE_BATCH;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, challenger);
            w.writeString(2, rollupId);
            w.writeUint64(3, batchIndex);
            w.writeBytes(4, proof);
            return w.toByteArray();
        }
    }

    /** Resolves an open challenge (upheld or dismissed). */
    public static final class MsgResolveChallenge implements Msg {
        public String resolver = "";
        public String rollupId = "";
        public long batchIndex = 0;
        public boolean fraudUpheld = false;

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_RESOLVE_CHALLENGE;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, resolver);
            w.writeString(2, rollupId);
            w.writeUint64(3, batchIndex);
            w.writeBool(4, fraudUpheld);
            return w.toByteArray();
        }
    }

    /** Pauses an active rollup. */
    public static final class MsgPauseRollup implements Msg {
        public String creator = "";
        public String rollupId = "";
        public String reason = "";

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_PAUSE_ROLLUP;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, creator);
            w.writeString(2, rollupId);
            w.writeString(3, reason);
            return w.toByteArray();
        }
    }

    /** Resumes a paused rollup. */
    public static final class MsgResumeRollup implements Msg {
        public String creator = "";
        public String rollupId = "";

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_RESUME_ROLLUP;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, creator);
            w.writeString(2, rollupId);
            return w.toByteArray();
        }
    }

    /** Stops a rollup permanently. */
    public static final class MsgStopRollup implements Msg {
        public String creator = "";
        public String rollupId = "";

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_STOP_ROLLUP;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, creator);
            w.writeString(2, rollupId);
            return w.toByteArray();
        }
    }

    /** Finalizes an L2→L1 cross-layer message (withdrawal). */
    public static final class MsgExecuteWithdrawal implements Msg {
        public String submitter = "";
        public String rollupId = "";
        public long batchIndex = 0;
        public long withdrawalIndex = 0;
        public String recipient = "";
        public String denom = "";
        public long amount = 0;
        public List<byte[]> proof = new ArrayList<>();

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_EXECUTE_WITHDRAWAL;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, submitter);
            w.writeString(2, rollupId);
            w.writeUint64(3, batchIndex);
            w.writeUint64(4, withdrawalIndex);
            w.writeString(5, recipient);
            w.writeString(6, denom);
            w.writeInt64(7, amount);
            w.writeRepeatedBytes(8, proof);
            return w.toByteArray();
        }
    }

    // --- chain v3.2.7+: verification keys ---

    /**
     * Registers or replaces a zk rollup's verification key (chain v3.2.7+). Signed by the creator,
     * before the rollup's first batch only. For {@code snark} the key is a Groth16 BLS12-381
     * verifying key in gnark's binary encoding for a circuit with exactly four public inputs
     * (prev_state_root, state_root, data_hash, withdrawals_root). From v3.2.8 a {@code stark} key is
     * refused.
     */
    public static final class MsgSetVerificationKey implements Msg {
        public String creator = "";
        public String rollupId = "";
        public byte[] verificationKey = empty();
        /** {@code "snark"}, or empty to keep the rollup's proof system. */
        public String proofSystem = "";

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_SET_VERIFICATION_KEY;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, creator);
            w.writeString(2, rollupId);
            w.writeBytes(3, verificationKey);
            w.writeString(4, proofSystem);
            return w.toByteArray();
        }
    }

    /** Governance-only key replacement (chain v3.2.7+); {@code authority} is the gov module account. */
    public static final class MsgUpdateVerificationKey implements Msg {
        public String authority = "";
        public String rollupId = "";
        public byte[] verificationKey = empty();
        public String proofSystem = "";

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_UPDATE_VERIFICATION_KEY;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, authority);
            w.writeString(2, rollupId);
            w.writeBytes(3, verificationKey);
            w.writeString(4, proofSystem);
            return w.toByteArray();
        }
    }

    // --- chain v3.2.8+: posted data, based sequencing, qledger-v1 and private rollups ---

    /**
     * Puts rollup data on chain (chain v3.2.8+). The chain keeps a commitment (SHA-256 of {@code
     * data}) under the rollup's next inbox sequence; a native-DA batch may then carry that SHA-256
     * as its {@code data_hash}. Who may post: the rollup's sequencer (its creator when none is
     * set); anyone on a based rollup.
     */
    public static final class MsgPostRollupData implements Msg {
        public String poster = "";
        public String rollupId = "";
        public byte[] data = empty();

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_POST_ROLLUP_DATA;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, poster);
            w.writeString(2, rollupId);
            w.writeBytes(3, data);
            return w.toByteArray();
        }
    }

    /** The answer to {@link MsgPostRollupData}. */
    public static final class MsgPostRollupDataResponse {
        /** The inbox sequence the post was given (from 1). */
        public long sequence;
        /** SHA-256 of the data: the hash a batch references. */
        public byte[] dataHash = empty();

        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeUint64(1, sequence);
            w.writeBytes(2, dataHash);
            return w.toByteArray();
        }

        public static MsgPostRollupDataResponse decode(byte[] bytes) {
            MsgPostRollupDataResponse m = new MsgPostRollupDataResponse();
            ProtoReader r = new ProtoReader(bytes);
            while (r.hasMore()) {
                int tag = r.readTag();
                if (tag == (1 << 3)) {
                    m.sequence = r.readVarint();
                } else if (tag == ((2 << 3) | 2)) {
                    m.dataHash = r.readBytes();
                } else {
                    r.skip(tag & 7);
                }
            }
            return m;
        }
    }

    /** Governance-only move to based sequencing ({@code "based"}) or back ({@code ""}), chain v3.2.8+. */
    public static final class MsgSetRollupSequencing implements Msg {
        public String authority = "";
        public String rollupId = "";
        public String sequencing = "";

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_SET_ROLLUP_SEQUENCING;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, authority);
            w.writeString(2, rollupId);
            w.writeString(3, sequencing);
            return w.toByteArray();
        }
    }

    /**
     * Moves {@code amount} uqor into a qledger-v1 rollup's deposit pool and credits the 32-byte L2
     * {@code account} through the rollup's inbox (chain v3.2.8+). At least 1 QOR (1,000,000 uqor).
     */
    public static final class MsgDepositToRollup implements Msg {
        public String depositor = "";
        public String rollupId = "";
        public byte[] account = empty();
        /** uqor, a uint64 read unsigned. */
        public long amount = 0;

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_DEPOSIT_TO_ROLLUP;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, depositor);
            w.writeString(2, rollupId);
            w.writeBytes(3, account);
            w.writeUint64(4, amount);
            return w.toByteArray();
        }
    }

    /** The answer to {@link MsgDepositToRollup}. */
    public static final class MsgDepositToRollupResponse {
        /** The inbox sequence of the deposit entry. */
        public long sequence;

        public static MsgDepositToRollupResponse decode(byte[] bytes) {
            MsgDepositToRollupResponse m = new MsgDepositToRollupResponse();
            m.sequence = decodeSingleUint64(bytes);
            return m;
        }
    }

    /** Adds {@code amount} uqor to the submitter's bond on a qledger-v1 rollup (chain v3.2.8+). */
    public static final class MsgBondRollupSubmitter implements Msg {
        public String submitter = "";
        public String rollupId = "";
        public long amount = 0;

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_BOND_ROLLUP_SUBMITTER;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, submitter);
            w.writeString(2, rollupId);
            w.writeUint64(3, amount);
            return w.toByteArray();
        }
    }

    /** The answer to {@link MsgBondRollupSubmitter}. */
    public static final class MsgBondRollupSubmitterResponse {
        /** The submitter's whole bond after the call, in uqor. */
        public long bond;

        public static MsgBondRollupSubmitterResponse decode(byte[] bytes) {
            MsgBondRollupSubmitterResponse m = new MsgBondRollupSubmitterResponse();
            m.bond = decodeSingleUint64(bytes);
            return m;
        }
    }

    /**
     * Returns the submitter's whole bond, a full challenge window after its last batch (chain
     * v3.2.8+).
     */
    public static final class MsgUnbondRollupSubmitter implements Msg {
        public String submitter = "";
        public String rollupId = "";

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_UNBOND_ROLLUP_SUBMITTER;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, submitter);
            w.writeString(2, rollupId);
            return w.toByteArray();
        }
    }

    /** The answer to {@link MsgUnbondRollupSubmitter}. */
    public static final class MsgUnbondRollupSubmitterResponse {
        /** The uqor returned. */
        public long returned;

        public static MsgUnbondRollupSubmitterResponse decode(byte[] bytes) {
            MsgUnbondRollupSubmitterResponse m = new MsgUnbondRollupSubmitterResponse();
            m.returned = decodeSingleUint64(bytes);
            return m;
        }
    }

    /**
     * Sets a private rollup's member list (chain v3.2.8+): at most 32 canonical account addresses,
     * each with a registered ML-KEM-1024 key. Signed by the creator; each change starts a new
     * membership epoch.
     */
    public static final class MsgSetRollupMembers implements Msg {
        public String creator = "";
        public String rollupId = "";
        public List<String> members = new ArrayList<>();

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_SET_ROLLUP_MEMBERS;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, creator);
            w.writeString(2, rollupId);
            w.writeRepeatedString(3, members);
            return w.toByteArray();
        }
    }

    /** The answer to {@link MsgSetRollupMembers}. */
    public static final class MsgSetRollupMembersResponse {
        /** The new membership epoch. */
        public long epoch;

        public static MsgSetRollupMembersResponse decode(byte[] bytes) {
            MsgSetRollupMembersResponse m = new MsgSetRollupMembersResponse();
            m.epoch = decodeSingleUint64(bytes);
            return m;
        }
    }

    /**
     * Publishes the sender's key-encapsulation public key in the chain's KEM registry ({@code
     * x/pqc}, chain v3.2.5+). A private rollup's members need an ML-KEM-1024 key there ({@code
     * algorithmId} 2, the 1568-byte FIPS 203 encapsulation key). Signed hybrid like the other key
     * maintenance.
     */
    public static final class MsgRegisterKEMKey implements Msg {
        public String sender = "";
        /** A uint32, read unsigned. */
        public int algorithmId = 0;
        public byte[] publicKey = empty();

        @Override
        public String typeUrl() {
            return TYPE_URL_MSG_REGISTER_KEM_KEY;
        }

        @Override
        public byte[] marshal() {
            ProtoWriter w = new ProtoWriter();
            w.writeString(1, sender);
            w.writeUint32(2, algorithmId);
            w.writeBytes(3, publicKey);
            return w.toByteArray();
        }
    }

    /** Field 1 of a response holding one uint64. */
    private static long decodeSingleUint64(byte[] bytes) {
        long v = 0;
        ProtoReader r = new ProtoReader(bytes);
        while (r.hasMore()) {
            int tag = r.readTag();
            if (tag == (1 << 3)) {
                v = r.readVarint();
            } else {
                r.skip(tag & 7);
            }
        }
        return v;
    }

    // --- Friendly input builders ---

    public static final class CreateRollupInput {
        public String creator;
        public String rollupId;
        public String profile;
        public String vmType;
        public long stakeAmount;
        /** Chain v3.2.7+: register the zk verification key at creation (see {@link #setVerificationKeyMsg}). */
        public byte[] verificationKey;
        /**
         * Chain v3.2.8+: {@code "based"} orders the rollup's transactions by their inclusion on the
         * chain (anyone posts, every batch consumes the inbox). Allowed for zk (snark), based
         * settlement, and qledger-v1 optimistic rollups.
         */
        public String sequencing;
        /**
         * Chain v3.2.8+: {@code "qledger-v1"}, the execution model the chain re-executes in a fraud
         * proof. <b>Required for every new optimistic rollup</b> ({@code nft}, {@code custom}),
         * together with {@code sequencing = "based"}.
         */
        public String executionVm;
        /** Chain v3.2.8+: {@code "encapsulated"} for a private rollup (zk with a Groth16 key only). */
        public String privacy;
    }

    public static MsgCreateRollup createRollupMsg(CreateRollupInput in) {
        MsgCreateRollup m = new MsgCreateRollup();
        m.creator = in.creator;
        m.rollupId = in.rollupId;
        m.profile = in.profile;
        // The QoreChain Native runtime ("native") goes on the wire as "cosmwasm"; never emit "native".
        m.vmType = Enums.vmTypeWireValue(in.vmType);
        m.stakeAmount = in.stakeAmount;
        m.verificationKey = orEmpty(in.verificationKey);
        m.sequencing = orEmptyStr(in.sequencing);
        m.executionVm = orEmptyStr(in.executionVm);
        m.privacy = orEmptyStr(in.privacy);
        return m;
    }

    public static final class SubmitBatchInput {
        public String sequencer;
        public String rollupId;
        public long batchIndex;
        public byte[] stateRoot;
        public byte[] prevStateRoot;
        public long txCount;
        public byte[] dataHash;
        public byte[] proof;
        public byte[] withdrawalsRoot;
        /**
         * Chain v3.2.8+, based rollups only: the inbox sequence of the last post this batch
         * consumes. {@code dataHash} must then be the inbox range commitment ({@code
         * Inbox.inboxRangeHash}, or {@code RestClient.getInbox(rollupId, inboxEnd)}).
         */
        public long inboxEnd;
    }

    public static MsgSubmitBatch submitBatchMsg(SubmitBatchInput in) {
        MsgSubmitBatch m = new MsgSubmitBatch();
        m.sequencer = in.sequencer;
        m.rollupId = in.rollupId;
        m.batchIndex = in.batchIndex;
        m.stateRoot = orEmpty(in.stateRoot);
        m.prevStateRoot = orEmpty(in.prevStateRoot);
        m.txCount = in.txCount;
        m.dataHash = orEmpty(in.dataHash);
        m.proof = orEmpty(in.proof);
        m.withdrawalsRoot = orEmpty(in.withdrawalsRoot);
        m.inboxEnd = in.inboxEnd;
        return m;
    }

    public static final class ChallengeBatchInput {
        public String challenger;
        public String rollupId;
        public long batchIndex;
        public byte[] proof;
    }

    public static MsgChallengeBatch challengeBatchMsg(ChallengeBatchInput in) {
        MsgChallengeBatch m = new MsgChallengeBatch();
        m.challenger = in.challenger;
        m.rollupId = in.rollupId;
        m.batchIndex = in.batchIndex;
        m.proof = orEmpty(in.proof);
        return m;
    }

    public static final class ResolveChallengeInput {
        public String resolver;
        public String rollupId;
        public long batchIndex;
        public boolean fraudUpheld;
    }

    public static MsgResolveChallenge resolveChallengeMsg(ResolveChallengeInput in) {
        MsgResolveChallenge m = new MsgResolveChallenge();
        m.resolver = in.resolver;
        m.rollupId = in.rollupId;
        m.batchIndex = in.batchIndex;
        m.fraudUpheld = in.fraudUpheld;
        return m;
    }

    public static final class PauseRollupInput {
        public String creator;
        public String rollupId;
        public String reason;
    }

    public static MsgPauseRollup pauseRollupMsg(PauseRollupInput in) {
        MsgPauseRollup m = new MsgPauseRollup();
        m.creator = in.creator;
        m.rollupId = in.rollupId;
        m.reason = in.reason == null ? "" : in.reason;
        return m;
    }

    public static final class RollupRefInput {
        public String creator;
        public String rollupId;
    }

    public static MsgResumeRollup resumeRollupMsg(RollupRefInput in) {
        MsgResumeRollup m = new MsgResumeRollup();
        m.creator = in.creator;
        m.rollupId = in.rollupId;
        return m;
    }

    public static MsgStopRollup stopRollupMsg(RollupRefInput in) {
        MsgStopRollup m = new MsgStopRollup();
        m.creator = in.creator;
        m.rollupId = in.rollupId;
        return m;
    }

    public static final class ExecuteWithdrawalInput {
        public String submitter;
        public String rollupId;
        public long batchIndex;
        public long withdrawalIndex;
        public String recipient;
        public String denom;
        public long amount;
        public List<byte[]> proof;
    }

    public static MsgExecuteWithdrawal executeWithdrawalMsg(ExecuteWithdrawalInput in) {
        MsgExecuteWithdrawal m = new MsgExecuteWithdrawal();
        m.submitter = in.submitter;
        m.rollupId = in.rollupId;
        m.batchIndex = in.batchIndex;
        m.withdrawalIndex = in.withdrawalIndex;
        m.recipient = in.recipient;
        m.denom = in.denom;
        m.amount = in.amount;
        m.proof = in.proof == null ? new ArrayList<>() : in.proof;
        return m;
    }

    // --- chain v3.2.7+ builders ---

    public static final class SetVerificationKeyInput {
        public String creator;
        public String rollupId;
        /** Groth16 BLS12-381 verifying key, gnark binary encoding, four public inputs. */
        public byte[] verificationKey;
        /** {@code "snark"}; empty keeps the rollup's proof system. {@code "stark"} is refused from v3.2.8. */
        public String proofSystem;
    }

    public static MsgSetVerificationKey setVerificationKeyMsg(SetVerificationKeyInput in) {
        MsgSetVerificationKey m = new MsgSetVerificationKey();
        m.creator = in.creator;
        m.rollupId = in.rollupId;
        m.verificationKey = orEmpty(in.verificationKey);
        m.proofSystem = orEmptyStr(in.proofSystem);
        return m;
    }

    /** Governance only: put this message in a proposal; {@code authority} is the gov module account. */
    public static MsgUpdateVerificationKey updateVerificationKeyMsg(
            String authority, String rollupId, byte[] verificationKey, String proofSystem) {
        MsgUpdateVerificationKey m = new MsgUpdateVerificationKey();
        m.authority = authority;
        m.rollupId = rollupId;
        m.verificationKey = orEmpty(verificationKey);
        m.proofSystem = orEmptyStr(proofSystem);
        return m;
    }

    // --- chain v3.2.8+ builders ---

    public static MsgPostRollupData postRollupDataMsg(String poster, String rollupId, byte[] data) {
        MsgPostRollupData m = new MsgPostRollupData();
        m.poster = poster;
        m.rollupId = rollupId;
        m.data = orEmpty(data);
        return m;
    }

    /** Governance only: {@code sequencing} is {@code "based"} or {@code ""}. */
    public static MsgSetRollupSequencing setRollupSequencingMsg(
            String authority, String rollupId, String sequencing) {
        MsgSetRollupSequencing m = new MsgSetRollupSequencing();
        m.authority = authority;
        m.rollupId = rollupId;
        m.sequencing = orEmptyStr(sequencing);
        return m;
    }

    /** {@code account} is the 32-byte qledger-v1 account id to credit; {@code amount} is uqor. */
    public static MsgDepositToRollup depositToRollupMsg(
            String depositor, String rollupId, byte[] account, long amount) {
        MsgDepositToRollup m = new MsgDepositToRollup();
        m.depositor = depositor;
        m.rollupId = rollupId;
        m.account = orEmpty(account);
        m.amount = amount;
        return m;
    }

    public static MsgBondRollupSubmitter bondRollupSubmitterMsg(String submitter, String rollupId, long amount) {
        MsgBondRollupSubmitter m = new MsgBondRollupSubmitter();
        m.submitter = submitter;
        m.rollupId = rollupId;
        m.amount = amount;
        return m;
    }

    public static MsgUnbondRollupSubmitter unbondRollupSubmitterMsg(String submitter, String rollupId) {
        MsgUnbondRollupSubmitter m = new MsgUnbondRollupSubmitter();
        m.submitter = submitter;
        m.rollupId = rollupId;
        return m;
    }

    public static MsgSetRollupMembers setRollupMembersMsg(String creator, String rollupId, List<String> members) {
        MsgSetRollupMembers m = new MsgSetRollupMembers();
        m.creator = creator;
        m.rollupId = rollupId;
        m.members = members == null ? new ArrayList<>() : new ArrayList<>(members);
        return m;
    }

    /** Publish an ML-KEM-1024 encapsulation key (1568 bytes) in the chain's KEM registry. */
    public static MsgRegisterKEMKey registerKemKeyMsg(String sender, byte[] publicKey) {
        return registerKemKeyMsg(sender, publicKey, ML_KEM_1024_ALGORITHM_ID);
    }

    /** {@link #registerKemKeyMsg(String, byte[])} with an explicit algorithm id. */
    public static MsgRegisterKEMKey registerKemKeyMsg(String sender, byte[] publicKey, int algorithmId) {
        MsgRegisterKEMKey m = new MsgRegisterKEMKey();
        m.sender = sender;
        m.algorithmId = algorithmId;
        m.publicKey = orEmpty(publicKey);
        return m;
    }

    /** Coerce a hex string into bytes (convenience for callers building byte fields). */
    public static byte[] bytes(String hex) {
        return Bytes.toBytes(hex);
    }
}
