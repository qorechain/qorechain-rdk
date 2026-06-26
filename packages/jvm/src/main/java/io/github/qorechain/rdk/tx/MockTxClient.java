package io.github.qorechain.rdk.tx;

import io.github.qorechain.rdk.tx.TxBackend.TxParams;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * An offline tx backend — the "devnet" equivalent. Wire it into an {@link RdkTxClient} with
 * {@link RdkTxClient#withBackend} to exercise the full create/submit/lifecycle flow without a node:
 * it records every call and returns a successful, fake transaction result.
 */
public final class MockTxClient implements TxBackend, SimulateBackend {

    /** A single {@code signAndBroadcast} invocation. */
    public static final class MockCall {
        public final String signer;
        public final List<Msg> messages;
        public final Tx.Fee fee;
        public final String memo;

        MockCall(String signer, List<Msg> messages, Tx.Fee fee, String memo) {
            this.signer = signer;
            this.messages = messages;
            this.fee = fee;
            this.memo = memo;
        }
    }

    /** Every {@code signAndBroadcast} call, in order. */
    public final List<MockCall> calls = new ArrayList<>();

    private final long gasEstimate;
    private final String txHash;

    public MockTxClient() {
        this(0, null);
    }

    public MockTxClient(long gasEstimate, String txHash) {
        this.gasEstimate = gasEstimate == 0 ? 120000 : gasEstimate;
        this.txHash = (txHash == null || txHash.isEmpty()) ? "MOCK_TX_HASH" : txHash;
    }

    @Override
    public Map<String, Object> signAndBroadcast(String signer, List<Msg> messages, TxParams params) {
        calls.add(new MockCall(signer, messages, params.fee, params.memo));
        Map<String, Object> txResponse = new LinkedHashMap<>();
        txResponse.put("code", 0.0);
        txResponse.put("height", "1");
        txResponse.put("txhash", txHash);
        txResponse.put("gas_used", (double) gasEstimate);
        txResponse.put("gas_wanted", (double) gasEstimate);
        txResponse.put("raw_log", "");
        txResponse.put("events", new ArrayList<>());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("tx_response", txResponse);
        return out;
    }

    @Override
    public long simulate(String signer, List<Msg> messages, TxParams params) {
        return gasEstimate;
    }
}
