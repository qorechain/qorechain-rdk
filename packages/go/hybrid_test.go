package rdk

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"

	pqc "github.com/qorechain/qorechain-pqc/go"
	"github.com/qorechain/qorechain-sdk/packages/go/qorechain/authenticator"
)

// goldenHybridTx mirrors the hybridTx section of testdata/golden.json: txRaw
// bytes the TypeScript SDK built for a fixed input.
type goldenHybridTx struct {
	ChainID       string `json:"chainId"`
	AccountNumber uint64 `json:"accountNumber"`
	Sequence      uint64 `json:"sequence"`
	Fee           struct {
		Amount []struct {
			Denom  string `json:"denom"`
			Amount string `json:"amount"`
		} `json:"amount"`
		Gas string `json:"gas"`
	} `json:"fee"`
	Memo    string `json:"memo"`
	Message struct {
		TypeURL  string `json:"typeUrl"`
		Creator  string `json:"creator"`
		RollupID string `json:"rollupId"`
		Reason   string `json:"reason"`
	} `json:"message"`
	V1        goldenHybridCase `json:"v1"`
	V1WithKey goldenHybridCase `json:"v1WithKey"`
	V2        goldenHybridCase `json:"v2"`
	V2WithKey goldenHybridCase `json:"v2WithKey"`
}

type goldenHybridCase struct {
	TxRawHex            string `json:"txRawHex"`
	PqcSignedMessageHex string `json:"pqcSignedMessageHex"`
}

func loadGoldenHybrid(t *testing.T) (golden, goldenHybridTx) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "golden.json"))
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	var wrap struct {
		HybridTx goldenHybridTx `json:"hybridTx"`
	}
	if err := json.Unmarshal(data, &wrap); err != nil {
		t.Fatalf("parse golden: %v", err)
	}
	return loadGolden(t), wrap.HybridTx
}

