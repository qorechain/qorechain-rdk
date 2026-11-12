package rdk

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// qledgerFixture mirrors the "qledger" key of testdata/v328.json: vectors from
// the chain's own qledger-v1 implementation.
type qledgerFixture struct {
	ChainID             string `json:"chainId"`
	RollupID            string `json:"rollupId"`
	EmptyRoot           string `json:"emptyRoot"`
	WithdrawalCounterID string `json:"withdrawalCounterId"`
	Recipient           string `json:"recipient"`
	Accounts            []struct {
		ID        string `json:"id"`
		PublicKey string `json:"publicKey"`
		Seed      string `json:"seed"`
	} `json:"accounts"`
	Txs map[string]struct {
		Unsigned       string `json:"unsigned"`
		SigningMessage string `json:"signingMessage"`
		Encoded        string `json:"encoded"`
	} `json:"txs"`
	Entries []struct {
		Height    uint64 `json:"height"`
		Poster    string `json:"poster"`
		Payload   string `json:"payload"`
		Note      string `json:"note"`
		RootAfter string `json:"rootAfter"`
	} `json:"entries"`
	Batch struct {
		AccFrom         string `json:"accFrom"`
		DataHash        string `json:"dataHash"`
		InboxStart      uint64 `json:"inboxStart"`
		InboxEnd        uint64 `json:"inboxEnd"`
		StateRoot       string `json:"stateRoot"`
		WithdrawalsRoot string `json:"withdrawalsRoot"`
		Withdrawals     []struct {
			Index     uint64 `json:"index"`
			Recipient string `json:"recipient"`
			Amount    uint64 `json:"amount"`
			Leaf      string `json:"leaf"`
		} `json:"withdrawals"`
		Proofs [][]string `json:"proofs"`
	} `json:"batch"`
	LaterWithdrawals struct {
		Root          string   `json:"root"`
		ProofOfIndex7 []string `json:"proofOfIndex7"`
	} `json:"laterWithdrawals"`
	WitnessesAfterBatch struct {
		Root      string `json:"root"`
		Witnesses []struct {
			ID       string   `json:"id"`
			Balance  uint64   `json:"balance"`
			Nonce    uint64   `json:"nonce"`
			Bitmap   string   `json:"bitmap"`
			Siblings []string `json:"siblings"`
		} `json:"witnesses"`
	} `json:"witnessesAfterBatch"`
	Fraud struct {
		DataHash              string `json:"dataHash"`
		EntriesFrom           int    `json:"entriesFrom"`
		HonestStateRoot       string `json:"honestStateRoot"`
		HonestWithdrawalsRoot string `json:"honestWithdrawalsRoot"`
		InboxStart            uint64 `json:"inboxStart"`
		InboxEnd              uint64 `json:"inboxEnd"`
		ParentRoot            string `json:"parentRoot"`
		Proof                 string `json:"proof"`
		WrongStateRoot        string `json:"wrongStateRoot"`
	} `json:"fraud"`
}

func loadQledger(t *testing.T) (qledgerFixture, QledgerEnv, []QledgerEntry) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "v328.json"))
	if err != nil {
		t.Fatalf("read v328 fixture: %v", err)
	}
	var f struct {
		Qledger qledgerFixture `json:"qledger"`
	}
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("parse v328 fixture: %v", err)
	}
	q := f.Qledger
	entries := make([]QledgerEntry, len(q.Entries))
	for i, e := range q.Entries {
		entries[i] = QledgerEntry{Height: e.Height, Poster: e.Poster, Payload: mustHex(t, e.Payload)}
	}
	return q, QledgerEnv{ChainID: q.ChainID, RollupID: q.RollupID}, entries
}

func id32(t *testing.T, s string) [32]byte {
	t.Helper()
	var id [32]byte
	b := mustHex(t, s)
	if len(b) != 32 {
		t.Fatalf("%s is not 32 bytes", s)
	}
	copy(id[:], b)
	return id
}

