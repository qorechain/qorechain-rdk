package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.Gson;
import io.github.qorechain.rdk.client.RestClient;
import io.github.qorechain.rdk.client.Transport;
import io.github.qorechain.rdk.inbox.Inbox;
import io.github.qorechain.rdk.qledger.QledgerBatch;
import io.github.qorechain.rdk.qledger.QledgerBatch.PostedPayloads;
import io.github.qorechain.rdk.qledger.QledgerEntry;
import io.github.qorechain.rdk.qledger.QledgerTx;
import io.github.qorechain.rdk.util.Bytes;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

/**
 * Posts reach a rollup's inbox through every wrapper the chain executes on someone's behalf. A
 * watcher that cannot read one back cannot check (or challenge) the batch that consumes it, so the
 * fetcher must find every one.
 */
class QledgerWrappedTest {
    private static final QledgerFixture Q = QledgerFixture.load();
    private static final List<QledgerEntry> ENTRIES = Q.qledgerEntries();
    private static final String POST = "/qorechain.rdk.v1.MsgPostRollupData";

    private static boolean isDeposit(QledgerEntry e) {
        return e.poster.startsWith("deposit:");
    }

    /** The entries as the chain records them (a mixed transaction lands all its posts at one height). */
    private static List<QledgerEntry> effective(String shape) {
        if (!shape.equals("mixed")) {
            return ENTRIES;
        }
        long last = 0;
        for (QledgerEntry e : ENTRIES) {
            if (!isDeposit(e)) {
                last = e.height;
            }
        }
        List<QledgerEntry> out = new ArrayList<>();
        for (QledgerEntry e : ENTRIES) {
            out.add(isDeposit(e) ? e : new QledgerEntry(last, e.poster, e.payload));
        }
        return out;
    }

    private static Map<String, Object> post(QledgerEntry e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("@type", POST);
        m.put("poster", e.poster);
        m.put("rollup_id", Q.rollupId);
        m.put("data", Base64.getEncoder().encodeToString(e.payload));
        return m;
    }

    private static Map<String, Object> exec(Object... msgs) {
        return Map.of("@type", "/cosmos.authz.v1beta1.MsgExec", "grantee", "qor1grantee", "msgs", List.of(msgs));
    }

    private static final Map<String, Object> SEND =
            Map.of(
                    "@type", "/cosmos.bank.v1beta1.MsgSend",
                    "from_address", "qor1x",
                    "to_address", "qor1y",
                    "amount", List.of(Map.of("denom", "uqor", "amount", "1")));

    private static Map<String, String> attr(String k, String v) {
        return Map.of("key", k, "value", v);
    }

    private static final class Node {
        final List<QledgerEntry> entries;
        final int head;
        final List<Map<String, Object>> posts = new ArrayList<>();
        final List<Map<String, Object>> deposits = new ArrayList<>();
        final Map<String, List<Map<String, Object>>> submits = new HashMap<>();
        final List<String> queries = new ArrayList<>();
        byte[] acc = new byte[0];

