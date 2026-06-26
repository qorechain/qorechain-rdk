package io.github.qorechain.rdk.tx;

import io.github.qorechain.rdk.util.Bytes;
import java.util.ArrayList;
import java.util.List;

/**
 * The eight {@code qorechain.rdk.v1} transaction messages, hand-encoded to protobuf, plus friendly
 * input builders that mirror the reference clients. Field numbers and wire layout match the on-chain
 * {@code tx.proto} exactly.
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

    private static byte[] empty() {
        return new byte[0];
    }

    private static byte[] orEmpty(byte[] b) {
        return b == null ? empty() : b;
    }

    // --- Messages ---

    /** Registers a new rollup. */
    public static final class MsgCreateRollup implements Msg {
        public String creator = "";
        public String rollupId = "";
        public String profile = "";
        public String vmType = "";
        public long stakeAmount = 0;

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

    // --- Friendly input builders ---

    public static final class CreateRollupInput {
        public String creator;
        public String rollupId;
        public String profile;
        public String vmType;
        public long stakeAmount;
    }

    public static MsgCreateRollup createRollupMsg(CreateRollupInput in) {
        MsgCreateRollup m = new MsgCreateRollup();
        m.creator = in.creator;
        m.rollupId = in.rollupId;
        m.profile = in.profile;
        m.vmType = in.vmType;
        m.stakeAmount = in.stakeAmount;
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

    /** Coerce a hex string into bytes (convenience for callers building byte fields). */
    public static byte[] bytes(String hex) {
        return Bytes.toBytes(hex);
    }
}
