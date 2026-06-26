package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.client.QorClient;
import io.github.qorechain.rdk.client.RdkClient;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.client.Views.ParamsView;
import io.github.qorechain.rdk.client.Views.RollupView;
import java.util.List;
import org.junit.jupiter.api.Test;

class ClientTest {

    @Test
    void restClientReadsParamsRollupAndBatchViaMockTransport() {
        Transport transport =
                req -> {
                    if (req.url.endsWith("/qorechain/rdk/v1/params")) {
                        return new Transport.Response(
                                200,
                                "{\"params\":{\"max_rollups\":100,\"min_stake_for_rollup\":\"10000000000\","
                                        + "\"rollup_creation_burn_rate\":\"0.01\",\"default_challenge_window\":604800}}");
                    }
                    if (req.url.contains("/rollup/my-rollup")) {
                        return new Transport.Response(
                                200,
                                "{\"rollup\":{\"rollup_id\":\"my-rollup\",\"creator\":\"qor1abc\","
                                        + "\"status\":\"active\",\"block_time_ms\":500,\"vm_type\":\"evm\"}}");
                    }
                    if (req.url.contains("/batch/my-rollup/3")) {
                        return new Transport.Response(
                                200,
                                "{\"batch\":{\"rollup_id\":\"my-rollup\",\"batch_index\":3,"
                                        + "\"status\":\"finalized\",\"tx_count\":42}}");
                    }
                    return new Transport.Response(404, "{}");
                };
        RestClient rest = new RestClient("http://node.test", transport);

        ParamsView params = rest.getParams();
        assertEquals(100, params.maxRollups);
        assertEquals("10000000000", params.minStakeForRollup);
        assertEquals("0.01", params.rollupCreationBurnRate);
        assertEquals(604800, params.defaultChallengeWindow);

        RollupView rollup = rest.getRollup("my-rollup");
        assertEquals("my-rollup", rollup.rollupId);
        assertEquals("active", rollup.status);
        assertEquals(500, rollup.blockTimeMs);

        BatchView batch = rest.getBatch("my-rollup", 3);
        assertEquals(3, batch.batchIndex);
        assertEquals("finalized", batch.status);
        assertEquals(42, batch.txCount);
    }

    @Test
    void restClientListsRollups() {
        Transport transport =
                req ->
                        new Transport.Response(
                                200,
                                "{\"rollups\":[{\"rollup_id\":\"a\",\"status\":\"active\"},"
                                        + "{\"rollup_id\":\"b\",\"status\":\"paused\"}]}");
        RestClient rest = new RestClient("http://node.test", transport);
        List<RollupView> rollups = rest.listRollups();
        assertEquals(2, rollups.size());
        assertEquals("a", rollups.get(0).rollupId);
        assertEquals("paused", rollups.get(1).status);
    }

    @Test
    void qorClientCallsJsonRpcViaMockTransport() {
        Transport transport =
                req -> {
                    assertTrue(req.body.contains("qor_getRollupStatus"));
                    return new Transport.Response(
                            200, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"status\":\"active\"}}");
                };
        QorClient qor = new QorClient("http://node.test:8545", transport);
        assertEquals("active", qor.getRollupStatus("r1").get("status"));
    }

    @Test
    void rdkClientResolvesNetworkAndComposesClients() {
        RdkClient.Options opts = new RdkClient.Options();
        opts.network = "mainnet";
        opts.transport = req -> new Transport.Response(200, "{}");
        RdkClient client = new RdkClient(opts);
        assertEquals("mainnet", client.network.name);
        assertEquals("qorechain-vladi", client.network.chainId);
    }

    @Test
    void rdkClientSuggestProfileFallsBackOnError() {
        RdkClient.Options opts = new RdkClient.Options();
        opts.transport =
                req -> {
                    throw new RuntimeException("rpc down");
                };
        RdkClient client = new RdkClient(opts);
        RdkClient.ProfileSuggestion s = client.suggestProfile("an nft marketplace", null);
        assertEquals("fallback", s.source);
    }
}
