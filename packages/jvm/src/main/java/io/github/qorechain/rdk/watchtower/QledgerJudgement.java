package io.github.qorechain.rdk.watchtower;

/**
 * How a qledger-v1 batch fares under the chain's fraud rule.
 *
 * @param valid {@code true} when a challenge against the batch would be dismissed
 * @param honestStateRoot the state root an honest batch over the same entries publishes
 * @param honestWithdrawalsRoot the withdrawals root an honest batch over the same entries
 *     publishes (empty when it has no withdrawal)
 * @param proof for an invalid batch, the encoded proof that wins {@code challengeBatch}; {@code
 *     null} for a valid one
 */
public record QledgerJudgement(
        boolean valid, byte[] honestStateRoot, byte[] honestWithdrawalsRoot, byte[] proof) {}