// goldenHybridInput is the fixed input of the hybridTx vectors.
func goldenHybridInput(t *testing.T) (Account, PqcKeypair, []Msg, TxParams, goldenHybridTx) {
	t.Helper()
	g, h := loadGoldenHybrid(t)
	acc, err := DeriveNativeAccount(g.Mnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	if acc.Address != g.NativeAddress {
		t.Fatalf("address: got %s want %s", acc.Address, g.NativeAddress)
	}
	kp, err := authenticator.DerivePQCCanonical(acc.Address, g.Mnemonic)
	if err != nil {
		t.Fatal(err)
	}
	msg := PauseRollupMsg(PauseRollupInput{Creator: h.Message.Creator, RollupID: h.Message.RollupID, Reason: h.Message.Reason})
	if msg.TypeURL() != h.Message.TypeURL {
		t.Fatalf("type url: got %s want %s", msg.TypeURL(), h.Message.TypeURL)
	}
	gas, err := strconv.ParseUint(h.Fee.Gas, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	fee := Fee{GasLimit: gas}
	for _, c := range h.Fee.Amount {
		fee.Amount = append(fee.Amount, Coin{Denom: c.Denom, Amount: c.Amount})
	}
	return acc, kp, []Msg{msg}, TxParams{Sequence: h.Sequence, AccountNumber: h.AccountNumber, Fee: fee, Memo: h.Memo}, h
}

// readVarint reads a protobuf varint at b[i:].
func readVarint(t *testing.T, b []byte, i int) (uint64, int) {
	t.Helper()
	var v uint64
	for shift := 0; i < len(b); shift += 7 {
		c := b[i]
		i++
		v |= uint64(c&0x7f) << shift
		if c < 0x80 {
			return v, i
		}
	}
	t.Fatal("truncated varint")
	return 0, i
}

// lengthDelimited returns the length-delimited fields of a message, keyed by
// field number, in order.
func lengthDelimited(t *testing.T, b []byte) map[uint64][][]byte {
	t.Helper()
	out := map[uint64][][]byte{}
	for i := 0; i < len(b); {
		key, j := readVarint(t, b, i)
		if key&7 != 2 {
			t.Fatalf("unexpected wire type %d", key&7)
		}
		n, k := readVarint(t, b, j)
		out[key>>3] = append(out[key>>3], b[k:k+int(n)])
		i = k + int(n)
	}
	return out
}

// diffTxRaw says which part of two TxRaw encodings differs.
func diffTxRaw(t *testing.T, got, want []byte) string {
	t.Helper()
	g, w := lengthDelimited(t, got), lengthDelimited(t, want)
	parts := []string{}
	if !bytes.Equal(g[2][0], w[2][0]) {
		parts = append(parts, "authInfo")
	}
	if !bytes.Equal(g[3][0], w[3][0]) {
		parts = append(parts, "classical signature")
	}
	gb, wb := lengthDelimited(t, g[1][0]), lengthDelimited(t, w[1][0])
	if !bytes.Equal(gb[1][0], wb[1][0]) || !bytes.Equal(gb[2][0], wb[2][0]) {
		parts = append(parts, "body messages/memo")
	}
	ge, we := lengthDelimited(t, gb[1023][0]), lengthDelimited(t, wb[1023][0])
	gv, wv := lengthDelimited(t, ge[2][0]), lengthDelimited(t, we[2][0])
	if !bytes.Equal(gv[2][0], wv[2][0]) {
		parts = append(parts, "extension PQC signature")
	}
	if len(gv[3]) != len(wv[3]) || (len(gv[3]) > 0 && !bytes.Equal(gv[3][0], wv[3][0])) {
		parts = append(parts, "extension public key")
	}
	return strings.Join(parts, ", ")
}

func TestHybridTxGoldenVectors(t *testing.T) {
	acc, kp, msgs, params, h := goldenHybridInput(t)
	cases := []struct {
		name    string
		version SignBytesVersion
		withKey bool
		want    goldenHybridCase
	}{
		{"v1", SignBytesV1, false, h.V1},
		{"v1WithKey", SignBytesV1, true, h.V1WithKey},
		{"v2", SignBytesV2, false, h.V2},
		{"v2WithKey", SignBytesV2, true, h.V2WithKey},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client := NewRdkTxClient(acc, h.ChainID, nil).WithHybrid(HybridOptions{
				PqcKeypair:          kp,
				IncludePqcPublicKey: tc.withKey,
				SignBytesVersion:    tc.version,
			})
			built, err := client.BuildTx(context.Background(), msgs, params)
			if err != nil {
				t.Fatal(err)
			}
			if built.SignBytesVersion != tc.version {
				t.Errorf("sign-bytes version: got %s want %s", built.SignBytesVersion, tc.version)
			}
			if got := BytesToHex(built.PqcSignedMessage); got != tc.want.PqcSignedMessageHex {
				t.Errorf("PQC signed message differs:\n got %s\nwant %s", got, tc.want.PqcSignedMessageHex)
			}
			if got := BytesToHex(built.TxRaw); got != tc.want.TxRawHex {
				want, _ := HexToBytes(tc.want.TxRawHex)
				t.Fatalf("txRaw differs (%s)", diffTxRaw(t, built.TxRaw, want))
			}
			if !pqc.MLDSA87.Verify(kp.PublicKey, built.PqcSignedMessage, built.PqcSignature) {
				t.Error("PQC signature does not verify")
			}
			// Sign returns the same bytes.
			raw, err := client.Sign(msgs, params)
			if err != nil {
				t.Fatal(err)
			}
			if BytesToHex(raw) != tc.want.TxRawHex {
				t.Error("Sign differs from BuildTx")
			}
		})
	}
}

func TestClassicalTxUnchangedWithoutPqcKeypair(t *testing.T) {
	acc, _, msgs, params, h := goldenHybridInput(t)
	client := NewRdkTxClient(acc, h.ChainID, nil)
	if client.IsHybrid() {
		t.Fatal("a client without a PQC keypair must not be hybrid")
	}
	want := SignTx(acc, msgs, params.Memo, params.Fee, params.Sequence, h.ChainID, params.AccountNumber)
	built, err := client.BuildTx(context.Background(), msgs, params)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(built.TxRaw, want) {
		t.Error("classical BuildTx differs from SignTx")
	}
	if built.PqcSignedMessage != nil || built.PqcSignature != nil || built.SignBytesVersion != "" {
		t.Error("classical build must carry no PQC artifacts")
	}
	raw, err := client.Sign(msgs, params)
	if err != nil || !bytes.Equal(raw, want) {
		t.Errorf("classical Sign differs from SignTx (err %v)", err)
	}
	// No extension option (TxBody field 1023) in a classical body.
	body := lengthDelimited(t, lengthDelimited(t, built.TxRaw)[1][0])
	if len(body[1023]) != 0 {
		t.Error("classical body must not carry the PQC extension")
	}
}

