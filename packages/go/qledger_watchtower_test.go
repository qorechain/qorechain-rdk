package rdk

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// watchBatch is a settlement batch as a node serves it. Byte fields are hex
// here and served base64, as the chain's gateway encodes proto bytes.
type watchBatch struct {
	Index                              int
	Status                             string
	Prev, State, Withdrawals, DataHash string
	TxCount                            int
	Start, End                         uint64
}

func wireB64(t *testing.T, h string) string {
	t.Helper()
	return base64.StdEncoding.EncodeToString(mustHex(t, h))
}

func (b watchBatch) raw(t *testing.T) map[string]any {
	t.Helper()
	return map[string]any{
		"batch_index":       strconv.Itoa(b.Index),
		"status":            b.Status,
		"prev_state_root":   wireB64(t, b.Prev),
		"state_root":        wireB64(t, b.State),
		"withdrawals_root":  wireB64(t, b.Withdrawals),
		"data_hash":         wireB64(t, b.DataHash),
		"tx_count":          strconv.Itoa(b.TxCount),
		"inbox_start":       strconv.FormatUint(b.Start, 10),
		"inbox_end":         strconv.FormatUint(b.End, 10),
		"submitted_at":      "100",
		"withdrawals_bound": true,
	}
}

// qledgerWatchNode is a node serving one qledger-v1 rollup: its batches, and
// the inbox accumulator after each post it still holds.
type qledgerWatchNode struct {
	mu    sync.Mutex
	paths []string
}

func (n *qledgerWatchNode) requests(prefix string) int {
	n.mu.Lock()
	defer n.mu.Unlock()
	c := 0
	for _, p := range n.paths {
		if strings.HasPrefix(p, prefix) {
			c++
		}
	}
	return c
}