func hexList(bs [][]byte) []string {
	out := make([]string, len(bs))
	for i, b := range bs {
		out[i] = BytesToHex(b)
	}
	return out
}

func TestQledgerKeysAndRoots(t *testing.T) {
	q, _, _ := loadQledger(t)
	if got := BytesToHex(QledgerEmptyRoot()); got != q.EmptyRoot {
		t.Errorf("empty root %s want %s", got, q.EmptyRoot)
	}
	counter := QledgerWithdrawalCounterID()
	if got := BytesToHex(counter[:]); got != q.WithdrawalCounterID {
		t.Errorf("counter id %s want %s", got, q.WithdrawalCounterID)
	}
	for _, a := range q.Accounts {
		kp, err := QledgerKeypairFromSeed(mustHex(t, a.Seed))
		if err != nil {
			t.Fatal(err)
		}
		if BytesToHex(kp.PublicKey) != a.PublicKey || BytesToHex(kp.AccountID[:]) != a.ID {
			t.Errorf("account from seed %s differs", a.Seed)
		}
	}
	if _, err := QledgerKeypairFromSeed([]byte{1}); err == nil {
		t.Error("a short seed was accepted")
	}
}

func TestQledgerSignsByteForByte(t *testing.T) {
	q, env, _ := loadQledger(t)
	a, err := QledgerKeypairFromSeed(mustHex(t, q.Accounts[0].Seed))
	if err != nil {
		t.Fatal(err)
	}
	t1, err := SignQledgerTx(SignQledgerTxInput{
		ChainID: env.ChainID, RollupID: env.RollupID, SecretKey: a.SecretKey, PublicKey: a.PublicKey,
		Nonce: 0, To: mustHex(t, q.Accounts[1].ID), Amount: 1_000_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := BytesToHex(t1.Unsigned()); got != q.Txs["t1"].Unsigned {
		t.Error("t1 unsigned differs")
	}
	if got := BytesToHex(QledgerSigningMessage(env.ChainID, env.RollupID, t1.Unsigned())); got != q.Txs["t1"].SigningMessage {
		t.Errorf("t1 signing message %s", got)
	}
	if BytesToHex(t1.Encode()) != q.Txs["t1"].Encoded {
		t.Error("t1 encoding differs: deterministic ML-DSA-44 did not reproduce the chain's signature")
	}
	// From the seed alone (public key derived).
	t2, err := SignQledgerTx(SignQledgerTxInput{
		ChainID: env.ChainID, RollupID: env.RollupID, SecretKey: mustHex(t, q.Accounts[0].Seed),
		Nonce: 1, Recipient: q.Recipient, Amount: 700_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if BytesToHex(t2.Encode()) != q.Txs["t2"].Encoded {
		t.Error("t2 encoding differs")
	}
	parsed, ok := DecodeQledgerTx(mustHex(t, q.Txs["t2"].Encoded))
	if !ok || parsed.Recipient != q.Recipient || parsed.Kind != QledgerKindWithdraw || parsed.Amount != 700_000 {
		t.Fatalf("decode t2: %v %+v", ok, parsed.Recipient)
	}
	if !parsed.Verify(env.ChainID, env.RollupID) {
		t.Error("t2 does not verify")
	}
	if parsed.Verify(env.ChainID, "other-rollup") {
		t.Error("t2 verifies for another rollup")
	}
	if _, ok := DecodeQledgerTx(mustHex(t, q.Txs["t2"].Encoded)[:100]); ok {
		t.Error("a truncated transaction decoded")
	}
	if _, err := SignQledgerTx(SignQledgerTxInput{SecretKey: a.SecretKey, Recipient: q.Recipient, To: make([]byte, 32)}); err == nil {
		t.Error("a transaction with both To and Recipient was signed")
	}
	if _, err := SignQledgerTx(SignQledgerTxInput{SecretKey: a.SecretKey, PublicKey: make([]byte, 1312), Recipient: q.Recipient}); err == nil {
		t.Error("a mismatched public key was accepted")
	}
}

func TestQledgerExecutesEveryEntry(t *testing.T) {
	q, env, entries := loadQledger(t)
	led := NewQledgerLedger()
	for i, e := range q.Entries {
		if _, err := ExecuteQledger(env, led, entries[i:i+1]); err != nil {
			t.Fatal(err)
		}
		if got := BytesToHex(led.Root()); got != e.RootAfter {
			t.Errorf("after %q: root %s want %s", e.Note, got, e.RootAfter)
		}
	}
}

func TestQledgerBatchRootsAndWithdrawals(t *testing.T) {
	q, env, entries := loadQledger(t)
	res, err := ExecuteQledger(env, NewQledgerLedger(), entries)
	if err != nil {
		t.Fatal(err)
	}
	if BytesToHex(res.StateRoot) != q.Batch.StateRoot {
		t.Errorf("state root %x", res.StateRoot)
	}
	if BytesToHex(res.WithdrawalsRoot) != q.Batch.WithdrawalsRoot {
		t.Errorf("withdrawals root %x", res.WithdrawalsRoot)
	}
	if len(res.Withdrawals) != len(q.Batch.Withdrawals) {
		t.Fatalf("%d withdrawals, want %d", len(res.Withdrawals), len(q.Batch.Withdrawals))
	}
	for i, w := range q.Batch.Withdrawals {
		got := res.Withdrawals[i]
		if got.Index != w.Index || got.Recipient != w.Recipient || got.Amount != w.Amount {
			t.Errorf("withdrawal %d: %+v", i, got)
		}
		if leaf := BytesToHex(QledgerWithdrawalLeaf(env.ChainID, env.RollupID, w.Index, w.Recipient, w.Amount)); leaf != w.Leaf {
			t.Errorf("leaf %d: %s", i, leaf)
		}
		proof, err := QledgerWithdrawalProof(env.ChainID, env.RollupID, res.Withdrawals, i)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(hexList(proof), q.Batch.Proofs[i]) {
			t.Errorf("proof %d: %v", i, hexList(proof))
		}
	}
	if _, err := QledgerWithdrawalProof(env.ChainID, env.RollupID, res.Withdrawals, 2); err == nil {
		t.Error("a proof for a missing withdrawal")
	}

	var later []QledgerWithdrawal
	for k, index := range []uint64{5, 6, 7} {
		later = append(later, QledgerWithdrawal{Index: index, Recipient: q.Recipient, Amount: uint64(k + 1)})
	}
	if got := BytesToHex(QledgerWithdrawalsRoot(env.ChainID, env.RollupID, later)); got != q.LaterWithdrawals.Root {
		t.Errorf("later withdrawals root %s", got)
	}
	proof, err := QledgerWithdrawalProof(env.ChainID, env.RollupID, later, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(hexList(proof), q.LaterWithdrawals.ProofOfIndex7) {
		t.Errorf("proof of index 7: %v", hexList(proof))
	}
	if QledgerWithdrawalsRoot(env.ChainID, env.RollupID, nil) != nil {
		t.Error("a batch without withdrawals has a withdrawals root")
	}
}

func TestQledgerWitnessesAndPartialTree(t *testing.T) {
	q, env, entries := loadQledger(t)
	led := NewQledgerLedger()
	if _, err := ExecuteQledger(env, led, entries); err != nil {
		t.Fatal(err)
	}
	if BytesToHex(led.Root()) != q.WitnessesAfterBatch.Root {
		t.Fatalf("root %x", led.Root())
	}
	var ws []QledgerWitness
	for _, want := range q.WitnessesAfterBatch.Witnesses {
		got := led.Witness(id32(t, want.ID))
		sibs := make([]string, len(got.Siblings))
		for i, s := range got.Siblings {
			sibs[i] = BytesToHex(s[:])
		}
		wantSibs := want.Siblings
		if wantSibs == nil {
			wantSibs = []string{}
		}
		if got.Balance != want.Balance || got.Nonce != want.Nonce || BytesToHex(got.Bitmap[:]) != want.Bitmap ||
			!reflect.DeepEqual(sibs, wantSibs) {
			t.Errorf("witness %s: balance %d nonce %d bitmap %x siblings %v", want.ID, got.Balance, got.Nonce, got.Bitmap, sibs)
		}
		ws = append(ws, got)
	}
	tree, err := NewQledgerPartialTree(led.Root(), ws)
	if err != nil {
		t.Fatal(err)
	}
	id := id32(t, q.WitnessesAfterBatch.Witnesses[3].ID)
	if err := tree.Set(id, 1, 0); err != nil {
		t.Fatal(err)
	}
	_ = led.Set(id, 1, 0)
	if BytesToHex(tree.Root()) != BytesToHex(led.Root()) {
		t.Error("the partial tree's root update differs from the ledger's")
	}
	var nine [32]byte
	for i := range nine {
		nine[i] = 9
	}
	if _, _, err := tree.Get(nine); !errors.Is(err, ErrQledgerIncompleteWitness) {
		t.Errorf("an unopened account: %v", err)
	}
	bad := ws[0]
	bad.Balance++
	if _, err := NewQledgerPartialTree(led.Root(), []QledgerWitness{bad}); !errors.Is(err, ErrQledgerBadWitness) {
		t.Errorf("a wrong witness: %v", err)
	}
}

func TestQledgerFraudProof(t *testing.T) {
	q, env, entries := loadQledger(t)
	parent := NewQledgerLedger()
	if _, err := ExecuteQledger(env, parent, entries[:q.Fraud.EntriesFrom]); err != nil {
		t.Fatal(err)
	}
	if BytesToHex(parent.Root()) != q.Fraud.ParentRoot {
		t.Fatalf("parent root %x", parent.Root())
	}
	before := BytesToHex(parent.Root())
	proof, honest, err := BuildQledgerFraudProof(env, parent, mustHex(t, q.Batch.AccFrom), entries[q.Fraud.EntriesFrom:])
	if err != nil {
		t.Fatal(err)
	}
	if BytesToHex(parent.Root()) != before {
		t.Error("building a proof changed the parent ledger")
	}
	if BytesToHex(proof) != q.Fraud.Proof {
		t.Error("the fraud proof differs from the chain's")
	}
	if BytesToHex(honest.StateRoot) != q.Fraud.HonestStateRoot {
		t.Errorf("honest state root %x", honest.StateRoot)
	}
	decoded, err := DecodeQledgerFraudProof(proof)
	if err != nil {
		t.Fatal(err)
	}
	if BytesToHex(decoded.Encode()) != q.Fraud.Proof {
		t.Error("the fraud proof does not round-trip")
	}
	if _, err := DecodeQledgerFraudProof(append(proof, 0)); !errors.Is(err, ErrQledgerMalformedProof) {
		t.Errorf("trailing bytes: %v", err)
	}

	claim := QledgerClaim{
		InboxStart:      q.Fraud.InboxStart,
		InboxEnd:        q.Fraud.InboxEnd,
		DataHash:        mustHex(t, q.Fraud.DataHash),
		PrevStateRoot:   mustHex(t, q.Fraud.ParentRoot),
		StateRoot:       mustHex(t, q.Fraud.HonestStateRoot),
		WithdrawalsRoot: mustHex(t, q.Fraud.HonestWithdrawalsRoot),
	}
	if fraud, err := CheckQledgerFraud(env, claim, proof); err != nil || fraud {
		t.Errorf("an honest batch: fraud %v, %v", fraud, err)
	}
	wrong := claim
	wrong.StateRoot = mustHex(t, q.Fraud.WrongStateRoot)
	if fraud, err := CheckQledgerFraud(env, wrong, proof); err != nil || !fraud {
		t.Errorf("a wrong state root: fraud %v, %v", fraud, err)
	}
	wrong = claim
	wrong.InboxEnd++
	if _, err := CheckQledgerFraud(env, wrong, proof); !errors.Is(err, ErrQledgerProofNotApplicable) || !strings.Contains(err.Error(), "does not apply") {
		t.Errorf("a wrong inbox range: %v", err)
	}
	wrong = claim
	wrong.DataHash = make([]byte, 32)
	if _, err := CheckQledgerFraud(env, wrong, proof); !errors.Is(err, ErrQledgerProofNotApplicable) {
		t.Errorf("a wrong data hash: %v", err)
	}
}

func TestQledgerRecipientsAndDeposits(t *testing.T) {
	q, _, entries := loadQledger(t)
	if !IsCanonicalQorAddress(q.Recipient) {
		t.Error("the recipient is canonical")
	}
	if IsCanonicalQorAddress(strings.ToUpper(q.Recipient)) {
		t.Error("an uppercase address is not canonical")
	}
	if IsCanonicalQorAddress("cosmos1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnuddlrw") {
		t.Error("another prefix is not a qor address")
	}
	dep := entries[0]
	if !strings.HasPrefix(dep.Poster, QledgerDepositPosterPrefix) {
		t.Fatal("entry 0 is a deposit")
	}
	if got := EncodeQledgerDeposit(id32(t, q.Accounts[0].ID), 5_000_000); BytesToHex(got) != BytesToHex(dep.Payload) {
		t.Error("deposit payload differs")
	}
	if id, amount, ok := DecodeQledgerDeposit(dep.Payload); !ok || amount != 5_000_000 || BytesToHex(id[:]) != q.Accounts[0].ID {
		t.Error("deposit does not decode")
	}
}

func TestQledgerAdmissionRules(t *testing.T) {
	if got := []bool{IsQledgerCheckpoint(0), IsQledgerCheckpoint(1), IsQledgerCheckpoint(63), IsQledgerCheckpoint(64), IsQledgerCheckpoint(128)}; !reflect.DeepEqual(got, []bool{false, false, false, true, true}) {
		t.Errorf("checkpoints %v", got)
	}
	tr, fa := true, false
	u := func(v uint64) *uint64 { return &v }
	base := func(consumed, head, end uint64) QledgerBatchFacts {
		return QledgerBatchFacts{Bond: 2_000_000_000, MinBond: 1_000_000_000, EndRetained: true, Consumed: consumed, Head: head, End: end}
	}
	expect := func(name string, f QledgerBatchFacts, want string) {
		t.Helper()
		errs := QledgerBatchErrors(f)
		if want == "" {
			if len(errs) != 0 {
				t.Errorf("%s: %v", name, errs)
			}
			return
		}
		if !strings.Contains(strings.Join(errs, ","), want) {
			t.Errorf("%s: want %q in %v", name, want, errs)
		}
	}
	expect("head", base(0, 10, 10), "")
	f := base(0, 10, 10)
	f.Bond = 1
	expect("bond", f, "bond")
	f = base(0, 10, 10)
	f.Pending = 1024
	expect("pending", f, "waiting")
	expect("empty", base(5, 10, 5), "at least one")
	expect("past head", base(0, 10, 11), "past the head")
	expect("too many", base(0, 100, 65), "at most 64")
	expect("full", base(0, 100, 64), "")

	short := func() QledgerBatchFacts { return base(0, 100, 10) }
	f = short()
	f.NextRetained, f.NextHeight, f.InclusionHeight = &tr, u(990), u(1000)
	expect("fresh stop", f, "")
	f = short()
	f.NextRetained, f.NextHeight, f.InclusionHeight = &tr, u(980), u(1000)
	expect("old next post", f, "post 11 must be in it")
	f = short()
	f.NextRetained = &fa
	expect("next gone, not a checkpoint", f, "post 11")
	f = base(40, 300, 64)
	f.NextRetained = &fa
	expect("checkpoint stop", f, "")
	f = base(0, 300, 20)
	f.EndRetained, f.NextRetained = false, &fa
	expect("end not retained", f, "no longer retained")
}

func TestQledgerChooseEnd(t *testing.T) {
	all := func(uint64) (bool, error) { return true, nil }
	onlyCheckpoints := func(x uint64) (bool, error) { return x%64 == 0, nil }
	cases := []struct {
		consumed, head uint64
		retained       func(uint64) (bool, error)
		end            uint64
		ok             bool
	}{
		{5, 5, all, 0, false},
		{0, 10, all, 10, true},
		{0, 200, all, 64, true},
		// After a long idle period only checkpoints kept their commitments.
		{40, 500, onlyCheckpoints, 64, true},
		{64, 500, onlyCheckpoints, 128, true},
	}
	for _, c := range cases {
		end, ok, err := ChooseQledgerBatchEnd(c.consumed, c.head, c.retained)
		if err != nil || end != c.end || ok != c.ok {
			t.Errorf("consumed %d head %d: %d %v %v", c.consumed, c.head, end, ok, err)
		}
	}
}

func TestZkWithdrawalsRootModR(t *testing.T) {
	r := BLS12381ScalarModulus()
	high := new(big.Int).Add(r, big.NewInt(5)).FillBytes(make([]byte, 32))
	low := big.NewInt(5).FillBytes(make([]byte, 32))
	if e := ZkPublicInputErrors(ZkBatchInputs{StateRoot: low, WithdrawalsRoot: high}); len(e) != 0 {
		t.Errorf("a high withdrawals root was refused: %v", e)
	}
	if e := ZkPublicInputErrors(ZkBatchInputs{StateRoot: high}); len(e) != 1 || !strings.Contains(e[0], "state_root") {
		t.Errorf("a high state root: %v", e)
	}
	ins := ZkPublicInputs(ZkBatchInputs{PrevStateRoot: low, StateRoot: low, WithdrawalsRoot: high})
	want := []string{BytesToHex(low), BytesToHex(low), strings.Repeat("00", 32), BytesToHex(ToCanonicalScalar(high))}
	if !reflect.DeepEqual(hexList(ins), want) || BytesToHex(ins[3]) != BytesToHex(low) {
		t.Errorf("public inputs %v", hexList(ins))
	}
	if !WithdrawalsRootMatches(low, high, true) || WithdrawalsRootMatches(low, high, false) || !WithdrawalsRootMatches(high, high, false) {
		t.Error("withdrawals root comparison")
	}
	v := MapBatchView(map[string]any{"withdrawals_root_reduced": true})
	if !v.WithdrawalsRootReduced || MapBatchView(map[string]any{}).WithdrawalsRootReduced {
		t.Error("batch view withdrawals_root_reduced")
	}
	if b := MapSubmitterBondView(map[string]any{"amount": "7", "pending": "3"}); b.Pending != 3 || b.Amount != "7" {
		t.Errorf("submitter bond view %+v", b)
	}
	if DefaultPostedDataRetentionBlocks != 648_000 || MinPostedDataRetentionBlocks != 100 || MaxPostedDataRetentionBlocks != 25_920_000 {
		t.Error("posted-data retention constants")
	}
}

// qledgerFakeNode is a fake node serving a qledger-v1 rollup whose inbox holds
// the fixture's entries, as transactions found by event search.
type qledgerFakeNode struct {
	routes   map[string]any
	posts    []any
	deposits []any
	head     uint64
	accs     [][]byte
}

func newQledgerFakeNode(t *testing.T, env QledgerEnv, entries []QledgerEntry) *qledgerFakeNode {
	t.Helper()
	n := &qledgerFakeNode{routes: map[string]any{}, head: uint64(len(entries))}
	var acc []byte
	for i, e := range entries {
		acc = QledgerAccumulate(env.ChainID, env.RollupID, uint64(i), acc, []QledgerEntry{e})
		n.accs = append(n.accs, acc)
		seq := strconv.Itoa(i + 1)
		attr := func(k, v string) any { return map[string]any{"key": k, "value": v} }
		if strings.HasPrefix(e.Poster, QledgerDepositPosterPrefix) {
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
		n.posts = append(n.posts, map[string]any{
			"height": strconv.FormatUint(e.Height, 10), "txhash": "P" + seq,
			"tx": map[string]any{"body": map[string]any{"messages": []any{map[string]any{
				"@type": TypeURLMsgPostRollupData, "poster": e.Poster, "rollup_id": env.RollupID,
				"data": base64.StdEncoding.EncodeToString(e.Payload),
			}}}},
			"events": []any{map[string]any{"type": "rdk_data_posted", "attributes": []any{
				attr("rollup_id", env.RollupID), attr("sequence", seq),
				attr("data_hash", BytesToHex(PostedDataHash(e.Payload))), attr("poster", e.Poster),
				attr("inbox_acc", BytesToHex(acc)),
			}}},
		})
	}
	rangeHash := BytesToHex(InboxRangeHash(InboxRangeInput{ChainID: env.ChainID, RollupID: env.RollupID, From: 0, To: n.head, AccTo: acc}))
	inbox := map[string]any{"inbox": map[string]any{
		"head_sequence": strconv.FormatUint(n.head, 10), "consumed_sequence": "0", "consumed_acc": strings.Repeat("00", 32),
		"range_end": strconv.FormatUint(n.head, 10), "range_data_hash": rangeHash,
	}}
	n.routes["/qorechain/rdk/v1/rollup/"+env.RollupID] = map[string]any{"rollup": map[string]any{
		"rollup_id": env.RollupID, "execution_vm": "qledger-v1", "sequencing": "based", "settlement_mode": "optimistic",
	}}
	n.routes["/qorechain/rdk/v1/params"] = map[string]any{"params": map[string]any{"min_submitter_bond": "1000000000"}}
	n.routes["/qorechain/rdk/v1/submitter_bond/"+env.RollupID+"/qor1sub"] = map[string]any{"amount": "1000000000", "pending": "0"}
	n.routes["/qorechain/rdk/v1/inbox/"+env.RollupID] = inbox
	n.routes["/qorechain/rdk/v1/inbox/"+env.RollupID+"?inbox_end="+strconv.FormatUint(n.head, 10)] = inbox
	n.routes["/cosmos/base/node/v1beta1/status"] = map[string]any{"height": "1000"}
	return n
}

func (n *qledgerFakeNode) server(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cosmos/tx/v1beta1/txs" {
			txs := n.deposits
			if strings.HasPrefix(r.URL.Query().Get("query"), "rdk_data_posted") {
				txs = n.posts
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"tx_responses": txs, "total": strconv.Itoa(len(txs))})
			return
		}
		body, ok := n.routes[r.URL.RequestURI()]
		if !ok {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestPlanQledgerBatch(t *testing.T) {
	q, env, entries := loadQledger(t)
	node := newQledgerFakeNode(t, env, entries)
	srv := node.server(t)
	rest := NewRestClient(srv.URL, srv.Client())
	ctx := context.Background()
	in := PlanQledgerBatchInput{ChainID: env.ChainID, RollupID: env.RollupID, Submitter: "qor1sub", Ledger: NewQledgerLedger()}

	if h, err := rest.GetLatestHeight(ctx); err != nil || h != 1000 {
		t.Errorf("latest height %d %v", h, err)
	}
	plan, err := PlanQledgerBatch(ctx, rest, in)
	if err != nil {
		t.Fatal(err)
	}
	wantRange := BytesToHex(InboxRangeHash(InboxRangeInput{ChainID: env.ChainID, RollupID: env.RollupID, To: node.head, AccTo: node.accs[node.head-1]}))
	m := plan.Msg
	if m.InboxEnd != node.head || m.BatchIndex != 0 || m.Sequencer != "qor1sub" || m.TxCount != node.head {
		t.Errorf("plan %+v", m)
	}
	if BytesToHex(m.PrevStateRoot) != q.EmptyRoot || BytesToHex(m.StateRoot) != q.Batch.StateRoot ||
		BytesToHex(m.WithdrawalsRoot) != q.Batch.WithdrawalsRoot || BytesToHex(m.DataHash) != wantRange {
		t.Error("the plan's roots differ from the chain's")
	}
	if len(plan.Result.Withdrawals) != 2 || BytesToHex(plan.Ledger.Root()) != q.Batch.StateRoot || BytesToHex(in.Ledger.Root()) != q.EmptyRoot {
		t.Error("the plan's ledger or withdrawals")
	}

	// A tampered post no longer matches the chain's inbox accumulator.
	post := node.posts[1].(map[string]any)
	msg := post["tx"].(map[string]any)["body"].(map[string]any)["messages"].([]any)[0].(map[string]any)
	original := msg["data"]
	if _, err := FetchQledgerEntries(ctx, rest, FetchQledgerEntriesInput{ChainID: env.ChainID, RollupID: env.RollupID, To: node.head}); err != nil {
		t.Errorf("fetch: %v", err)
	}
	tampered := QledgerEntry{Height: entries[2].Height, Poster: entries[2].Poster, Payload: append(clone(entries[2].Payload), 0)}
	msg["data"] = base64.StdEncoding.EncodeToString(tampered.Payload)
	post["events"].([]any)[0].(map[string]any)["attributes"].([]any)[2] = map[string]any{"key": "data_hash", "value": BytesToHex(PostedDataHash(tampered.Payload))}
	if _, err := PlanQledgerBatch(ctx, rest, in); err == nil || !strings.Contains(err.Error(), "inbox accumulator") {
		t.Errorf("a tampered post: %v", err)
	}
	msg["data"] = original
	post["events"].([]any)[0].(map[string]any)["attributes"].([]any)[2] = map[string]any{"key": "data_hash", "value": BytesToHex(PostedDataHash(entries[2].Payload))}

	// The last entry is a deposit, covered only by the range commitment.
	last := node.deposits[len(node.deposits)-1].(map[string]any)["events"].([]any)[0].(map[string]any)["attributes"].([]any)
	amount := last[3]
	last[3] = map[string]any{"key": "amount", "value": "1uqor"}
	if _, err := PlanQledgerBatch(ctx, rest, in); err == nil || !strings.Contains(err.Error(), "range commitment") {
		t.Errorf("a tampered deposit: %v", err)
	}
	last[3] = amount

	node.routes["/qorechain/rdk/v1/submitter_bond/"+env.RollupID+"/qor1sub"] = map[string]any{"amount": "5", "pending": "0"}
	if _, err := PlanQledgerBatch(ctx, rest, in); err == nil || !strings.Contains(err.Error(), "bond") {
		t.Errorf("without a bond: %v", err)
	}

	// The same rules in the client's submit-batch checks.
	acc, err := DeriveNativeAccount("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", 0)
	if err != nil {
		t.Fatal(err)
	}
	tx := NewRdkTxClient(acc, env.ChainID, rest)
	m.Sequencer = "qor1sub"
	if err := tx.CheckSubmitBatch(ctx, m); err == nil || !strings.Contains(err.Error(), "bond") {
		t.Errorf("check without a bond: %v", err)
	}
	node.routes["/qorechain/rdk/v1/submitter_bond/"+env.RollupID+"/qor1sub"] = map[string]any{"amount": "1000000000", "pending": "0"}
	if err := tx.CheckSubmitBatch(ctx, m); err != nil {
		t.Errorf("check of the planned batch: %v", err)
	}
	m.InboxEnd = node.head + 1
	if err := tx.CheckSubmitBatch(ctx, m); err == nil || !strings.Contains(err.Error(), "past the head") {
		t.Errorf("check past the head: %v", err)
	}
}
