package io.github.qorechain.rdk.inbox;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Posted rollup data and the rollup inbox (chain v3.2.8+).
 *
 * <p>{@code MsgPostRollupData} gives each post the next inbox sequence (from 1) and extends the
 * rollup's inbox accumulator:
 *
 * <pre>
 * acc_n = SHA-256("qorechain/rdk/inbox/v1" | lp(chain_id) | lp(rollup_id) | acc_{n-1}
 *                 | be64(n) | be64(height) | lp(poster) | SHA-256(data))
 * </pre>
 *
 * <p>with {@code acc_0} 32 zero bytes and {@code lp} a 4-byte big-endian length prefix. A batch of a
 * based rollup sets {@code inbox_end} and carries as {@code data_hash} the range commitment from
 * the consumed position to {@code inbox_end}:
 *
 * <pre>
 * range = SHA-256("qorechain/rdk/inbox-range/v1" | lp(chain_id) | lp(rollup_id)
 *                 | be64(from) | be64(to) | acc_from | acc_to)
 * </pre>
 *
 * <p>The chain returns it too ({@code RestClient.getInbox(rollupId, inboxEnd)}). A native-DA batch
 * of a rollup that is not based may carry {@code SHA-256(data)} of a retained post as its {@code
 * data_hash}.
 */
public final class Inbox {
    private Inbox() {}

    private static final byte[] ACC_DOMAIN = "qorechain/rdk/inbox/v1".getBytes(StandardCharsets.UTF_8);
    private static final byte[] RANGE_DOMAIN =
            "qorechain/rdk/inbox-range/v1".getBytes(StandardCharsets.UTF_8);

    /** The accumulator of an inbox with no post: 32 zero bytes. Returns a fresh copy. */
    public static byte[] emptyInboxAcc() {
        return new byte[32];
    }

    /**
     * The accumulator of an inbox with no post: 32 zero bytes. Do not modify it; the hashing here
     * does not read this array.
     */
    public static final byte[] EMPTY_INBOX_ACC = new byte[32];

    private static final byte[] ZERO_ACC = new byte[32];

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void lp(MessageDigest h, byte[] b) {
        h.update(ByteBuffer.allocate(4).putInt(b.length).array());
        h.update(b);
    }

    private static void be64(MessageDigest h, long v) {
        h.update(ByteBuffer.allocate(8).putLong(v).array());
    }

    private static byte[] accOrEmpty(byte[] acc) {
        return acc == null || acc.length == 0 ? ZERO_ACC : acc;
    }

    /** SHA-256 of a post's payload: the hash a batch references. */
    public static byte[] postedDataHash(byte[] data) {
        return sha256().digest(data == null ? new byte[0] : data);
    }

    /**
     * One step of the inbox accumulator (what the chain stores after post {@code sequence}).
     *
     * @param prevAcc the accumulator before this post (empty or {@link #EMPTY_INBOX_ACC} for the
     *     first)
     * @param sequence the post's inbox sequence (uint64)
     * @param height the height of the block that included the post (uint64)
     * @param dataHash SHA-256 of the payload ({@link #postedDataHash})
     */
    public static byte[] inboxAccumulate(
            String chainId,
            String rollupId,
            byte[] prevAcc,
            long sequence,
            long height,
            String poster,
            byte[] dataHash) {
        MessageDigest h = sha256();
        h.update(ACC_DOMAIN);
        lp(h, chainId.getBytes(StandardCharsets.UTF_8));
        lp(h, rollupId.getBytes(StandardCharsets.UTF_8));
        h.update(accOrEmpty(prevAcc));
        be64(h, sequence);
        be64(h, height);
        lp(h, poster.getBytes(StandardCharsets.UTF_8));
        h.update(dataHash == null ? new byte[0] : dataHash);
        return h.digest();
    }

    /**
     * The inbox range commitment a based batch carries as {@code data_hash}: the posts after {@code
     * from} (the consumed position) up to {@code to} ({@code inbox_end}). Empty accumulators read as
     * {@link #EMPTY_INBOX_ACC}.
     */
    public static byte[] inboxRangeHash(
            String chainId, String rollupId, long from, long to, byte[] accFrom, byte[] accTo) {
        MessageDigest h = sha256();
        h.update(RANGE_DOMAIN);
        lp(h, chainId.getBytes(StandardCharsets.UTF_8));
        lp(h, rollupId.getBytes(StandardCharsets.UTF_8));
        be64(h, from);
        be64(h, to);
        h.update(accOrEmpty(accFrom));
        h.update(accOrEmpty(accTo));
        return h.digest();
    }
}
