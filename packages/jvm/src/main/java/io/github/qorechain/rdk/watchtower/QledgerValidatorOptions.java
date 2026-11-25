package io.github.qorechain.rdk.watchtower;

/** Options for {@link QledgerJudge} and {@link Watchtower#qledgerValidator}. */
public final class QledgerValidatorOptions {
    /**
     * Where the entries come from. {@code null} uses {@code QledgerBatch.fetchEntries}, which reads
     * them back from the node's transaction index and checks them against the chain's inbox
     * accumulator. Supply your own to read from an archive of posts you keep, for example once the
     * node has pruned old transactions.
     */
    public QledgerEntryReader readEntries;

    /**
     * How many parent states to keep in memory; {@code null} keeps 32, and at least 2 are always
     * kept. Older ones are rebuilt by replay.
     */
    public Integer maxCachedStates;

    public QledgerValidatorOptions() {}
}