        Node(String shape) {
            entries = effective(shape);
            head = entries.size();
            List<Object> mixedMsgs = new ArrayList<>(List.of(SEND));
            List<Object> mixedEvents = new ArrayList<>();
            long mixedHeight = 0;
            for (int i = 0; i < entries.size(); i++) {
                QledgerEntry e = entries.get(i);
                acc = QledgerBatch.accumulate(Q.chainId, Q.rollupId, i, acc, List.of(e));
                String seq = String.valueOf(i + 1);
                if (isDeposit(e)) {
                    QledgerTx.Deposit d = QledgerTx.decodeDeposit(e.payload);
                    deposits.add(
                            Map.of(
                                    "height", String.valueOf(e.height),
                                    "txhash", "D" + seq,
                                    "events",
                                    List.of(
                                            Map.of(
                                                    "type", "rdk_rollup_deposit",
                                                    "attributes",
                                                    List.of(
                                                            attr("rollup_id", Q.rollupId),
                                                            attr("depositor", e.poster.substring(8)),
                                                            attr("account", Bytes.bytesToHex(d.account)),
                                                            attr("amount", Long.toUnsignedString(d.amount) + "uqor"),
                                                            attr("sequence", seq))))));
                    continue;
                }
                Map<String, Object> event =
                        Map.of(
                                "type", "rdk_data_posted",
                                "attributes",
                                List.of(
                                        attr("rollup_id", Q.rollupId),
                                        attr("sequence", seq),
                                        attr("data_hash", Bytes.bytesToHex(Inbox.postedDataHash(e.payload))),
                                        attr("poster", e.poster)));
                Map<String, Object> p = post(e);
                Object msg;
                switch (shape) {
                    case "top":
                        msg = p;
                        break;
                    case "exec":
                        msg = exec(p);
                        break;
                    case "nested":
                        msg = exec(exec(exec(p)));
                        break;
                    case "mixed":
                        // One transaction: a top-level post, posts under one and two MsgExec levels.
                        int k = mixedMsgs.size() % 3;
                        mixedMsgs.add(k == 0 ? p : k == 1 ? exec(p) : exec(SEND, exec(p)));
                        mixedEvents.add(event);
                        mixedHeight = e.height;
                        continue;
                    case "group-try":
                        msg =
                                Map.of(
                                        "@type", "/cosmos.group.v1.MsgSubmitProposal",
                                        "group_policy_address", "qor1policy",
                                        "proposers", List.of("qor1member"),
                                        "messages", List.of(p),
                                        "exec", "EXEC_TRY");
                        break;
                    case "group-later":
                        // Submitted (inside a MsgExec) in one transaction, executed by MsgExec of x/group in another.
                        String id = String.valueOf(100 + i + 1);
                        submits.put(
                                id,
                                List.of(
                                        Map.of(
                                                "height", String.valueOf(e.height - 1),
                                                "txhash", "S" + seq,
                                                "events", List.of(),
                                                "tx",
                                                Map.of(
                                                        "body",
                                                        Map.of(
                                                                "messages",
                                                                List.of(
                                                                        exec(
                                                                                Map.of(
                                                                                        "@type", "/cosmos.group.v1.MsgSubmitProposal",
                                                                                        "group_policy_address", "qor1policy",
                                                                                        "proposers", List.of("qor1member"),
                                                                                        "messages", List.of(p)))))))));
                        msg = Map.of("@type", "/cosmos.group.v1.MsgExec", "proposal_id", id, "executor", "qor1member");
                        break;
                    default:
                        // "lost": the event is there, the bytes are not (a contract or governance post).
                        msg =
                                Map.of(
                                        "@type", "/cosmwasm.wasm.v1.MsgExecuteContract",
                                        "sender", "qor1s",
                                        "contract", "qor1c",
                                        "msg", Map.of());
                }
                posts.add(
                        Map.of(
                                "height", String.valueOf(e.height),
                                "txhash", "P" + seq,
                                "tx", Map.of("body", Map.of("messages", List.of(msg))),
                                "events", List.of(event)));
            }
            if (shape.equals("mixed")) {
                posts.add(
                        Map.of(
                                "height", String.valueOf(mixedHeight),
                                "txhash", "MIXED",
                                "tx", Map.of("body", Map.of("messages", mixedMsgs)),
                                "events", mixedEvents));
            }
        }

        RestClient rest() {
            Gson gson = new Gson();
            Pattern pid = Pattern.compile("proposal_id='\"(\\d+)\"'");
            MockTransport t =
                    new MockTransport(
                            req -> {
                                String path = req.url.replace("http://node", "");
                                if (path.startsWith("/cosmos/tx/v1beta1/txs?query=")) {
                                    String q =
                                            URLDecoder.decode(
                                                    path.split("query=")[1].split("&")[0], StandardCharsets.UTF_8);
                                    queries.add(q);
                                    List<Map<String, Object>> txs = List.of();
                                    if (q.startsWith("rdk_data_posted.")) {
                                        txs = posts;
                                    } else if (q.startsWith("rdk_rollup_deposit.")) {
                                        txs = deposits;
                                    } else {
                                        Matcher m = pid.matcher(q);
                                        if (q.startsWith("cosmos.group.v1.EventSubmitProposal.") && m.find()) {
                                            txs = submits.getOrDefault(m.group(1), List.of());
                                        }
                                    }
                                    return new Transport.Response(
                                            200, gson.toJson(Map.of("tx_responses", txs, "total", String.valueOf(txs.size()))));
                                }
                                if (path.equals("/qorechain/rdk/v1/posted_data/" + Q.rollupId + "/" + head)) {
                                    return new Transport.Response(
                                            200,
                                            gson.toJson(
                                                    Map.of(
                                                            "posted_data",
                                                            Map.of("sequence", String.valueOf(head), "inbox_acc", Bytes.bytesToHex(acc)))));
                                }
                                if (path.startsWith("/cosmos/group/v1/proposal/")) {
                                    // An executed group proposal is pruned: the node answers 500 "not found".
                                    return new Transport.Response(500, "{\"code\":2}");
                                }
                                return null;
                            });
            return new RestClient("http://node", t);
        }