// --- mock REST transport ---

type mockRest struct {
	mu        sync.Mutex
	pqcKey    []byte // nil: no record (404)
	planV2    bool   // whether the v2 sign-bytes upgrade is applied
	broadcast [][]byte
	responses []string // broadcast responses, in order (default: code 0)
	paths     []string
}

func (m *mockRest) Do(req *http.Request) (*http.Response, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	path := req.URL.Path
	m.paths = append(m.paths, path)
	reply := func(code int, body string) (*http.Response, error) {
		return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}, Request: req}, nil
	}
	switch {
	case strings.HasPrefix(path, "/qorechain/pqc/v1/account/"):
		if m.pqcKey == nil {
			return reply(404, `{"code":5,"message":"not found"}`)
		}
		return reply(200, `{"account":{"address":"x","public_key":"`+base64.StdEncoding.EncodeToString(m.pqcKey)+`","algorithm_id":1}}`)
	case strings.HasPrefix(path, "/cosmos/upgrade/v1beta1/applied_plan/"):
		if m.planV2 {
			return reply(200, `{"height":"100"}`)
		}
		return reply(200, `{"height":"0"}`)
	case path == "/cosmos/tx/v1beta1/txs":
		var payload struct {
			TxBytes string `json:"tx_bytes"`
		}
		body, _ := io.ReadAll(req.Body)
		_ = json.Unmarshal(body, &payload)
		raw, _ := base64.StdEncoding.DecodeString(payload.TxBytes)
		m.broadcast = append(m.broadcast, raw)
		if len(m.responses) > 0 {
			r := m.responses[0]
			m.responses = m.responses[1:]
			return reply(200, r)
		}
		return reply(200, `{"tx_response":{"code":0,"txhash":"ABC"}}`)
	}
	return reply(404, `{}`)
}

func mockRdkClient(m *mockRest) *RdkClient {
	return NewRdkClient(RdkClientOptions{Network: "testnet", Endpoints: &Endpoints{Rest: "http://rest.test"}, HTTP: m})
}

func TestResolvePqcKeypair(t *testing.T) {
	g := loadGolden(t)
	ctx := context.Background()
	canonical, err := authenticator.DerivePQCCanonical(g.NativeAddress, g.Mnemonic)
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := authenticator.DerivePQCLegacy(g.Mnemonic)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("not registered", func(t *testing.T) {
		r, err := ResolvePqcKeypair(ctx, mockRdkClient(&mockRest{}), g.NativeAddress, g.Mnemonic)
		if err != nil {
			t.Fatal(err)
		}
		if r.Derivation != PqcDerivationCanonical || r.Registered || !r.IncludePqcPublicKey ||
			!bytes.Equal(r.Keypair.PublicKey, canonical.PublicKey) {
			t.Errorf("unexpected resolution: %s registered=%v include=%v", r.Derivation, r.Registered, r.IncludePqcPublicKey)
		}
		if opts := r.HybridOptions(); !opts.IncludePqcPublicKey {
			t.Error("HybridOptions must embed the key for an unregistered account")
		}
	})
	t.Run("registered canonical", func(t *testing.T) {
		r, err := ResolvePqcKeypair(ctx, mockRdkClient(&mockRest{pqcKey: canonical.PublicKey}), g.NativeAddress, g.Mnemonic)
		if err != nil {
			t.Fatal(err)
		}
		if r.Derivation != PqcDerivationCanonical || !r.Registered || r.IncludePqcPublicKey ||
			!bytes.Equal(r.Keypair.SecretKey, canonical.SecretKey) {
			t.Errorf("unexpected resolution: %s registered=%v include=%v", r.Derivation, r.Registered, r.IncludePqcPublicKey)
		}
	})
	t.Run("registered legacy", func(t *testing.T) {
		r, err := ResolvePqcKeypair(ctx, mockRdkClient(&mockRest{pqcKey: legacy.PublicKey}), g.NativeAddress, g.Mnemonic)
		if err != nil {
			t.Fatal(err)
		}
		if r.Derivation != PqcDerivationLegacy || !r.Registered || r.IncludePqcPublicKey ||
			!bytes.Equal(r.Keypair.SecretKey, legacy.SecretKey) {
			t.Errorf("unexpected resolution: %s registered=%v include=%v", r.Derivation, r.Registered, r.IncludePqcPublicKey)
		}
	})
	t.Run("foreign key", func(t *testing.T) {
		foreign, _, err := pqc.MLDSA87.Keygen()
		if err != nil {
			t.Fatal(err)
		}
		_, err = ResolvePqcKeypair(ctx, mockRdkClient(&mockRest{pqcKey: foreign}), g.NativeAddress, g.Mnemonic)
		if err == nil || !strings.Contains(err.Error(), "neither the canonical nor the legacy derivation") {
			t.Errorf("expected the foreign-key error, got %v", err)
		}
	})
}

