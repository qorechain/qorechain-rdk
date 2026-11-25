package io.github.qorechain.rdk.watchtower;

import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.Views.BatchView;
import java.util.function.Predicate;

/**
 * Watching qledger-v1 rollups: a validity predicate that applies the chain's own qledger-v1 fraud
 * rule, and the fraud proof that wins a challenge against a batch it rejects. Both are built on
 * {@link QledgerJudge}.
 */
public final class Watchtower {
    private Watchtower() {}

    /** {@link #qledgerValidator(RdkClient, String, QledgerValidatorOptions)} with default options. */
    public static Predicate<BatchView> qledgerValidator(RdkClient client, String rollupId) {
        return qledgerValidator(client, rollupId, null);
    }

    /**
     * A validity predicate for the batches of a qledger-v1 rollup: {@code true} exactly when a
     * challenge against the batch would be dismissed. It throws when it cannot decide, for example
     * when the batch builds on a state no honest replay reaches, or when the entries read do not
     * belong to the batch; report that rather than flag the batch. The predicate keeps one {@link
     * QledgerJudge}, so judging a rollup's batches in order reuses the state after each.
     */
    public static Predicate<BatchView> qledgerValidator(
            RdkClient client, String rollupId, QledgerValidatorOptions options) {
        QledgerJudge judge = new QledgerJudge(client, rollupId, options);
        return batch -> judge.judge(batch).valid();
    }

    /**
     * {@link #qledgerFraudProofForBatch(RdkClient, String, BatchView, QledgerValidatorOptions)} with
     * default options.
     */
    public static byte[] qledgerFraudProofForBatch(RdkClient client, String rollupId, BatchView batch) {
        return qledgerFraudProofForBatch(client, rollupId, batch, null);
    }

    /**
     * The qledger-v1 fraud proof that wins a challenge against {@code batch}, or {@code null} when
     * the batch is right (a challenge would be dismissed and forfeit its bond). The proof has
     * already been decided with {@code QledgerFraud.check}, the rule the chain applies.
     *
     * @throws RuntimeException when the batch cannot be decided, as {@link QledgerJudge#judge}
     */
    public static byte[] qledgerFraudProofForBatch(
            RdkClient client, String rollupId, BatchView batch, QledgerValidatorOptions options) {
        return new QledgerJudge(client, rollupId, options).judge(batch).proof();
    }
}
