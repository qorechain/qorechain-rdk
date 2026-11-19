package rdk

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Posts reach a rollup's inbox through every wrapper the chain executes on
// someone's behalf. A watcher that cannot read one back cannot check (or
// challenge) the batch that consumes it, so the fetcher must find every one.

type wrapShape string

const (
	shapeTop        wrapShape = "top"
	shapeExec       wrapShape = "exec"
	shapeNested     wrapShape = "nested"
	shapeMixed      wrapShape = "mixed"
	shapeGroupTry   wrapShape = "group-try"
	shapeGroupLater wrapShape = "group-later"
	shapeLost       wrapShape = "lost"
)

func wrapPost(env QledgerEnv, e QledgerEntry) map[string]any {
	return map[string]any{"@type": TypeURLMsgPostRollupData, "poster": e.Poster, "rollup_id": env.RollupID,
		"data": base64.StdEncoding.EncodeToString(e.Payload)}
}

func wrapExec(msgs ...any) map[string]any {
	return map[string]any{"@type": "/cosmos.authz.v1beta1.MsgExec", "grantee": "qor1grantee", "msgs": msgs}
}

var wrapSend = map[string]any{"@type": "/cosmos.bank.v1beta1.MsgSend", "from_address": "qor1x", "to_address": "qor1y",
	"amount": []any{map[string]any{"denom": "uqor", "amount": "1"}}}

func isDepositEntry(e QledgerEntry) bool {
	return strings.HasPrefix(e.Poster, QledgerDepositPosterPrefix)
}

// effectiveEntries are the entries as the chain records them for shape (a
// mixed transaction lands all its posts at one height).
func effectiveEntries(shape wrapShape, entries []QledgerEntry) []QledgerEntry {
	if shape != shapeMixed {
		return entries
	}
	var last uint64
	for _, e := range entries {
		if !isDepositEntry(e) {
			last = e.Height
		}
	}
	out := make([]QledgerEntry, len(entries))
	for i, e := range entries {
		out[i] = e
		if !isDepositEntry(e) {
			out[i].Height = last
		}
	}
	return out
}

type wrapNode struct {
	posts, deposits []any
	submits         map[string][]any
	queries         []string
	head            uint64
	rangeHash       string
}

