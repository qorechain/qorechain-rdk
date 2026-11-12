package io.github.qorechain.rdk.client;

import io.github.qorechain.rdk.client.Views.AnchorView;
import io.github.qorechain.rdk.client.Views.Balance;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.client.Views.InboxView;
import io.github.qorechain.rdk.client.Views.KemKeyView;
import io.github.qorechain.rdk.client.Views.ParamsView;
import io.github.qorechain.rdk.client.Views.PostedDataView;
import io.github.qorechain.rdk.client.Views.PqcAccountView;
import io.github.qorechain.rdk.client.Views.RollupView;
import io.github.qorechain.rdk.client.Views.SubmitterBondView;
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

    /** The REST (LCD) base URL this client reads from, without a trailing slash. */
    public String baseUrl() {
        return base;
    }

    /**
     * GET an arbitrary REST path (relative to the base URL, starting with {@code /}) and return the
     * parsed JSON object. Throws on a non-2xx status, like every typed read.
     */
    public Map<String, Object> getJson(String path) {
        return get(path);
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

    /** One page of batches and the start index of the next page (0 when there is none). */
    public static final class BatchPage {
        public final List<BatchView> batches;
        public final long nextIndex;

        BatchPage(List<BatchView> batches, long nextIndex) {
            this.batches = batches;
            this.nextIndex = nextIndex;
        }
    }

    /**
     * Read one page of a rollup's batches, in index order, from {@code startIndex}. The chain
     * returns at most {@code limit} (0 means 50, capped at 100).
     */
    public BatchPage listBatchesPage(String rollupId, long startIndex, int limit) {
        StringBuilder path = new StringBuilder("/qorechain/rdk/v1/batches/").append(pathEscape(rollupId));
        String sep = "?";
        if (startIndex > 0) {
            path.append(sep).append("start_index=").append(startIndex);
            sep = "&";
        }
        if (limit > 0) {
            path.append(sep).append("limit=").append(limit);
        }
        Map<String, Object> body = get(path.toString());
        List<BatchView> out = new ArrayList<>();
        for (Map<String, Object> b : Views.asArray(Views.pick(body, "batches"))) {
            out.add(Views.mapBatchView(b));
        }
        return new BatchPage(out, Views.asLong(Views.pick(body, "next_index", "nextIndex"), 0));
    }

    /**
     * Read all settlement batches for a rollup, following every page. The chain's {@code Batches}
     * query is paged (50 per page by default); releases before 0.6.0 read only the first page, so
     * nothing past batch #49 was ever returned.
     */
    public List<BatchView> listBatches(String rollupId) {
        return listBatchesFrom(rollupId, 0);
    }

    /** Read every batch from {@code startIndex} onwards, following pages. */
    public List<BatchView> listBatchesFrom(String rollupId, long startIndex) {
        List<BatchView> out = new ArrayList<>();
        long start = startIndex;
        for (int pages = 0; pages < 100_000; pages++) { // bounded against a misbehaving node
            BatchPage page = listBatchesPage(rollupId, start, 100);
            out.addAll(page.batches);
            if (page.nextIndex == 0 || page.batches.isEmpty()) {
                break;
            }
            start = page.nextIndex;
        }
        return out;
    }

    /**
     * Read the latest settlement batch for a rollup (the chain's {@code LatestBatch}). Releases
     * before 0.6.0 requested {@code /batches/{id}?latest=true}, which is not a chain route: the node
     * returned the first page of the list, read as one empty batch — so health reported "no
     * batches yet" for every rollup.
     */
    public BatchView getLatestBatch(String rollupId) {
        Map<String, Object> body = get("/qorechain/rdk/v1/latest_batch/" + pathEscape(rollupId));
        Object b = Views.pick(body, "batch");
        return Views.mapBatchView(b != null ? Views.asRecord(b) : body);
    }

    /**
     * The chain's protocol switches ({@code /qorechain/pqc/v1/protocol_features}) as name to
     * enabled. Chains before the route existed answer 404 or 501, which this throws; see {@link
     * #isProtocolFeatureEnabled}.
     */
    public Map<String, Boolean> getProtocolFeatures() {
        Map<String, Object> body = get("/qorechain/pqc/v1/protocol_features");
        Map<String, Boolean> out = new LinkedHashMap<>();
        Object list = body.get("features");
        if (list instanceof List) {
            for (Object f : (List<?>) list) {
                Map<String, Object> r = Views.asRecord(f);
                out.put(String.valueOf(r.getOrDefault("name", "")), Boolean.TRUE.equals(r.get("enabled")));
            }
        }
        return out;
    }

    /**
     * Whether the chain reports feature {@code name} as enabled. A chain that does not serve the
     * feature route has none of its features, so an unavailable route (404/501) reads as false;
     * other errors are thrown.
     */
    public boolean isProtocolFeatureEnabled(String name) {
        try {
            return Boolean.TRUE.equals(getProtocolFeatures().get(name));
        } catch (RuntimeException err) {
            String msg = String.valueOf(err.getMessage());
            if (msg.endsWith(" failed: 404") || msg.endsWith(" failed: 501")) {
                return false;
            }
            throw err;
        }
    }

    /**
     * The height at which upgrade plan {@code name} was applied on this chain ({@code
     * /cosmos/upgrade/v1beta1/applied_plan/{name}}), or 0 if it has not been.
     */
    public long getAppliedPlanHeight(String name) {
        Map<String, Object> body = get("/cosmos/upgrade/v1beta1/applied_plan/" + pathEscape(name));
        return Math.max(0, Views.asLong(body.get("height"), 0));
    }

    /**
     * A rollup's inbox (chain v3.2.8+): head, consumed position, and the {@code data_hash} a based
     * batch ending at {@code inboxEnd} must carry (0 = the head). {@code inboxEnd} is read
     * unsigned.
     */
    public InboxView getInbox(String rollupId, long inboxEnd) {
        String q = inboxEnd != 0 ? "?inbox_end=" + Long.toUnsignedString(inboxEnd) : "";
        Map<String, Object> body = get("/qorechain/rdk/v1/inbox/" + pathEscape(rollupId) + q);
        Object i = Views.pick(body, "inbox");
        return Views.mapInboxView(i != null ? Views.asRecord(i) : body);
    }

    /** {@link #getInbox(String, long)} at the inbox head. */
    public InboxView getInbox(String rollupId) {
        return getInbox(rollupId, 0);
    }

    /** One posted-data commitment (chain v3.2.8+). The payload is in the transaction at {@code height}. */
    public PostedDataView getPostedData(String rollupId, long sequence) {
        Map<String, Object> body =
                get(
                        "/qorechain/rdk/v1/posted_data/"
                                + pathEscape(rollupId)
                                + "/"
                                + Long.toUnsignedString(sequence));
        Object d = Views.pick(body, "posted_data", "postedData");
        return Views.mapPostedDataView(d != null ? Views.asRecord(d) : body);
    }

    /** A submitter's bond on a qledger-v1 rollup and when it unlocks (chain v3.2.8+). */
    public SubmitterBondView getSubmitterBond(String rollupId, String submitter) {
        Map<String, Object> body =
                get(
                        "/qorechain/rdk/v1/submitter_bond/"
                                + pathEscape(rollupId)
                                + "/"
                                + pathEscape(submitter));
        return Views.mapSubmitterBondView(body);
    }

    /**
     * The key-encapsulation key {@code address} published (chain v3.2.5+), or {@code null} when it
     * has none.
     */
    public KemKeyView getKemKey(String address) {
        Map<String, Object> body = get("/qorechain/pqc/v1/kem/" + pathEscape(address));
        if (!Boolean.TRUE.equals(body.get("found"))) {
            return null;
        }
        return Views.mapKemKeyView(Views.asRecord(body.get("key")));
    }

    /** The recipients a post on a private rollup must be sealed to, and the membership epoch. */
    public static final class PrivateRollupRecipients {
        /** The rollup's membership epoch, which an envelope must carry. */
        public final long epoch;
        /** The members in the rollup's order, each with its ML-KEM-1024 encapsulation key. */
        public final List<io.github.qorechain.rdk.privpost.Privpost.Recipient> recipients;

        PrivateRollupRecipients(
                long epoch, List<io.github.qorechain.rdk.privpost.Privpost.Recipient> recipients) {
            this.epoch = epoch;
            this.recipients = recipients;
        }
    }

    /**
     * The recipients a post on private rollup {@code rollupId} must be sealed to: its members in
     * order, each with its registered ML-KEM-1024 key, and the membership epoch. Throws if the
     * rollup is not private, has no members, or a member has no such key (the chain would refuse
     * any envelope).
     */
    public PrivateRollupRecipients getPrivateRollupRecipients(String rollupId) {
        RollupView rollup = getRollup(rollupId);
        if (!"encapsulated".equals(rollup.privacy)) {
            throw new IllegalStateException("rollup " + rollupId + " is not private");
        }
        if (rollup.members.isEmpty()) {
            throw new IllegalStateException("rollup " + rollupId + " has no members yet");
        }
        List<io.github.qorechain.rdk.privpost.Privpost.Recipient> recipients = new ArrayList<>();
        for (String member : rollup.members) {
            KemKeyView key = getKemKey(member);
            if (key == null
                    || key.algorithmId
                            != io.github.qorechain.rdk.tx.Messages.ML_KEM_1024_ALGORITHM_ID) {
                throw new IllegalStateException(
                        "member " + member + " has no ML-KEM-1024 key registered");
            }
            recipients.add(
                    new io.github.qorechain.rdk.privpost.Privpost.Recipient(
                            member, io.github.qorechain.rdk.util.Bytes.hexToBytes(key.publicKey)));
        }
        return new PrivateRollupRecipients(rollup.membersEpoch, recipients);
    }

    /** Read raw data-availability blob details. */
    public Map<String, Object> getBlob(String rollupId, long blobIndex) {
        return get("/qorechain/rdk/v1/blob/" + pathEscape(rollupId) + "/" + blobIndex);
    }

    /**
     * Read the latest state anchor a layer committed to the Main Chain (the {@code x/multilayer}
     * Anchor query). {@code layerId} is the rollup's {@code layer_id}.
     */
    public AnchorView getAnchor(String layerId) {
        Map<String, Object> body =
                get("/qorechain/multilayer/v1/anchor/" + pathEscape(layerId));
        Object a = Views.pick(body, "anchor");
        return Views.mapAnchorView(a != null ? Views.asRecord(a) : body);
    }

    /** Alias for {@link #getAnchor} — the chain's Anchor query returns the latest. */
    public AnchorView getLatestAnchor(String layerId) {
        return getAnchor(layerId);
    }

    /** Read all state anchors a layer has committed (newest first). */
    public List<AnchorView> getAnchors(String layerId) {
        Map<String, Object> body =
                get("/qorechain/multilayer/v1/anchors/" + pathEscape(layerId));
        List<AnchorView> out = new ArrayList<>();
        for (Map<String, Object> a : Views.asArray(Views.pick(body, "anchors"))) {
            out.add(Views.mapAnchorView(a));
        }
        return out;
    }

    /**
     * Read an account's post-quantum key record (the {@code x/pqc} account query). The
     * {@code publicKey} is the registered ML-DSA-87 (Dilithium-5) verification key.
     */
    public PqcAccountView getPqcAccount(String address) {
        Map<String, Object> body = get("/qorechain/pqc/v1/account/" + pathEscape(address));
        Object a = Views.pick(body, "account");
        return Views.mapPqcAccountView(a != null ? Views.asRecord(a) : body);
    }

    // --- QCAI advisory reads (the `ai` REST surface) ---

    /** QCAI fee estimate; {@code urgency} is one of {@code low} | {@code normal} | {@code high} (optional). */
    public Map<String, Object> getFeeEstimate(String urgency) {
        String q = (urgency == null || urgency.isEmpty()) ? "" : "?urgency=" + pathEscape(urgency);
        return get("/qorechain/ai/v1/fee-estimate" + q);
    }

    /** QCAI network recommendations (congestion, suggested settings). */
    public Map<String, Object> getNetworkRecommendations() {
        return get("/qorechain/ai/v1/network/recommendations");
    }

    /** Read open fraud investigations across the network. */
    public List<Map<String, Object>> getFraudInvestigations() {
        Map<String, Object> body = get("/qorechain/ai/v1/fraud/investigations");
        Object list = Views.pick(body, "investigations", "data");
        return Views.asArray(list != null ? list : body);
    }

    /** Read a single fraud investigation by id. */
    public Map<String, Object> getFraudInvestigation(String id) {
        return get("/qorechain/ai/v1/fraud/investigations/" + pathEscape(id));
    }

    /** Read the active QCAI circuit breakers (network safety throttles). */
    public Map<String, Object> getCircuitBreakers() {
        return get("/qorechain/ai/v1/circuit-breakers");
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

    /** The node's latest block height ({@code /cosmos/base/node/v1beta1/status}). */
    public long getLatestHeight() {
        Map<String, Object> body = get("/cosmos/base/node/v1beta1/status");
        long h = Views.asLong(body.get("height"), 0);
        if (h <= 0) {
            throw new RuntimeException("the node did not report its height");
        }
        return h;
    }

    /**
     * Every transaction matching an event query (for example {@code
     * rdk_data_posted.rollup_id='my-rollup'}), as raw {@code tx_responses}, oldest first. Needs a
     * node with transaction indexing on.
     *
     * @param pageLimit transactions per page (0 means 100)
     * @param maxPages most pages read (0 means 50)
     */
    public List<Map<String, Object>> searchTxs(String query, int pageLimit, int maxPages) {
        int limit = pageLimit > 0 ? pageLimit : 100;
        int pages = maxPages > 0 ? maxPages : 50;
        List<Map<String, Object>> out = new ArrayList<>();
        for (int page = 1; page <= pages; page++) {
            Map<String, Object> body =
                    get(
                            "/cosmos/tx/v1beta1/txs?query="
                                    + pathEscape(query)
                                    + "&page="
                                    + page
                                    + "&limit="
                                    + limit
                                    + "&order_by=ORDER_BY_ASC");
            List<Map<String, Object>> txs = Views.asArray(body.get("tx_responses"));
            out.addAll(txs);
            long total = Views.asLong(body.get("total"), 0);
            if (txs.size() < limit || (total > 0 && out.size() >= total)) {
                break;
            }
        }
        return out;
    }

    /** {@link #searchTxs(String, int, int)} with 100 transactions per page, at most 50 pages. */
    public List<Map<String, Object>> searchTxs(String query) {
        return searchTxs(query, 0, 0);
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