func TestPqcKeypairFromEnv(t *testing.T) {
	g := loadGolden(t)
	ctx := context.Background()
	seed := bytes.Repeat([]byte{0x42}, 32)
	seedPub, _, err := pqc.MLDSA87.KeygenFromSeed(seed)
	if err != nil {
		t.Fatal(err)
	}
	seedHex := BytesToHex(seed)

	t.Run("none configured", func(t *testing.T) {
		_, ok, err := PqcKeypairFromEnv(ctx, mockRdkClient(&mockRest{}), g.NativeAddress, map[string]string{})
		if ok || err != nil {
			t.Errorf("expected nothing configured, ok=%v err=%v", ok, err)
		}
	})
	t.Run("mnemonic", func(t *testing.T) {
		r, ok, err := PqcKeypairFromEnv(ctx, mockRdkClient(&mockRest{}), g.NativeAddress, map[string]string{"QORE_MNEMONIC": " " + g.Mnemonic + " "})
		if !ok || err != nil {
			t.Fatalf("ok=%v err=%v", ok, err)
		}
		if r.Derivation != PqcDerivationCanonical || !r.IncludePqcPublicKey {
			t.Errorf("unexpected resolution: %s include=%v", r.Derivation, r.IncludePqcPublicKey)
		}
	})
	t.Run("seed not registered", func(t *testing.T) {
		r, ok, err := PqcKeypairFromEnv(ctx, mockRdkClient(&mockRest{}), g.NativeAddress, map[string]string{"QORE_PQC_SEED_HEX": seedHex, "QORE_MNEMONIC": g.Mnemonic})
		if !ok || err != nil {
			t.Fatalf("ok=%v err=%v", ok, err)
		}
		if r.Derivation != PqcDerivationSeed || r.Registered || !r.IncludePqcPublicKey || !bytes.Equal(r.Keypair.PublicKey, seedPub) {
			t.Errorf("unexpected resolution: %s registered=%v include=%v", r.Derivation, r.Registered, r.IncludePqcPublicKey)
		}
	})
	t.Run("seed registered", func(t *testing.T) {
		r, ok, err := PqcKeypairFromEnv(ctx, mockRdkClient(&mockRest{pqcKey: seedPub}), g.NativeAddress, map[string]string{"QORE_PQC_SEED_HEX": seedHex})
		if !ok || err != nil {
			t.Fatalf("ok=%v err=%v", ok, err)
		}
		if r.Derivation != PqcDerivationSeed || !r.Registered || r.IncludePqcPublicKey {
			t.Errorf("unexpected resolution: %s registered=%v include=%v", r.Derivation, r.Registered, r.IncludePqcPublicKey)
		}
	})
	t.Run("seed mismatch", func(t *testing.T) {
		canonical, err := authenticator.DerivePQCCanonical(g.NativeAddress, g.Mnemonic)
		if err != nil {
			t.Fatal(err)
		}
		_, ok, err := PqcKeypairFromEnv(ctx, mockRdkClient(&mockRest{pqcKey: canonical.PublicKey}), g.NativeAddress, map[string]string{"QORE_PQC_SEED_HEX": seedHex})
		if !ok || err == nil || !strings.Contains(err.Error(), "does not produce the post-quantum key registered") {
			t.Errorf("expected the seed-mismatch error, ok=%v err=%v", ok, err)
		}
	})
	t.Run("seed wrong length", func(t *testing.T) {
		_, ok, err := PqcKeypairFromEnv(ctx, mockRdkClient(&mockRest{}), g.NativeAddress, map[string]string{"QORE_PQC_SEED_HEX": "abcd"})
		if !ok || err == nil || !strings.Contains(err.Error(), "must be 32 bytes, got 2") {
			t.Errorf("expected the length error, ok=%v err=%v", ok, err)
		}
	})
}

