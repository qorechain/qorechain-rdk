package io.github.qorechain.rdk.tx;

import io.github.qorechain.rdk.tx.TxBackend.TxParams;
import java.util.List;

/** The optional gas-estimation capability. The {@link MockTxClient} backend satisfies it. */
public interface SimulateBackend {
    /** Estimate gas for messages without broadcasting. */
    long simulate(String signer, List<Msg> messages, TxParams params);
}
