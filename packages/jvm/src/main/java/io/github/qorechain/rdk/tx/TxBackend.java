package io.github.qorechain.rdk.tx;

import java.util.List;
import java.util.Map;

/**
 * The sign-and-broadcast capability {@link RdkTxClient} depends on. The default backend signs
 * locally and broadcasts via the REST txs endpoint; the {@link MockTxClient} backend records calls
 * and returns a fake successful result so the full lifecycle flow runs offline.
 */
public interface TxBackend {
    /** Submit messages signed by {@code signer} and return the raw broadcast response. */
    Map<String, Object> signAndBroadcast(String signer, List<Msg> messages, TxParams params);

    /** The per-transaction signing context and fee. */
    final class TxParams {
        public long sequence;
        public long accountNumber;
        public Tx.Fee fee;
        public String memo = "";
    }
}