func TestHybridAutoSignBytesResolvesThroughRest(t *testing.T) {
	acc, kp, msgs, params, h := goldenHybridInput(t)
	ctx := context.Background()
	for _, tc := range []struct {
		planV2 bool
		want   goldenHybridCase
	}{{false, h.V1}, {true, h.V2}} {
		m := &mockRest{planV2: tc.planV2}
		client := mockRdkClient(m)
		client.Network.ChainID = h.ChainID
		tx := client.ConnectTx(acc, &HybridOptions{PqcKeypair: kp})
		if !tx.IsHybrid() {
			t.Fatal("ConnectTx with options must be hybrid")
		}
		if _, err := tx.Broadcast(ctx, msgs, params); err != nil {
			t.Fatal(err)
		}
		if len(m.broadcast) != 1 || BytesToHex(m.broadcast[0]) != tc.want.TxRawHex {
			t.Errorf("planV2=%v: broadcast tx is not the golden one", tc.planV2)
		}
	}
}

func TestHybridAutoReSignsOnceAfterHybridRejection(t *testing.T) {
	acc, kp, msgs, params, h := goldenHybridInput(t)
	ctx := context.Background()
	// The cached answer says v1; the chain refuses with pqc code 21 and now
	// reports the v2 upgrade applied, so the tx is re-signed under v2.
	m := &mockRest{planV2: false, responses: []string{`{"tx_response":{"code":21,"codespace":"pqc","raw_log":"hybrid PQC signature verification failed"}}`}}
	client := mockRdkClient(m)
	client.Network.ChainID = h.ChainID
	tx := client.ConnectTx(acc, &HybridOptions{PqcKeypair: kp})
	if _, err := tx.BuildTx(ctx, msgs, params); err != nil { // warm the cache with v1
		t.Fatal(err)
	}
	m.mu.Lock()
	m.planV2 = true
	m.mu.Unlock()
	res, err := tx.Broadcast(ctx, msgs, params)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.broadcast) != 2 || BytesToHex(m.broadcast[0]) != h.V1.TxRawHex || BytesToHex(m.broadcast[1]) != h.V2.TxRawHex {
		t.Fatalf("expected a v1 attempt then a v2 retry, got %d broadcasts", len(m.broadcast))
	}
	if asNum(asRecord(res["tx_response"])["code"], -1) != 0 {
		t.Errorf("expected the retry's response, got %+v", res)
	}

	// An explicit version is never retried.
	m2 := &mockRest{responses: []string{`{"tx_response":{"code":21,"codespace":"pqc","raw_log":"hybrid PQC signature verification failed"}}`}}
	client2 := mockRdkClient(m2)
	client2.Network.ChainID = h.ChainID
	tx2 := client2.ConnectTx(acc, &HybridOptions{PqcKeypair: kp, SignBytesVersion: SignBytesV1})
	if _, err := tx2.Broadcast(ctx, msgs, params); err != nil {
		t.Fatal(err)
	}
	if len(m2.broadcast) != 1 {
		t.Errorf("explicit version must not be retried, got %d broadcasts", len(m2.broadcast))
	}
}

func TestHybridPreflightRunsBeforeSigning(t *testing.T) {
	acc, kp, _, params, h := goldenHybridInput(t)
	m := &mockRest{}
	client := mockRdkClient(m)
	client.Network.ChainID = h.ChainID
	tx := client.ConnectTx(acc, &HybridOptions{PqcKeypair: kp, SignBytesVersion: SignBytesV2})
	bad := tx.CreateRollup(CreateRollupInput{RollupID: "Bad Id!", Profile: "defi", VmType: "evm", StakeAmount: 1})
	if _, err := tx.Broadcast(context.Background(), []Msg{bad}, params); err == nil {
		t.Fatal("expected the rollup id rule to refuse the message")
	}
	if len(m.broadcast) != 0 || len(m.paths) != 0 {
		t.Errorf("nothing may be signed or sent before the rule check, got paths %v", m.paths)
	}
}

func TestHybridAutoWithoutRestFailsOnLegacyChain(t *testing.T) {
	acc, kp, msgs, params, h := goldenHybridInput(t)
	tx := NewRdkTxClient(acc, h.ChainID, nil).WithHybrid(HybridOptions{PqcKeypair: kp})
	if _, err := tx.BuildTx(context.Background(), msgs, params); err == nil {
		t.Error("auto sign-bytes on a legacy chain without a REST client must fail, not guess")
	}
}
