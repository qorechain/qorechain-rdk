package io.github.qorechain.rdk.client;

import io.github.qorechain.rdk.client.Views.Balance;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.client.Views.ParamsView;
import io.github.qorechain.rdk.client.Views.RollupView;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A typed read/broadcast client over the {@code rdk} REST (LCD) routes. */
public final class RestClient {
    private final String base;
    private final Transport transport;

    public RestClient(String baseUrl, Transport transport) {
        this.base = baseUrl.replaceAll("/+$", "");
        this.transport = transport == null ? new HttpTransport() : transport;
    }

    private static String pathEscape(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
    }

    private Map<String, Object> get(String path) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Accept", "application/json");
        Transport.Response res =
                transport.exchange(new Transport.Request("GET", base + path, headers, null));
        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new RuntimeException("REST GET " + path + " failed: " + res.statusCode);
        }
        return Json.parseObject(res.body);
    }

    /** Read the live module parameters. */
    public ParamsView getParams() {
        Map<String, Object> body = get("/qorechain/rdk/v1/params");
        Object p = Views.pick(body, "params");
        return Views.mapParamsView(p != null ? Views.asRecord(p) : body);
    }

    /** Read a single rollup's configuration and status. */
    public RollupView getRollup(String rollupId) {
        Map<String, Object> body = get("/qorechain/rdk/v1/rollup/" + pathEscape(rollupId));
        Object r = Views.pick(body, "rollup");
        return Views.mapRollupView(r != null ? Views.asRecord(r) : body);
    }

    /** Read all registered rollups. */
    public List<RollupView> listRollups() {
        Map<String, Object> body = get("/qorechain/rdk/v1/rollups");
        List<RollupView> out = new ArrayList<>();
        for (Map<String, Object> r : Views.asArray(Views.pick(body, "rollups"))) {
            out.add(Views.mapRollupView(r));
        }
        return out;
    }

    /** Read a settlement batch by index. */
    public BatchView getBatch(String rollupId, long batchIndex) {
        Map<String, Object> body =
                get("/qorechain/rdk/v1/batch/" + pathEscape(rollupId) + "/" + batchIndex);
        Object b = Views.pick(body, "batch");
        return Views.mapBatchView(b != null ? Views.asRecord(b) : body);
    }

    /** Read all settlement batches for a rollup. */
    public List<BatchView> listBatches(String rollupId) {
        Map<String, Object> body = get("/qorechain/rdk/v1/batches/" + pathEscape(rollupId));
        List<BatchView> out = new ArrayList<>();
        for (Map<String, Object> b : Views.asArray(Views.pick(body, "batches"))) {
            out.add(Views.mapBatchView(b));
        }
        return out;
    }

    /** Read the latest settlement batch for a rollup. */
    public BatchView getLatestBatch(String rollupId) {
        Map<String, Object> body =
                get("/qorechain/rdk/v1/batches/" + pathEscape(rollupId) + "?latest=true");
        Object b = Views.pick(body, "batch");
        return Views.mapBatchView(b != null ? Views.asRecord(b) : body);
    }

    /** Read raw data-availability blob details. */
    public Map<String, Object> getBlob(String rollupId, long blobIndex) {
        return get("/qorechain/rdk/v1/blob/" + pathEscape(rollupId) + "/" + blobIndex);
    }

    /** Read an account's balance for a single denom (default uqor) as an integer string. */
    public String getBalance(String address, String denom) {
        String d = (denom == null || denom.isEmpty()) ? "uqor" : denom;
        Map<String, Object> body =
                get(
                        "/cosmos/bank/v1beta1/balances/"
                                + pathEscape(address)
                                + "/by_denom?denom="
                                + pathEscape(d));
        Map<String, Object> balance = Views.asRecord(Views.pick(body, "balance"));
        return Views.asStr(Views.pick(balance, "amount"), "0");
    }

    /** Read all of an account's balances. */
    public List<Balance> getAllBalances(String address) {
        Map<String, Object> body = get("/cosmos/bank/v1beta1/balances/" + pathEscape(address));
        List<Balance> out = new ArrayList<>();
        for (Map<String, Object> b : Views.asArray(Views.pick(body, "balances"))) {
            out.add(new Balance(Views.asStr(Views.pick(b, "denom"), ""), Views.asStr(Views.pick(b, "amount"), "0")));
        }
        return out;
    }

    /** Read a transaction by hash (the raw response). */
    public Map<String, Object> getTx(String hash) {
        return get("/cosmos/tx/v1beta1/txs/" + pathEscape(hash));
    }

    private Map<String, Object> post(String path, Map<String, Object> payload) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Content-Type", "application/json");
        headers.put("Accept", "application/json");
        Transport.Response res =
                transport.exchange(
                        new Transport.Request("POST", base + path, headers, Json.stringify(payload)));
        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new RuntimeException("POST " + path + " failed: " + res.statusCode);
        }
        return Json.parseObject(res.body);
    }

    /** Broadcast TxRaw bytes via the REST txs endpoint in BROADCAST_MODE_SYNC. */
    public Map<String, Object> broadcastTxBytes(byte[] txBytes) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("tx_bytes", Base64.getEncoder().encodeToString(txBytes));
        payload.put("mode", "BROADCAST_MODE_SYNC");
        return post("/cosmos/tx/v1beta1/txs", payload);
    }

    /** Simulate TxRaw bytes via the REST simulate endpoint and return the estimated gas used. */
    public long simulateTxBytes(byte[] txBytes) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("tx_bytes", Base64.getEncoder().encodeToString(txBytes));
        Map<String, Object> body = post("/cosmos/tx/v1beta1/simulate", payload);
        Map<String, Object> gasInfo = Views.asRecord(Views.pick(body, "gas_info", "gasInfo"));
        String gasUsed = Views.asStr(Views.pick(gasInfo, "gas_used", "gasUsed"), "0");
        try {
            return Long.parseLong(gasUsed);
        } catch (NumberFormatException e) {
            throw new RuntimeException("simulate: invalid gas_used \"" + gasUsed + "\"", e);
        }
    }
}
