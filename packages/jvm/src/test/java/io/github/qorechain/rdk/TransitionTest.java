package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import io.github.qorechain.rdk.client.Json;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.client.Views;
import io.github.qorechain.rdk.client.Views.BatchView;
import io.github.qorechain.rdk.transition.Transition;
import io.github.qorechain.rdk.transition.Transition.Version;
import io.github.qorechain.rdk.util.Bytes;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Batch transition roots against vectors from the chain's own BatchTransitionRoot. */
class TransitionTest {

    @SuppressWarnings("unchecked")
    private static Map<String, Object> golden() throws Exception {
        try (InputStream in = TransitionTest.class.getResourceAsStream("/golden.json")) {
            return (Map<String, Object>) Json.parseObject(new String(in.readAllBytes(), StandardCharsets.UTF_8))
                    .get("transitionRoot");
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void rootsMatchTheChain() throws Exception {
        Map<String, Object> t = golden();
        Transition.Input in = new Transition.Input();
        in.chainId = (String) t.get("chainId");
        in.rollupId = (String) t.get("rollupId");
        in.prevStateRoot = Bytes.hexToBytes((String) t.get("prevStateRoot"));
        in.dataHash = Bytes.hexToBytes((String) t.get("dataHash"));
        in.txCount = ((Number) t.get("txCount")).longValue();
        in.withdrawalsRoot = Bytes.hexToBytes((String) t.get("withdrawalsRoot"));
        assertEquals(t.get("v1"), Bytes.bytesToHex(Transition.rootV1(in)));
        assertEquals(t.get("v2"), Bytes.bytesToHex(Transition.rootV2(in)));
        Map<String, Object> other = (Map<String, Object>) t.get("v2OtherChain");
        String keep = in.chainId;
        in.chainId = (String) other.get("chainId");
        assertEquals(other.get("root"), Bytes.bytesToHex(Transition.root(in, Version.V2)));
        in.chainId = keep;

        Map<String, Object> empty = (Map<String, Object>) t.get("emptyBatch");
        Transition.Input e = new Transition.Input();
        e.chainId = in.chainId;
        e.rollupId = in.rollupId;
        e.prevStateRoot = in.prevStateRoot;
        e.txCount = 1;
        assertEquals(empty.get("v1"), Bytes.bytesToHex(Transition.rootV1(e)));
        assertEquals(empty.get("v2"), Bytes.bytesToHex(Transition.rootV2(e)));

        e.withdrawalsRoot = new byte[] {1, 2};
        assertThrows(IllegalArgumentException.class, () -> Transition.rootV2(e));
        e.withdrawalsRoot = new byte[0];
        e.chainId = "";
        assertThrows(IllegalArgumentException.class, () -> Transition.rootV2(e));
    }

    private static RestClient rest(int featureStatus, boolean enabled, String applied) {
        Transport t =
                req -> {
                    if (req.url.contains("protocol_features")) {
                        return featureStatus != 200
                                ? new Transport.Response(featureStatus, "{}")
                                : new Transport.Response(
                                        200,
                                        "{\"features\":[{\"name\":\"rdk-withdrawals-binding\",\"enabled\":"
                                                + enabled + "}]}");
                    }
                    if (req.url.endsWith("/applied_plan/v3.2.5")) {
                        return new Transport.Response(200, "{\"height\":\"" + applied + "\"}");
                    }
                    return new Transport.Response(404, "{}");
                };
        return new RestClient("http://node", t);
    }

    private static BatchView at(long h, boolean bound) {
        return Views.mapBatchView(Json.parseObject("{\"submitted_at\":" + h + ",\"withdrawals_bound\":" + bound + "}"));
    }

    @Test
    void versionFollowsTheChain() {
        assertEquals(Version.V2, Transition.versionFor(rest(200, true, "0")));
        assertEquals(Version.V1, Transition.versionFor(rest(200, false, "0")));
        assertEquals(Version.V1, Transition.versionFor(rest(501, false, "0")));
        assertThrows(RuntimeException.class, () -> Transition.versionFor(rest(500, false, "0")));

        RestClient r = rest(200, true, "8890800");
        assertEquals(Version.V2, Transition.versionForBatch(r, at(8_890_800, false)));
        assertEquals(Version.V1, Transition.versionForBatch(r, at(8_890_799, false)));
        assertEquals(Version.V1, Transition.versionForBatch(rest(200, false, "0"), at(9_000_000, false)));
        assertEquals(Version.V2, Transition.versionForBatch(rest(200, false, "0"), at(1, true)));
    }

    @Test
    void fraudProofLayout() {
        byte[] p = Transition.fraudProof(Bytes.hexToBytes("11".repeat(32)), Bytes.hexToBytes("22".repeat(32)));
        assertArrayEquals(Bytes.hexToBytes("11".repeat(32) + "22".repeat(32)), p);
        assertThrows(IllegalArgumentException.class, () -> Transition.fraudProof(new byte[1], p));
    }
}
