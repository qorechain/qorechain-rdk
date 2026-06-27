package io.github.qorechain.rdk.client;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Calls the custom {@code qor_} JSON-RPC namespace served at the EVM JSON-RPC endpoint. */
public final class QorClient {
    private final String url;
    private final Transport transport;
    private int id;

    public QorClient(String rpcUrl, Transport transport) {
        this.url = rpcUrl;
        this.transport = transport == null ? new HttpTransport() : transport;
    }

    /** Make a raw {@code qor_*} JSON-RPC call and return the parsed {@code result}. */
    public Object call(String method, List<Object> params) {
        id++;
        Map<String, Object> req = new LinkedHashMap<>();
        req.put("jsonrpc", "2.0");
        req.put("id", id);
        req.put("method", method);
        req.put("params", params);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        headers.put("Accept", "application/json");
        Transport.Response res =
                transport.exchange(new Transport.Request("POST", url, headers, Json.stringify(req)));
        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new RuntimeException("JSON-RPC " + method + " failed: " + res.statusCode);
        }
        Map<String, Object> parsed = Json.parseObject(res.body);
        Object error = parsed.get("error");
        if (error instanceof Map) {
            Map<?, ?> e = (Map<?, ?>) error;
            throw new RuntimeException("JSON-RPC " + method + " error: " + e.get("message"));
        }
        return parsed.get("result");
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getRollupStatus(String rollupId) {
        Object result = call("qor_getRollupStatus", List.of(rollupId));
        return result instanceof Map ? (Map<String, Object>) result : new LinkedHashMap<>();
    }

    public Object listRollups() {
        return call("qor_listRollups", List.of());
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getSettlementBatch(String rollupId, long batchIndex) {
        Object result = call("qor_getSettlementBatch", List.of(rollupId, batchIndex));
        return result instanceof Map ? (Map<String, Object>) result : new LinkedHashMap<>();
    }

    public Object suggestRollupProfile(String useCase) {
        return call("qor_suggestRollupProfile", List.of(useCase));
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getDABlobStatus(String rollupId, long blobIndex) {
        Object result = call("qor_getDABlobStatus", List.of(rollupId, blobIndex));
        return result instanceof Map ? (Map<String, Object>) result : new LinkedHashMap<>();
    }

    /** QCAI reinforcement-learning agent status (the fee/routing policy agent). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getRLAgentStatus() {
        Object result = call("qor_getRLAgentStatus", List.of());
        return result instanceof Map ? (Map<String, Object>) result : new LinkedHashMap<>();
    }

    /** The RL agent's current observation vector (network state it acts on). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getRLObservation() {
        Object result = call("qor_getRLObservation", List.of());
        return result instanceof Map ? (Map<String, Object>) result : new LinkedHashMap<>();
    }

    /** The RL agent's latest reward signal. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getRLReward() {
        Object result = call("qor_getRLReward", List.of());
        return result instanceof Map ? (Map<String, Object>) result : new LinkedHashMap<>();
    }
}