        List<QledgerEntry> read() {
            return QledgerBatch.fetchEntries(rest(), Q.chainId, Q.rollupId, 0, head, new byte[0]);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"top", "exec", "nested", "mixed", "group-try", "group-later"})
    void findsPostsThroughEveryWrapper(String shape) {
        List<QledgerEntry> got = new Node(shape).read();
        List<QledgerEntry> want = effective(shape);
        assertEquals(want.size(), got.size());
        for (int i = 0; i < want.size(); i++) {
            assertEquals(want.get(i).height, got.get(i).height, shape + " entry " + (i + 1));
            assertEquals(want.get(i).poster, got.get(i).poster, shape + " entry " + (i + 1));
            assertEquals(Bytes.bytesToHex(want.get(i).payload), Bytes.bytesToHex(got.get(i).payload), shape + " entry " + (i + 1));
        }
    }

    @Test
    void asksOnlyForTheSequencesItNeeds() {
        Node node = new Node("top");
        node.read();
        for (String ev : List.of("rdk_data_posted", "rdk_rollup_deposit")) {
            String q = ev + ".rollup_id='" + Q.rollupId + "' AND " + ev + ".sequence>0 AND " + ev + ".sequence<=" + node.head;
            assertTrue(node.queries.contains(q), node.queries + " lacks " + q);
        }
    }

    @Test
    void refusesAPostWhoseBytesAreInNoTransaction() {
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> new Node("lost").read());
        assertTrue(e.getMessage().contains("cannot be read back"), e.getMessage());
    }

    @Test
    void matchesEveryPostOfAMixedTransactionAndBoundsNesting() {
        List<QledgerEntry> posts = new ArrayList<>();
        for (QledgerEntry e : ENTRIES) {
            if (!isDeposit(e) && posts.size() < 3) {
                posts.add(e);
            }
        }
        PostedPayloads found =
                QledgerBatch.collectPostedPayloads(
                        List.of(SEND, post(posts.get(0)), exec(post(posts.get(1))), exec(SEND, exec(post(posts.get(2))))), null);
        assertEquals(3, found.payloads.size());
        for (QledgerEntry p : posts) {
            assertEquals(
                    Bytes.bytesToHex(p.payload),
                    Bytes.bytesToHex(found.payloads.get(Bytes.bytesToHex(Inbox.postedDataHash(p.payload)))));
        }

        Object deep = post(posts.get(0));
        for (int i = 0; i < 40; i++) {
            deep = exec(deep);
        }
        Object nested = deep;
        IllegalStateException e =
                assertThrows(IllegalStateException.class, () -> QledgerBatch.collectPostedPayloads(List.of(nested), null));
        assertTrue(e.getMessage().contains("nest deeper"), e.getMessage());
    }

    @Test
    void searchTxsRefusesPartialLists() {
        Gson gson = new Gson();
        MockTransport t =
                new MockTransport(
                        req ->
                                new Transport.Response(
                                        200,
                                        gson.toJson(
                                                Map.of(
                                                        "tx_responses", List.of(Map.of("txhash", "a"), Map.of("txhash", "b")),
                                                        "total", "10"))));
        RestClient rest = new RestClient("http://node", t);
        IllegalStateException e = assertThrows(IllegalStateException.class, () -> rest.searchTxs("x.y='z'", 2, 3));
        assertTrue(e.getMessage().contains("more than 6"), e.getMessage());
        assertEquals(10, rest.searchTxs("x.y='z'", 2, 5).size());
    }
}
