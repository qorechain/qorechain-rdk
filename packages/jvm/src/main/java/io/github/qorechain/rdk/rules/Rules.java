package io.github.qorechain.rdk.rules;

import io.github.qorechain.rdk.tx.Messages.MsgCreateRollup;
import io.github.qorechain.rdk.tx.Messages.MsgExecuteWithdrawal;
import io.github.qorechain.rdk.tx.Messages.MsgSubmitBatch;
import io.github.qorechain.rdk.tx.Msg;
import io.github.qorechain.rdk.util.Bech32;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Client-side copies of rules the chain enforces, so a transaction the chain would refuse is caught
 * <b>before</b> a fee is paid.
 *
 * <p>The chain checks both rule sets in the keeper rather than in {@code ValidateBasic}
 * (tightening {@code ValidateBasic} would retroactively refuse what historical blocks accepted), so
 * it can only tell you after you have paid. These mirror them exactly; where they disagree, the
 * chain wins and this class is the bug.
 */
public final class Rules {
    private Rules() {}

    public static final int ID_MIN_LENGTH = 3;
    public static final int ID_MAX_LENGTH = 64;
    /** The only denomination a rollup's escrow ledger can pay a withdrawal in. */
    public static final String ROLLUP_ESCROW_DENOM = "uqor";
    /** A batch commits at most 2^64 withdrawals, so a longer path can never verify. */
    public static final int MAX_WITHDRAWAL_PROOF_DEPTH = 64;

    /**
     * Why {@code id} breaks the chain's id grammar, or {@code null} if it does not.
     *
     * <p>From chain v3.2.2 a <b>new</b> rollup or layer id must match {@code
     * ^[a-z0-9][a-z0-9._-]{2,63}$}, measured in bytes. Ids are store-key components joined with
     * {@code /}, so an id containing {@code /} (or sorting as another id's extension) let one
     * layer's anchors, batches or blobs be read as another's. Ids created before v3.2.2 stay
     * valid; this is for choosing a new one. It is the chain's {@code IDGrammarError}, byte for
     * byte.
     */
    public static String rollupIdError(String id) {
        byte[] b = (id == null ? "" : id).getBytes(StandardCharsets.UTF_8);
        if (b.length < ID_MIN_LENGTH || b.length > ID_MAX_LENGTH) {
            return "must be " + ID_MIN_LENGTH + " to " + ID_MAX_LENGTH + " characters";
        }
        for (int i = 0; i < b.length; i++) {
            int c = b[i] & 0xff;
            boolean lowerOrDigit = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
            if (lowerOrDigit || (i > 0 && (c == '.' || c == '_' || c == '-'))) {
                continue;
            }
            return i == 0
                    ? "must start with a lowercase letter or a digit"
                    : "may contain only lowercase letters, digits, '.', '_' and '-'";
        }
        return null;
    }

    /** Whether {@code id} is a valid new rollup/layer id. */
    public static boolean isValidRollupId(String id) {
        return rollupIdError(id) == null;
    }