func newWrapNode(t *testing.T, env QledgerEnv, shape wrapShape, raw []QledgerEntry) *wrapNode {
	t.Helper()
	entries := effectiveEntries(shape, raw)
	n := &wrapNode{submits: map[string][]any{}, head: uint64(len(entries))}
	attr := func(k, v string) any { return map[string]any{"key": k, "value": v} }
	var acc []byte
	mixedMsgs := []any{wrapSend}
	var mixedEvents []any
	var mixedHeight uint64
	for i, e := range entries {
		acc = QledgerAccumulate(env.ChainID, env.RollupID, uint64(i), acc, []QledgerEntry{e})
		seq := strconv.Itoa(i + 1)
		if isDepositEntry(e) {
			id, amount, _ := DecodeQledgerDeposit(e.Payload)
			n.deposits = append(n.deposits, map[string]any{
				"height": strconv.FormatUint(e.Height, 10), "txhash": "D" + seq,
				"events": []any{map[string]any{"type": "rdk_rollup_deposit", "attributes": []any{
					attr("rollup_id", env.RollupID), attr("depositor", strings.TrimPrefix(e.Poster, QledgerDepositPosterPrefix)),
					attr("account", BytesToHex(id[:])), attr("amount", strconv.FormatUint(amount, 10)+"uqor"), attr("sequence", seq),
				}}},
			})
			continue
		}
		event := map[string]any{"type": "rdk_data_posted", "attributes": []any{
			attr("rollup_id", env.RollupID), attr("sequence", seq),
			attr("data_hash", BytesToHex(PostedDataHash(e.Payload))), attr("poster", e.Poster),
			attr("inbox_acc", BytesToHex(acc)),
		}}
		tx := func(msgs ...any) map[string]any {
			return map[string]any{"height": strconv.FormatUint(e.Height, 10), "txhash": "P" + seq,
				"tx": map[string]any{"body": map[string]any{"messages": msgs}}, "events": []any{event}}
		}
		post := wrapPost(env, e)
		switch shape {
		case shapeTop:
			n.posts = append(n.posts, tx(post))
		case shapeExec:
			n.posts = append(n.posts, tx(wrapExec(post)))
		case shapeNested:
			n.posts = append(n.posts, tx(wrapExec(wrapExec(wrapExec(post)))))
		case shapeMixed:
			// One transaction: a top-level post, posts under one and two MsgExec levels.
			switch len(mixedMsgs) % 3 {
			case 0:
				mixedMsgs = append(mixedMsgs, post)
			case 1:
				mixedMsgs = append(mixedMsgs, wrapExec(post))
			default:
				mixedMsgs = append(mixedMsgs, wrapExec(wrapSend, wrapExec(post)))
			}
			mixedEvents = append(mixedEvents, event)
			mixedHeight = e.Height
		case shapeGroupTry:
			n.posts = append(n.posts, tx(map[string]any{"@type": "/cosmos.group.v1.MsgSubmitProposal",
				"group_policy_address": "qor1policy", "proposers": []any{"qor1member"}, "messages": []any{post}, "exec": "EXEC_TRY"}))
		case shapeGroupLater:
			// Submitted (inside a MsgExec) in one transaction, executed by MsgExec of x/group in another.
			id := strconv.Itoa(100 + i + 1)
			n.submits[id] = append(n.submits[id], map[string]any{"height": strconv.FormatUint(e.Height-1, 10), "txhash": "S" + seq,
				"tx": map[string]any{"body": map[string]any{"messages": []any{wrapExec(map[string]any{
					"@type": "/cosmos.group.v1.MsgSubmitProposal", "group_policy_address": "qor1policy",
					"proposers": []any{"qor1member"}, "messages": []any{post}})}}}, "events": []any{}})
			n.posts = append(n.posts, tx(map[string]any{"@type": "/cosmos.group.v1.MsgExec", "proposal_id": id, "executor": "qor1member"}))
		case shapeLost:
			// The event is there, the bytes are not (a contract or governance post).
			n.posts = append(n.posts, tx(map[string]any{"@type": "/cosmwasm.wasm.v1.MsgExecuteContract", "sender": "qor1s",
				"contract": "qor1c", "msg": map[string]any{}}))
		}
	}
	if shape == shapeMixed {
		n.posts = append(n.posts, map[string]any{"height": strconv.FormatUint(mixedHeight, 10), "txhash": "MIXED",
			"tx": map[string]any{"body": map[string]any{"messages": mixedMsgs}}, "events": mixedEvents})
	}
	n.rangeHash = BytesToHex(InboxRangeHash(InboxRangeInput{ChainID: env.ChainID, RollupID: env.RollupID, To: n.head, AccTo: acc}))
	return n
}

var proposalIDQuery = regexp.MustCompile(`proposal_id='"(\d+)"'`)

func (n *wrapNode) rest(t *testing.T) *RestClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cosmos/tx/v1beta1/txs" {
			q := r.URL.Query().Get("query")
			n.queries = append(n.queries, q)
			var txs []any
			switch {
			case strings.HasPrefix(q, "rdk_data_posted."):
				txs = n.posts
			case strings.HasPrefix(q, "rdk_rollup_deposit."):
				txs = n.deposits
			case strings.HasPrefix(q, "cosmos.group.v1.EventSubmitProposal.proposal_id="):
				if m := proposalIDQuery.FindStringSubmatch(q); m != nil {
					txs = n.submits[m[1]]
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"tx_responses": txs, "total": strconv.Itoa(len(txs))})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/qorechain/rdk/v1/inbox/") {
			h := strconv.FormatUint(n.head, 10)
			_ = json.NewEncoder(w).Encode(map[string]any{"inbox": map[string]any{"head_sequence": h, "consumed_sequence": "0",
				"consumed_acc": strings.Repeat("00", 32), "range_end": h, "range_data_hash": n.rangeHash}})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/cosmos/group/v1/proposal/") {
			// An executed group proposal is pruned: the node answers 500 "not found".
			http.Error(w, `{"code":2,"message":"not found: load proposal"}`, http.StatusInternalServerError)
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(srv.Close)
	return NewRestClient(srv.URL, srv.Client())
}

