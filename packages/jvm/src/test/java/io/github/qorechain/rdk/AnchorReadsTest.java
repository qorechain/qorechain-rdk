package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.client.Views.AnchorView;
import io.github.qorechain.rdk.client.Views.PqcAccountView;
import io.github.qorechain.rdk.copilot.Copilot;
import io.github.qorechain.rdk.copilot.Copilot.RollupAdvice;
import java.util.List;
import org.junit.jupiter.api.Test;

class AnchorReadsTest {

    @Test
    void getAnchorDecodesBase64WireBytesToHex() {
        // base64("\x01\x02\x03\x04") == "AQIDBA==" -> hex "01020304".
        Transport transport =
                req ->
                        new Transport.Response(
                                200,
                                "{\"anchor\":{\"layer_id\":\"layer-r1\",\"layer_height\":\"42\","
                                        + "\"state_root\":\"AQIDBA==\",\"main_chain_height\":1000,"
                                        + "\"transaction_count\":5}}");
        RestClient rest = new RestClient("http://node.test", transport);
        AnchorView a = rest.getAnchor("layer-r1");
        assertEquals("layer-r1", a.layerId);
        assertEquals(42L, a.layerHeight);
        assertEquals("01020304", a.stateRoot);
        assertEquals(1000L, a.mainChainHeight);
        assertEquals(5, a.transactionCount);
    }

    @Test
    void getAnchorAcceptsHexWireBytes() {
        Transport transport =
                req ->
                        new Transport.Response(
                                200,
                                "{\"anchor\":{\"layer_id\":\"layer-r1\","
                                        + "\"state_root\":\"98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d\"}}");
        RestClient rest = new RestClient("http://node.test", transport);
        AnchorView a = rest.getAnchor("layer-r1");
        assertEquals(
                "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d", a.stateRoot);
    }

    @Test
    void getAnchorsReturnsList() {
        Transport transport =
                req ->
                        new Transport.Response(
                                200,
                                "{\"anchors\":[{\"layer_id\":\"l\",\"layer_height\":1},"
                                        + "{\"layer_id\":\"l\",\"layer_height\":2}]}");
        RestClient rest = new RestClient("http://node.test", transport);
        List<AnchorView> anchors = rest.getAnchors("l");
        assertEquals(2, anchors.size());
        assertEquals(2L, anchors.get(1).layerHeight);
    }

    @Test
    void getPqcAccountMapsFields() {
        Transport transport =
                req ->
                        new Transport.Response(
                                200,
                                "{\"account\":{\"address\":\"qor1abc\",\"public_key\":\"AQID\","
                                        + "\"algorithm_id\":1,\"algorithm_name\":\"ML-DSA-87\"}}");
        RestClient rest = new RestClient("http://node.test", transport);
        PqcAccountView p = rest.getPqcAccount("qor1abc");
        assertEquals("qor1abc", p.address);
        assertEquals("010203", p.publicKey);
        assertEquals(1, p.algorithmId);
        assertEquals("ML-DSA-87", p.algorithmName);
    }

    @Test
    void rlAgentStatusViaJsonRpc() {
        Transport transport =
                req -> {
                    assertTrue(req.body.contains("qor_getRLAgentStatus"));
                    return new Transport.Response(
                            200,
                            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"policy\":\"v3\"}}");
                };
        RdkClient.Options opts = new RdkClient.Options();
        opts.transport = transport;
        RdkClient client = new RdkClient(opts);
        assertEquals("v3", client.qor.getRLAgentStatus().get("policy"));
    }

    @Test
    void copilotAggregatesAdviceBestEffort() {
        Transport transport =
                req -> {
                    if (req.url.contains("/qorechain/rdk/v1/rollup/")) {
                        return new Transport.Response(
                                200,
                                "{\"rollup\":{\"rollup_id\":\"r1\",\"status\":\"paused\","
                                        + "\"layer_id\":\"layer-r1\"}}");
                    }
                    if (req.url.contains("/qorechain/ai/v1/fee-estimate")) {
                        return new Transport.Response(200, "{\"gasPrice\":\"7\"}");
                    }
                    if (req.url.contains("/qorechain/ai/v1/network/recommendations")) {
                        return new Transport.Response(200, "{\"note\":\"network congestion high\"}");
                    }
                    if (req.url.contains("/qorechain/ai/v1/fraud/investigations")) {
                        return new Transport.Response(
                                200,
                                "{\"investigations\":[{\"id\":\"f1\",\"target\":\"r1\"},"
                                        + "{\"id\":\"f2\",\"target\":\"other\"}]}");
                    }
                    if (req.body != null && req.body.contains("qor_getRLAgentStatus")) {
                        return new Transport.Response(
                                200, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"policy\":\"v3\"}}");
                    }
                    return new Transport.Response(404, "{}");
                };
        RdkClient.Options opts = new RdkClient.Options();
        opts.transport = transport;
        RdkClient client = new RdkClient(opts);

        RollupAdvice advice = Copilot.getRollupAdvice(client, "r1");
        assertEquals("paused", advice.status);
        assertEquals(1, advice.fraudInvestigations.size());
        assertTrue(advice.warnings.isEmpty());
        // Paused status, fraud match, fee estimate, and congestion all yield suggestions.
        assertTrue(advice.suggestions.size() >= 4);
    }

    @Test
    void copilotDegradesToWarningsOnFailures() {
        RdkClient.Options opts = new RdkClient.Options();
        opts.transport =
                req -> {
                    throw new RuntimeException("service down");
                };
        RdkClient client = new RdkClient(opts);
        RollupAdvice advice = Copilot.getRollupAdvice(client, "r1");
        assertEquals("unknown", advice.status);
        assertFalse(advice.warnings.isEmpty());
        // Never throws; always produces at least the "no issues" info suggestion.
        assertFalse(advice.suggestions.isEmpty());
    }
}