    private static boolean isBech32(String address) {
        try {
            Bech32.decode(address);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Every reason the chain would refuse this withdrawal at the start of {@code
     * ExecuteWithdrawal} (chain v3.2.3+, {@code rdk-escrow-ledger}), or an empty list. Mirrors
     * {@code MsgExecuteWithdrawal.ValidateWithdrawal}.
     */
    public static List<String> withdrawalErrors(MsgExecuteWithdrawal m) {
        List<String> errors = new ArrayList<>();
        if (!isBech32(m.submitter)) {
            errors.add("invalid submitter address \"" + m.submitter + "\"");
        }
        // Only emptiness: ids from before v3.2.2 may sit outside the grammar.
        if (m.rollupId == null || m.rollupId.isEmpty()) {
            errors.add("rollup_id cannot be empty");
        }
        if (!isBech32(m.recipient)) {
            errors.add("invalid recipient address \"" + m.recipient + "\"");
        }
        if (!ROLLUP_ESCROW_DENOM.equals(m.denom)) {
            errors.add(
                    "denom \"" + m.denom + "\": rollup escrow is held in " + ROLLUP_ESCROW_DENOM + " only");
        }
        if (m.amount <= 0) {
            errors.add("amount must be positive");
        }
        List<byte[]> proof = m.proof == null ? List.of() : m.proof;
        if (proof.size() > MAX_WITHDRAWAL_PROOF_DEPTH) {
            errors.add(
                    "proof has " + proof.size() + " levels, at most " + MAX_WITHDRAWAL_PROOF_DEPTH);
        }
        for (int i = 0; i < proof.size(); i++) {
            int n = proof.get(i) == null ? 0 : proof.get(i).length;
            if (n != 32) {
                errors.add("proof level " + i + " is " + n + " bytes, want 32");
            }
        }
        return errors;
    }

    /**
     * Refuse, before anything is signed, a message the chain is known to refuse only after the fee
     * is paid. Throws {@link IllegalArgumentException} naming every problem.
     */
    public static void preflight(List<Msg> messages) {
        for (Msg msg : messages) {
            if (msg instanceof MsgCreateRollup) {
                MsgCreateRollup c = (MsgCreateRollup) msg;
                String e = rollupIdError(c.rollupId);
                if (e != null) {
                    throw new IllegalArgumentException("rollupId \"" + c.rollupId + "\" " + e);
                }
            } else if (msg instanceof MsgSubmitBatch) {
                MsgSubmitBatch b = (MsgSubmitBatch) msg;
                String e = withdrawalsRootError(b.withdrawalsRoot);
                if (e != null) {
                    throw new IllegalArgumentException(
                            "cannot submit batch " + Long.toUnsignedString(b.batchIndex) + ": " + e);
                }
            } else if (msg instanceof MsgExecuteWithdrawal) {
                List<String> errs = withdrawalErrors((MsgExecuteWithdrawal) msg);
                if (!errs.isEmpty()) {
                    throw new IllegalArgumentException(
                            "withdrawal would be refused by the chain: " + String.join("; ", errs));
                }
            }
        }
    }

    /**
     * Why a batch with {@code dataHash} would be refused for a rollup on {@code daBackend}, or
     * {@code null} if the chain accepts it.
     *
     * <p>On a {@code native} or {@code both} rollup the chain accepts a non-empty {@code data_hash}
     * only when a matching blob is stored on chain, and no transaction stores one: the batch is
     * refused as data unavailable. Leave it empty there; the batch's state roots and proof still
     * bind it. ({@code celestia} is not checked by the chain, and is not active on the network.)
     */
    public static String dataHashError(String daBackend, byte[] dataHash) {
        if (dataHash == null
                || dataHash.length == 0
                || !("native".equals(daBackend) || "both".equals(daBackend))) {
            return null;
        }
        return "data_hash must be empty on a rollup with "
                + daBackend
                + " data availability: no transaction stores a data-availability blob on chain, so"
                + " the chain refuses a batch that claims one";
    }

    /**
     * Why a batch's {@code withdrawalsRoot} would be refused, or {@code null} if it is acceptable.
     * From chain v3.2.5 ({@code rdk-withdrawals-binding}) it must be empty or exactly 32 bytes, the
     * root of the batch's withdrawals tree.
     */
    public static String withdrawalsRootError(byte[] withdrawalsRoot) {
        int n = withdrawalsRoot == null ? 0 : withdrawalsRoot.length;
        return n == 0 || n == 32 ? null : "withdrawalsRoot must be empty or 32 bytes, got " + n;
    }

    /** {@link #withdrawalsRootError(byte[])} for a hex root, with or without {@code 0x}. */
    public static String withdrawalsRootError(String withdrawalsRootHex) {
        if (withdrawalsRootHex == null) {
            return null;
        }
        String h = withdrawalsRootHex;
        if (h.startsWith("0x") || h.startsWith("0X")) {
            h = h.substring(2);
        }
        if (h.length() % 2 != 0) {
            return "withdrawalsRoot must be empty or 32 bytes, got an odd-length hex string";
        }
        int n = h.length() / 2;
        return n == 0 || n == 32 ? null : "withdrawalsRoot must be empty or 32 bytes, got " + n;
    }

    /**
     * From chain v3.2.5 ({@code rdk-challenge-settlement}) an optimistic rollup may have at most
     * this many batches waiting for finality; the next one is refused.
     */
    public static final int MAX_PENDING_OPTIMISTIC_BATCHES = 4096;

    /**
     * Why stopping a rollup would be refused, given the status of its latest batch, or {@code
     * null} if it would not be. From chain v3.2.5 ({@code rdk-challenge-settlement}) a rollup whose
     * latest batch is still submitted or challenged cannot be stopped: stopping refunds the escrow
     * that pays an upheld challenge.
     */
    public static String stopRollupError(String latestBatchStatus) {
        return "submitted".equals(latestBatchStatus) || "challenged".equals(latestBatchStatus)
                ? "the rollup's latest batch is "
                        + latestBatchStatus
                        + "; stop it once that batch is finalized or rejected"
                : null;
    }
}
