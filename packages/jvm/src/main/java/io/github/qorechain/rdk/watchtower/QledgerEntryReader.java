package io.github.qorechain.rdk.watchtower;

import io.github.qorechain.rdk.qledger.QledgerEntry;
import java.util.List;

/**
 * Reads the inbox entries a qledger-v1 batch consumed: sequences {@code from + 1} through {@code
 * to}, in order. Inbox sequences are uint64 values carried in a {@code long} and read unsigned.
 */
@FunctionalInterface
public interface QledgerEntryReader {
    /**
     * @param from the batch's {@code inbox_start}
     * @param to the batch's {@code inbox_end}
     * @param accFrom the inbox accumulator after entry {@code from} (the batch's start)
     */
    List<QledgerEntry> read(long from, long to, byte[] accFrom);
}