func newQledgerWatchNode(t *testing.T, env QledgerEnv, batches []watchBatch, accs map[uint64]string) (*RdkClient, *qledgerWatchNode) {
	t.Helper()
	raw := make([]any, len(batches))
	for i, b := range batches {
		raw[i] = b.raw(t)
	}
	n := &qledgerWatchNode{}
	postedPrefix := "/qorechain/rdk/v1/posted_data/" + env.RollupID + "/"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.mu.Lock()
		n.paths = append(n.paths, r.URL.Path)
		n.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/qorechain/rdk/v1/batches/"+env.RollupID:
			_ = json.NewEncoder(w).Encode(map[string]any{"batches": raw, "next_index": "0"})
		case strings.HasPrefix(r.URL.Path, postedPrefix):
			seq, err := strconv.ParseUint(strings.TrimPrefix(r.URL.Path, postedPrefix), 10, 64)
			acc, ok := accs[seq]
			if err != nil || !ok {
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"code":5,"message":"not found"}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"posted_data": map[string]any{
				"rollup_id": env.RollupID, "sequence": strconv.FormatUint(seq, 10), "inbox_acc": wireB64(t, acc),
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	client := NewRdkClient(RdkClientOptions{Network: "testnet", Endpoints: &Endpoints{Rest: srv.URL, RPC: srv.URL}, HTTP: srv.Client()})
	if client.Network.ChainID != env.ChainID {
		t.Fatalf("the fixture is for %s, the client for %s", env.ChainID, client.Network.ChainID)
	}
	return client, n
}

// qledgerBatchAt reads batch index from the node, the first served with that
// index.
func qledgerBatchAt(t *testing.T, client *RdkClient, rollupID string, index int) BatchView {
	t.Helper()
	all, err := client.Rest.ListBatches(context.Background(), rollupID)
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range all {
		if b.BatchIndex == index {
			return b
		}
	}
	t.Fatalf("no batch %d", index)
	return BatchView{}
}

// qledgerReader serves entries From+1 .. To from list, whose first entry is
// sequence start+1, as a node's transaction index would.
func qledgerReader(list []QledgerEntry, start uint64) QledgerEntryReader {
	return func(_ context.Context, r QledgerEntryRange) ([]QledgerEntry, error) {
		if r.From < start || r.To < r.From || r.To-start > uint64(len(list)) {
			return nil, fmt.Errorf("no entries %d..%d", r.From, r.To)
		}
		return list[r.From-start : r.To-start], nil
	}
}

// qledgerWatchFixture is the fixture's qledger batch: 11 inbox entries
// (sequences 4 to 14), settled from the empty ledger, with the roots the chain
// accepted.
func qledgerWatchFixture(t *testing.T) (qledgerFixture, QledgerEnv, []QledgerEntry, watchBatch, map[uint64]string) {
	t.Helper()
	q, env, entries := loadQledger(t)
	honest := watchBatch{
		Index:       0,
		Status:      string(BatchSubmitted),
		Prev:        q.EmptyRoot,
		State:       q.Batch.StateRoot,
		Withdrawals: q.Batch.WithdrawalsRoot,
		DataHash:    q.Batch.DataHash,
		TxCount:     len(entries),
		Start:       q.Batch.InboxStart,
		End:         q.Batch.InboxEnd,
	}
	return q, env, entries, honest, map[uint64]string{q.Batch.InboxStart: q.Batch.AccFrom}
}

func qledgerClaimFor(t *testing.T, b watchBatch) QledgerClaim {
	t.Helper()
	return QledgerClaim{
		InboxStart:      b.Start,
		InboxEnd:        b.End,
		DataHash:        mustHex(t, b.DataHash),
		PrevStateRoot:   mustHex(t, b.Prev),
		StateRoot:       mustHex(t, b.State),
		WithdrawalsRoot: mustHex(t, b.Withdrawals),
	}
}

// Why QledgerValidator exists: an honest qledger-v1 batch publishes the root of
// its account tree, never the canonical transition root, so the
// transition-root rule reports it as invalid under either binding.
func TestQledgerBatchFailsTheTransitionRootRule(t *testing.T) {
	q, env, entries, _, _ := qledgerWatchFixture(t)
	in := TransitionInput{
		ChainID:         env.ChainID,
		RollupID:        env.RollupID,
		PrevStateRoot:   mustHex(t, q.EmptyRoot),
		DataHash:        mustHex(t, q.Batch.DataHash),
		TxCount:         uint64(len(entries)),
		WithdrawalsRoot: mustHex(t, q.Batch.WithdrawalsRoot),
	}
	for _, version := range []string{"v1", "v2"} {
		root, err := BatchTransitionRoot(in, version)
		if err != nil {
			t.Fatal(err)
		}
		if BytesToHex(root) == q.Batch.StateRoot {
			t.Errorf("%s: the transition root is the qledger state root", version)
		}
	}
}

func TestQledgerValidatorAcceptsAnHonestBatch(t *testing.T) {
	q, env, entries, honest, accs := qledgerWatchFixture(t)
	client, node := newQledgerWatchNode(t, env, []watchBatch{honest}, accs)
	ctx := context.Background()
	b := qledgerBatchAt(t, client, env.RollupID, 0)
	opts := QledgerValidatorOptions{ReadEntries: qledgerReader(entries, q.Batch.InboxStart)}

	valid, err := QledgerValidator(client, env.RollupID, opts)(ctx, b)
	if err != nil || !valid {
		t.Fatalf("the honest batch: valid %v, %v", valid, err)
	}
	proof, err := QledgerFraudProofForBatch(ctx, client, env.RollupID, b, opts)
	if err != nil || proof != nil {
		t.Errorf("a proof against the honest batch: %x, %v", proof, err)
	}
	j, err := NewQledgerJudge(client, env.RollupID, opts).Judge(ctx, b)
	if err != nil {
		t.Fatal(err)
	}
	if !j.Valid || j.Proof != nil || BytesToHex(j.Honest.StateRoot) != q.Batch.StateRoot ||
		BytesToHex(j.Honest.WithdrawalsRoot) != q.Batch.WithdrawalsRoot || len(j.Honest.Withdrawals) != len(q.Batch.Withdrawals) {
		t.Errorf("judgement %+v", j)
	}
	// The injected reader is used: the node's transaction index is never searched.
	if n := node.requests("/cosmos/tx/"); n != 0 {
		t.Errorf("%d transaction searches with an injected reader", n)
	}

	// A node that serves roots as hex is read the same.
	hexed := b
	hexed.PrevStateRoot, hexed.StateRoot, hexed.WithdrawalsRoot, hexed.DataHash = q.EmptyRoot, q.Batch.StateRoot, q.Batch.WithdrawalsRoot, q.Batch.DataHash
	if valid, err := QledgerValidator(client, env.RollupID, opts)(ctx, hexed); err != nil || !valid {
		t.Errorf("the honest batch, hex roots: valid %v, %v", valid, err)
	}
}

func TestQledgerValidatorRejectsAWrongStateRoot(t *testing.T) {
	q, env, entries, honest, accs := qledgerWatchFixture(t)
	wrong := honest
	wrong.State = strings.Repeat("ab", 32)
	client, _ := newQledgerWatchNode(t, env, []watchBatch{wrong}, accs)
	ctx := context.Background()
	b := qledgerBatchAt(t, client, env.RollupID, 0)
	opts := QledgerValidatorOptions{ReadEntries: qledgerReader(entries, q.Batch.InboxStart)}

	valid, err := QledgerValidator(client, env.RollupID, opts)(ctx, b)
	if err != nil || valid {
		t.Fatalf("a wrong state root: valid %v, %v", valid, err)
	}
	proof, err := QledgerFraudProofForBatch(ctx, client, env.RollupID, b, opts)
	if err != nil || proof == nil {
		t.Fatalf("no proof against a wrong state root: %v", err)
	}
	// The chain's own check upholds the proof.
	claim := qledgerClaimFor(t, wrong)
	if fraud, err := CheckQledgerFraud(env, claim, proof); err != nil || !fraud {
		t.Errorf("the proof against the wrong root: fraud %v, %v", fraud, err)
	}
	// The same proof does not win against the honest roots.
	claim.StateRoot = mustHex(t, honest.State)
	if fraud, err := CheckQledgerFraud(env, claim, proof); err != nil || fraud {
		t.Errorf("the proof against the honest root: fraud %v, %v", fraud, err)
	}
	j, err := NewQledgerJudge(client, env.RollupID, opts).Judge(ctx, b)
	if err != nil || j.Valid || !bytes.Equal(j.Proof, proof) || BytesToHex(j.Honest.StateRoot) != q.Batch.StateRoot {
		t.Errorf("judgement %+v, %v", j, err)
	}
}

func TestQledgerValidatorRejectsAWrongWithdrawalsRoot(t *testing.T) {
	q, env, entries, honest, accs := qledgerWatchFixture(t)
	wrong := honest
	wrong.Withdrawals = strings.Repeat("cd", 32)
	client, _ := newQledgerWatchNode(t, env, []watchBatch{wrong}, accs)
	ctx := context.Background()
	b := qledgerBatchAt(t, client, env.RollupID, 0)
	opts := QledgerValidatorOptions{ReadEntries: qledgerReader(entries, q.Batch.InboxStart)}

	valid, err := QledgerValidator(client, env.RollupID, opts)(ctx, b)
	if err != nil || valid {
		t.Fatalf("a wrong withdrawals root: valid %v, %v", valid, err)
	}
	proof, err := QledgerFraudProofForBatch(ctx, client, env.RollupID, b, opts)
	if err != nil || proof == nil {
		t.Fatalf("no proof against a wrong withdrawals root: %v", err)
	}
	if fraud, err := CheckQledgerFraud(env, qledgerClaimFor(t, wrong), proof); err != nil || !fraud {
		t.Errorf("the proof against the wrong withdrawals root: fraud %v, %v", fraud, err)
	}
}

func TestQledgerValidatorLeavesForeignEntriesUndecided(t *testing.T) {
	_, env, entries, honest, accs := qledgerWatchFixture(t)
	client, _ := newQledgerWatchNode(t, env, []watchBatch{honest}, accs)
	ctx := context.Background()
	b := qledgerBatchAt(t, client, env.RollupID, 0)

	short := entries[:len(entries)-1]
	swapped := append([]QledgerEntry{}, entries...)
	swapped[0], swapped[1] = swapped[1], swapped[0]
	for name, list := range map[string][]QledgerEntry{"one entry short": short, "two entries swapped": swapped} {
		read := func(context.Context, QledgerEntryRange) ([]QledgerEntry, error) { return list, nil }
		valid, err := QledgerValidator(client, env.RollupID, QledgerValidatorOptions{ReadEntries: read})(ctx, b)
		if !errors.Is(err, ErrQledgerProofNotApplicable) || !strings.Contains(err.Error(), "does not apply") || valid {
			t.Errorf("%s: valid %v, %v", name, valid, err)
		}
		proof, err := QledgerFraudProofForBatch(ctx, client, env.RollupID, b, QledgerValidatorOptions{ReadEntries: read})
		if err == nil || proof != nil {
			t.Errorf("%s: a proof %x, %v", name, proof, err)
		}
	}
}

func TestQledgerValidatorPropagatesReaderErrors(t *testing.T) {
	_, env, _, honest, accs := qledgerWatchFixture(t)
	client, _ := newQledgerWatchNode(t, env, []watchBatch{honest}, accs)
	b := qledgerBatchAt(t, client, env.RollupID, 0)
	pruned := errors.New("pruned")
	read := func(context.Context, QledgerEntryRange) ([]QledgerEntry, error) { return nil, pruned }
	if valid, err := QledgerValidator(client, env.RollupID, QledgerValidatorOptions{ReadEntries: read})(context.Background(), b); !errors.Is(err, pruned) || valid {
		t.Errorf("a failing reader: valid %v, %v", valid, err)
	}
	// Without the inbox accumulator at the batch's start nothing is decided.
	client, _ = newQledgerWatchNode(t, env, []watchBatch{honest}, nil)
	read = func(context.Context, QledgerEntryRange) ([]QledgerEntry, error) {
		t.Error("entries were read without an accumulator")
		return nil, nil
	}
	if valid, err := QledgerValidator(client, env.RollupID, QledgerValidatorOptions{ReadEntries: read})(context.Background(), b); err == nil || !strings.Contains(err.Error(), "404") || valid {
		t.Errorf("no posted data: valid %v, %v", valid, err)
	}
}

// qledgerTwoBatches splits the fixture's entries into two batches settled in
// turn.
type qledgerTwoBatches struct {
	q       qledgerFixture
	env     QledgerEnv
	entries []QledgerEntry
	b0, b1  watchBatch
	mid     uint64
	accs    map[uint64]string
}

func newQledgerTwoBatches(t *testing.T) qledgerTwoBatches {
	t.Helper()
	q, env, entries, honest, _ := qledgerWatchFixture(t)
	const cut = 5
	first, second := entries[:cut], entries[cut:]
	start, end := q.Batch.InboxStart, q.Batch.InboxEnd
	mid := start + cut
	ledger := NewQledgerLedger()
	r1, err := ExecuteQledger(env, ledger, first)
	if err != nil {
		t.Fatal(err)
	}
	r2, err := ExecuteQledger(env, ledger, second)
	if err != nil {
		t.Fatal(err)
	}
	accFrom := mustHex(t, q.Batch.AccFrom)
	accMid := QledgerAccumulate(env.ChainID, env.RollupID, start, accFrom, first)
	accEnd := QledgerAccumulate(env.ChainID, env.RollupID, mid, accMid, second)
	dataHash := func(from, to uint64, accFrom, accTo []byte) string {
		return BytesToHex(InboxRangeHash(InboxRangeInput{ChainID: env.ChainID, RollupID: env.RollupID, From: from, To: to, AccFrom: accFrom, AccTo: accTo}))
	}
	b0 := honest
	b0.State, b0.Withdrawals = BytesToHex(r1.StateRoot), BytesToHex(r1.WithdrawalsRoot)
	b0.DataHash, b0.TxCount, b0.End = dataHash(start, mid, accFrom, accMid), len(first), mid
	b1 := honest
	b1.Index, b1.Prev = 1, BytesToHex(r1.StateRoot)
	b1.State, b1.Withdrawals = BytesToHex(r2.StateRoot), BytesToHex(r2.WithdrawalsRoot)
	b1.DataHash, b1.TxCount, b1.Start = dataHash(mid, end, accMid, accEnd), len(second), mid
	if b1.State != q.Batch.StateRoot {
		t.Fatal("two batches over the fixture's entries end elsewhere than one")
	}
	return qledgerTwoBatches{
		q: q, env: env, entries: entries, b0: b0, b1: b1, mid: mid,
		accs: map[uint64]string{start: q.Batch.AccFrom, mid: BytesToHex(accMid)},
	}
}

// recordingReader serves the fixture's entries and notes each range read.
func (s qledgerTwoBatches) recordingReader() (QledgerEntryReader, func() []string) {
	var mu sync.Mutex
	var ranges []string
	inner := qledgerReader(s.entries, s.q.Batch.InboxStart)
	read := func(ctx context.Context, r QledgerEntryRange) ([]QledgerEntry, error) {
		mu.Lock()
		ranges = append(ranges, fmt.Sprintf("%d-%d", r.From, r.To))
		mu.Unlock()
		return inner(ctx, r)
	}
	take := func() []string {
		mu.Lock()
		defer mu.Unlock()
		out := ranges
		ranges = nil
		return out
	}
	return read, take
}

func TestQledgerValidatorReplaysEarlierBatches(t *testing.T) {
	s := newQledgerTwoBatches(t)
	client, node := newQledgerWatchNode(t, s.env, []watchBatch{s.b0, s.b1}, s.accs)
	ctx := context.Background()
	b1 := qledgerBatchAt(t, client, s.env.RollupID, 1)
	read, ranges := s.recordingReader()
	validate := QledgerValidator(client, s.env.RollupID, QledgerValidatorOptions{ReadEntries: read})
	start, mid, end := s.q.Batch.InboxStart, s.mid, s.q.Batch.InboxEnd

	lists := node.requests("/qorechain/rdk/v1/batches/")
	if valid, err := validate(ctx, b1); err != nil || !valid {
		t.Fatalf("batch 1: valid %v, %v", valid, err)
	}
	if got, want := ranges(), []string{fmt.Sprintf("%d-%d", start, mid), fmt.Sprintf("%d-%d", mid, end)}; !reflect.DeepEqual(got, want) {
		t.Errorf("read %v, want %v", got, want)
	}
	if n := node.requests("/qorechain/rdk/v1/batches/") - lists; n != 1 {
		t.Errorf("%d batch listings for the replay", n)
	}
	// The state after batch 1 is now known, so judging it again reads only its
	// own entries and lists nothing.
	lists = node.requests("/qorechain/rdk/v1/batches/")
	if valid, err := validate(ctx, b1); err != nil || !valid {
		t.Fatalf("batch 1 again: valid %v, %v", valid, err)
	}
	if got, want := ranges(), []string{fmt.Sprintf("%d-%d", mid, end)}; !reflect.DeepEqual(got, want) {
		t.Errorf("read %v, want %v", got, want)
	}
	if n := node.requests("/qorechain/rdk/v1/batches/") - lists; n != 0 {
		t.Errorf("%d batch listings with the parent cached", n)
	}
	// Batch 0 builds on the empty ledger, which is always kept.
	b0 := qledgerBatchAt(t, client, s.env.RollupID, 0)
	if valid, err := validate(ctx, b0); err != nil || !valid {
		t.Fatalf("batch 0: valid %v, %v", valid, err)
	}
	if got, want := ranges(), []string{fmt.Sprintf("%d-%d", start, mid)}; !reflect.DeepEqual(got, want) {
		t.Errorf("read %v, want %v", got, want)
	}
}

func TestQledgerJudgeEvictsOldStates(t *testing.T) {
	s := newQledgerTwoBatches(t)
	client, _ := newQledgerWatchNode(t, s.env, []watchBatch{s.b0, s.b1}, s.accs)
	ctx := context.Background()
	b1 := qledgerBatchAt(t, client, s.env.RollupID, 1)
	read, ranges := s.recordingReader()
	// Room for the empty ledger and one more: the state after batch 1 evicts
	// its parent, so the parent is rebuilt by replay each time.
	judge := NewQledgerJudge(client, s.env.RollupID, QledgerValidatorOptions{ReadEntries: read, MaxCachedStates: 1})
	start, mid, end := s.q.Batch.InboxStart, s.mid, s.q.Batch.InboxEnd
	want := []string{fmt.Sprintf("%d-%d", start, mid), fmt.Sprintf("%d-%d", mid, end)}
	for i := 0; i < 2; i++ {
		if j, err := judge.Judge(ctx, b1); err != nil || !j.Valid {
			t.Fatalf("judgement %d: %+v, %v", i, j, err)
		}
		if got := ranges(); !reflect.DeepEqual(got, want) {
			t.Errorf("judgement %d read %v, want %v", i, got, want)
		}
	}
}

func TestQledgerValidatorRefusesAnUnreachedParent(t *testing.T) {
	s := newQledgerTwoBatches(t)
	bad0 := s.b0
	bad0.State = strings.Repeat("ef", 32)
	on0 := s.b1
	on0.Prev = bad0.State
	client, _ := newQledgerWatchNode(t, s.env, []watchBatch{bad0, on0}, s.accs)
	ctx := context.Background()
	validate := QledgerValidator(client, s.env.RollupID, QledgerValidatorOptions{ReadEntries: qledgerReader(s.entries, s.q.Batch.InboxStart)})

	// The batch that published the root is the one flagged...
	if valid, err := validate(ctx, qledgerBatchAt(t, client, s.env.RollupID, 0)); err != nil || valid {
		t.Errorf("batch 0: valid %v, %v", valid, err)
	}
	// ...and the batch built on it is left undecided.
	valid, err := validate(ctx, qledgerBatchAt(t, client, s.env.RollupID, 1))
	if !errors.Is(err, ErrQledgerNoHonestReplay) || !strings.Contains(err.Error(), bad0.State) || valid {
		t.Errorf("batch 1: valid %v, %v", valid, err)
	}
	if _, err := QledgerFraudProofForBatch(ctx, client, s.env.RollupID, qledgerBatchAt(t, client, s.env.RollupID, 1),
		QledgerValidatorOptions{ReadEntries: qledgerReader(s.entries, s.q.Batch.InboxStart)}); !errors.Is(err, ErrQledgerNoHonestReplay) {
		t.Errorf("a proof against batch 1: %v", err)
	}
}

func TestQledgerValidatorSkipsRejectedBatches(t *testing.T) {
	s := newQledgerTwoBatches(t)
	rejected := s.b0
	rejected.Status, rejected.State = string(BatchRejected), strings.Repeat("ef", 32)
	// Served out of order: the replay follows batch indexes.
	client, _ := newQledgerWatchNode(t, s.env, []watchBatch{s.b1, rejected, s.b0}, s.accs)
	read, ranges := s.recordingReader()
	valid, err := QledgerValidator(client, s.env.RollupID, QledgerValidatorOptions{ReadEntries: read})(context.Background(), qledgerBatchAt(t, client, s.env.RollupID, 1))
	if err != nil || !valid {
		t.Fatalf("batch 1 after a rejected batch: valid %v, %v", valid, err)
	}
	if got := ranges(); len(got) != 2 {
		t.Errorf("read %v: the rejected batch was replayed", got)
	}
}

func TestQledgerValidatorReadsEntriesFromTheNode(t *testing.T) {
	// The default reader fetches the entries from the node's transaction
	// index and checks them against the chain's inbox accumulator.
	q, env, entries := loadQledger(t)
	node := newQledgerFakeNode(t, env, entries)
	srv := node.server(t)
	client := NewRdkClient(RdkClientOptions{Network: "testnet", Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})
	head := uint64(len(entries))
	batch := MapBatchView(watchBatch{
		Status:      string(BatchSubmitted),
		Prev:        q.EmptyRoot,
		State:       q.Batch.StateRoot,
		Withdrawals: q.Batch.WithdrawalsRoot,
		DataHash:    BytesToHex(InboxRangeHash(InboxRangeInput{ChainID: env.ChainID, RollupID: env.RollupID, To: head, AccTo: node.accs[head-1]})),
		TxCount:     len(entries),
		End:         head,
	}.raw(t))
	ctx := context.Background()
	if valid, err := QledgerValidator(client, env.RollupID, QledgerValidatorOptions{})(ctx, batch); err != nil || !valid {
		t.Fatalf("the honest batch: valid %v, %v", valid, err)
	}
	wrong := batch
	wrong.StateRoot = strings.Repeat("ab", 32)
	proof, err := QledgerFraudProofForBatch(ctx, client, env.RollupID, wrong, QledgerValidatorOptions{})
	if err != nil || proof == nil {
		t.Fatalf("no proof against a wrong state root: %v", err)
	}
	// A tampered post no longer matches the chain's inbox accumulator: the
	// batch is undecided, not invalid.
	msg := node.posts[1].(map[string]any)["tx"].(map[string]any)["body"].(map[string]any)["messages"].([]any)[0].(map[string]any)
	tampered := append(clone(entries[2].Payload), 0)
	msg["data"] = base64.StdEncoding.EncodeToString(tampered)
	node.posts[1].(map[string]any)["events"].([]any)[0].(map[string]any)["attributes"].([]any)[2] =
		map[string]any{"key": "data_hash", "value": BytesToHex(PostedDataHash(tampered))}
	if valid, err := QledgerValidator(client, env.RollupID, QledgerValidatorOptions{})(ctx, wrong); err == nil || !strings.Contains(err.Error(), "inbox accumulator") || valid {
		t.Errorf("a tampered post: valid %v, %v", valid, err)
	}
}

func TestQledgerJudgeConcurrentCalls(t *testing.T) {
	s := newQledgerTwoBatches(t)
	client, _ := newQledgerWatchNode(t, s.env, []watchBatch{s.b0, s.b1}, s.accs)
	batches := []BatchView{qledgerBatchAt(t, client, s.env.RollupID, 0), qledgerBatchAt(t, client, s.env.RollupID, 1)}
	validate := QledgerValidator(client, s.env.RollupID, QledgerValidatorOptions{ReadEntries: qledgerReader(s.entries, s.q.Batch.InboxStart)})
	var wg sync.WaitGroup
	errs := make(chan error, 16)
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(b BatchView) {
			defer wg.Done()
			valid, err := validate(context.Background(), b)
			if err == nil && !valid {
				err = fmt.Errorf("batch %d judged invalid", b.BatchIndex)
			}
			if err != nil {
				errs <- err
			}
		}(batches[(i+1)%2])
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestQledgerJudgeWaitHonoursContext(t *testing.T) {
	q, env, entries, honest, accs := qledgerWatchFixture(t)
	client, _ := newQledgerWatchNode(t, env, []watchBatch{honest}, accs)
	b := qledgerBatchAt(t, client, env.RollupID, 0)
	entered, release := make(chan struct{}), make(chan struct{})
	inner := qledgerReader(entries, q.Batch.InboxStart)
	read := func(ctx context.Context, r QledgerEntryRange) ([]QledgerEntry, error) {
		close(entered)
		<-release
		return inner(ctx, r)
	}
	judge := NewQledgerJudge(client, env.RollupID, QledgerValidatorOptions{ReadEntries: read})
	done := make(chan error, 1)
	go func() {
		j, err := judge.Judge(context.Background(), b)
		if err == nil && !j.Valid {
			err = errors.New("the honest batch was judged invalid")
		}
		done <- err
	}()
	<-entered
	// A second call waits for the first; a cancelled context ends the wait.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := judge.Judge(ctx, b); !errors.Is(err, context.Canceled) {
		t.Errorf("a cancelled wait: %v", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Error(err)
	}
}