func TestFetchQledgerEntriesThroughWrappers(t *testing.T) {
	_, env, entries := loadQledger(t)
	for _, shape := range []wrapShape{shapeTop, shapeExec, shapeNested, shapeMixed, shapeGroupTry, shapeGroupLater} {
		t.Run(string(shape), func(t *testing.T) {
			node := newWrapNode(t, env, shape, entries)
			got, err := FetchQledgerEntries(context.Background(), node.rest(t),
				FetchQledgerEntriesInput{ChainID: env.ChainID, RollupID: env.RollupID, To: node.head})
			if err != nil {
				t.Fatal(err)
			}
			want := effectiveEntries(shape, entries)
			if len(got) != len(want) {
				t.Fatalf("%d entries, want %d", len(got), len(want))
			}
			for i := range want {
				if got[i].Height != want[i].Height || got[i].Poster != want[i].Poster || BytesToHex(got[i].Payload) != BytesToHex(want[i].Payload) {
					t.Errorf("entry %d differs", i+1)
				}
			}
			if shape == shapeTop {
				wantQ := "rdk_data_posted.rollup_id='" + env.RollupID + "' AND rdk_data_posted.sequence>0 AND rdk_data_posted.sequence<=" +
					strconv.FormatUint(node.head, 10)
				found := false
				for _, q := range node.queries {
					found = found || q == wantQ
				}
				if !found {
					t.Errorf("queries %v lack %q", node.queries, wantQ)
				}
			}
		})
	}
}

func TestFetchQledgerEntriesRefusesUnreadablePosts(t *testing.T) {
	_, env, entries := loadQledger(t)
	node := newWrapNode(t, env, shapeLost, entries)
	_, err := FetchQledgerEntries(context.Background(), node.rest(t),
		FetchQledgerEntriesInput{ChainID: env.ChainID, RollupID: env.RollupID, To: node.head})
	if err == nil || !strings.Contains(err.Error(), "cannot be read back") {
		t.Errorf("a post whose bytes are in no transaction: %v", err)
	}
}

func TestCollectPostedPayloads(t *testing.T) {
	_, env, entries := loadQledger(t)
	var posts []QledgerEntry
	for _, e := range entries {
		if !isDepositEntry(e) {
			posts = append(posts, e)
		}
	}
	p := NewPostedPayloads()
	msgs := []any{wrapSend, wrapPost(env, posts[0]), wrapExec(wrapPost(env, posts[1])), wrapExec(wrapSend, wrapExec(wrapPost(env, posts[2])))}
	if err := CollectPostedPayloads(msgs, p); err != nil {
		t.Fatal(err)
	}
	if len(p.Payloads) != 3 {
		t.Errorf("%d payloads, want 3", len(p.Payloads))
	}
	for _, e := range posts[:3] {
		if BytesToHex(p.Payloads[BytesToHex(PostedDataHash(e.Payload))]) != BytesToHex(e.Payload) {
			t.Error("a payload of the mixed transaction is missing")
		}
	}

	deep := any(wrapPost(env, posts[0]))
	for i := 0; i < 40; i++ {
		deep = wrapExec(deep)
	}
	if err := CollectPostedPayloads([]any{deep}, NewPostedPayloads()); err == nil || !strings.Contains(err.Error(), "nest deeper") {
		t.Errorf("messages nested past the bound: %v", err)
	}
}

func TestSearchTxsRefusesPartialLists(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"tx_responses": []any{map[string]any{"txhash": "a"}, map[string]any{"txhash": "b"}}, "total": "10"})
	}))
	t.Cleanup(srv.Close)
	rest := NewRestClient(srv.URL, srv.Client())
	if _, err := rest.SearchTxs(context.Background(), "x.y='z'", SearchTxsOptions{PageLimit: 2, MaxPages: 3}); err == nil ||
		!strings.Contains(err.Error(), "more than 6") {
		t.Errorf("a truncated search: %v", err)
	}
	all, err := rest.SearchTxs(context.Background(), "x.y='z'", SearchTxsOptions{PageLimit: 2, MaxPages: 5})
	if err != nil || len(all) != 10 {
		t.Errorf("a complete search: %d %v", len(all), err)
	}
}
