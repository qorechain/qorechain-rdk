package rdk

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	pqc "github.com/qorechain/qorechain-pqc/go"
)

// TestAnchorSignBytesGolden asserts AnchorSignBytes reproduces the canonical
// message from the cross-language golden fixture.
func TestAnchorSignBytesGolden(t *testing.T) {
	g := loadGolden(t)
	a := g.AnchorSignBytes
	got := hex.EncodeToString(AnchorSignBytes(a.LayerID, a.LayerHeight, a.StateRoot, a.ValidatorSetHash))
	if got != a.ExpectedHex {
		t.Fatalf("AnchorSignBytes mismatch:\n got  %s\n want %s", got, a.ExpectedHex)
	}
}

// TestMLDSACrossImplVector verifies the static ML-DSA-87 vector produced by the
// reference implementation, asserting the Go PQC library agrees.
func TestMLDSACrossImplVector(t *testing.T) {
	g := loadGolden(t)
	v := g.MldsaVector
	pub, err := hex.DecodeString(v.PublicKeyHex)
	if err != nil {
		t.Fatalf("decode public key: %v", err)
	}
	sig, err := hex.DecodeString(v.SignatureHex)
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	if !pqc.MLDSA87.Verify(pub, []byte(v.MessageUtf8), sig) {
		t.Fatal("cross-impl ML-DSA-87 vector did not verify")
	}
	// Negative control: a tampered message must not verify.
	if pqc.MLDSA87.Verify(pub, []byte(v.MessageUtf8+"x"), sig) {
		t.Fatal("tampered message unexpectedly verified")
	}
}

// receiptTestServer stands up an httptest server returning rollup/batch/anchors/
// pqc JSON, encoding wire bytes as base64 to exercise the tolerant decoder.
func receiptTestServer(t *testing.T, layerID, stateRoot, vsh, creator, pubHex string, sig []byte) *httptest.Server {
	t.Helper()
	b64 := func(h string) string {
		b, err := hex.DecodeString(h)
		if err != nil {
			t.Fatalf("hex %q: %v", h, err)
		}
		return base64.StdEncoding.EncodeToString(b)
	}
	pubBytes, _ := hex.DecodeString(pubHex)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		p := r.URL.Path
		switch {
		case strings.Contains(p, "/qorechain/rdk/v1/rollup/"):
			fmt.Fprintf(w, `{"rollup":{"rollup_id":"r","creator":%q,"layer_id":%q,"status":"active"}}`, creator, layerID)
		case strings.Contains(p, "/qorechain/rdk/v1/batch/"):
			fmt.Fprintf(w, `{"batch":{"rollup_id":"r","batch_index":0,"state_root":%q,"status":"finalized"}}`, b64(stateRoot))
		case strings.Contains(p, "/qorechain/multilayer/v1/anchors/"):
			fmt.Fprintf(w, `{"anchors":[{"layer_id":%q,"layer_height":42,"state_root":%q,"validator_set_hash":%q,"main_chain_height":100,"anchored_at":1700000000,"pqc_aggregate_signature":%q,"transaction_count":7}]}`,
				layerID, b64(stateRoot), b64(vsh), base64.StdEncoding.EncodeToString(sig))
		case strings.Contains(p, "/qorechain/multilayer/v1/anchor/"):
			fmt.Fprintf(w, `{"anchor":{"layer_id":%q,"layer_height":42,"state_root":%q,"validator_set_hash":%q}}`, layerID, b64(stateRoot), b64(vsh))
		case strings.Contains(p, "/qorechain/pqc/v1/accounts/"):
			fmt.Fprintf(w, `{"account":{"address":%q,"public_key":%q,"algorithm_name":"ML-DSA-87","algorithm_id":3}}`,
				creator, base64.StdEncoding.EncodeToString(pubBytes))
		default:
			http.NotFound(w, r)
		}
	}))
	return srv
}

func TestSettlementReceiptRoundTrip(t *testing.T) {
	const (
		layerID   = "layer-rollup-1"
		stateRoot = "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d"
		vsh       = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
		creator   = "qor1creator0000000000000000000000000000000"
	)
	pub, sec, err := pqc.MLDSA87.Keygen()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	pubHex := hex.EncodeToString(pub)
	message := AnchorSignBytes(layerID, 42, stateRoot, vsh)
	sig, err := pqc.MLDSA87.Sign(sec, message)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	srv := receiptTestServer(t, layerID, stateRoot, vsh, creator, pubHex, sig)
	defer srv.Close()
	client := NewRdkClient(RdkClientOptions{
		Endpoints: &Endpoints{Rest: srv.URL},
		HTTP:      srv.Client(),
	})
	ctx := context.Background()

	receipt, err := BuildSettlementReceipt(ctx, client, "r", 0)
	if err != nil {
		t.Fatalf("build receipt: %v", err)
	}
	if receipt.LayerID != layerID {
		t.Errorf("layerId got %q want %q", receipt.LayerID, layerID)
	}
	if receipt.StateRoot != stateRoot {
		t.Errorf("stateRoot got %q want %q", receipt.StateRoot, stateRoot)
	}
	if receipt.BatchStateRoot != stateRoot {
		t.Errorf("batchStateRoot got %q want %q", receipt.BatchStateRoot, stateRoot)
	}
	if receipt.Algorithm != "ML-DSA-87" {
		t.Errorf("algorithm got %q", receipt.Algorithm)
	}
	if receipt.Creator != creator {
		t.Errorf("creator got %q want %q", receipt.Creator, creator)
	}

	// Verified against live chain state: the only mode that can be valid.
	v := VerifySettlementReceipt(ctx, receipt, "", client)
	if !v.Valid {
		t.Fatalf("chain verify failed: %+v", v)
	}
	if v.Mode != ReceiptModeChain {
		t.Errorf("mode got %q want %q", v.Mode, ReceiptModeChain)
	}
	if !v.Checks.RollupLayerBinding || !v.Checks.BatchStateRoot || !v.Checks.AnchorOnChain ||
		!v.Checks.CreatorAuthority || !v.Checks.PqcSignature {
		t.Errorf("expected every check to pass, got %+v", v.Checks)
	}

	// Signature-only is never valid, even for a genuine receipt.
	sigOnly := VerifySettlementReceipt(ctx, receipt, pubHex, nil)
	if !sigOnly.Checks.PqcSignature {
		t.Error("the signature really is good; expected the signature check to pass")
	}
	if sigOnly.Valid {
		t.Errorf("signature-only must never be valid: %+v", sigOnly)
	}
	if sigOnly.Mode != ReceiptModeSignatureOnly {
		t.Errorf("mode got %q want %q", sigOnly.Mode, ReceiptModeSignatureOnly)
	}
	if sigOnly.Reason == "" {
		t.Error("expected a reason explaining nothing was checked against the chain")
	}
}

func TestSettlementReceiptTamperedSignature(t *testing.T) {
	const (
		layerID   = "layer-rollup-1"
		stateRoot = "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d"
		vsh       = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
		creator   = "qor1creator0000000000000000000000000000000"
	)
	pub, sec, err := pqc.MLDSA87.Keygen()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	pubHex := hex.EncodeToString(pub)
	message := AnchorSignBytes(layerID, 42, stateRoot, vsh)
	sig, err := pqc.MLDSA87.Sign(sec, message)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	sig[10] ^= 0xff // tamper

	srv := receiptTestServer(t, layerID, stateRoot, vsh, creator, pubHex, sig)
	defer srv.Close()
	client := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})
	ctx := context.Background()

	receipt, err := BuildSettlementReceipt(ctx, client, "r", 0)
	if err != nil {
		t.Fatalf("build receipt: %v", err)
	}
	v := VerifySettlementReceipt(ctx, receipt, "", client)
	if v.Valid {
		t.Error("expected tampered receipt to be invalid")
	}
	if v.Mode != ReceiptModeChain {
		t.Errorf("mode got %q want %q", v.Mode, ReceiptModeChain)
	}
	if v.Checks.PqcSignature {
		t.Error("expected pqcSignature check to fail for tampered signature")
	}
	// Everything up to the signature is genuinely on chain.
	if !v.Checks.RollupLayerBinding || !v.Checks.BatchStateRoot || !v.Checks.AnchorOnChain || !v.Checks.CreatorAuthority {
		t.Errorf("expected the chain checks to hold for a tampered signature, got %+v", v.Checks)
	}
}

func TestVerifyReceiptNoKeyNoClient(t *testing.T) {
	v := VerifySettlementReceipt(context.Background(), SettlementReceipt{
		StateRoot: "ab", BatchStateRoot: "ab", PqcSignature: "cd",
	}, "", nil)
	if v.Valid || v.Reason == "" {
		t.Errorf("expected invalid with reason, got %+v", v)
	}
	if v.Mode != ReceiptModeSignatureOnly {
		t.Errorf("mode got %q want %q", v.Mode, ReceiptModeSignatureOnly)
	}
}

// TestFabricatedReceiptQSR20260055 is the regression test for bug-bounty report
// QSR-2026-0055: a receipt is a claim, not evidence. An attacker generates their
// own ML-DSA-87 keypair, invents a state root, sets both state-root fields to it
// (defeating the old vacuous "binding" check, which compared two fields of the
// same attacker-supplied object) and signs the canonical anchor message with
// their own key. Neither signature-only nor chain verification may accept it.
func TestFabricatedReceiptQSR20260055(t *testing.T) {
	evilPub, evilSec, err := pqc.MLDSA87.Keygen()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	fabricatedRoot := strings.Repeat("de", 32)
	fake := SettlementReceipt{
		Version:          ReceiptVersion,
		RollupID:         "victim-rollup",
		LayerID:          "layer-victim",
		BatchIndex:       999,
		Creator:          "qor1attackerownaddressxxxxxxxxxxxxxxxxxxx",
		Algorithm:        ReceiptAlgorithm,
		StateRoot:        fabricatedRoot,
		LayerHeight:      123456,
		ValidatorSetHash: strings.Repeat("ab", 32),
		MainChainHeight:  999999,
		AnchoredAt:       1757000000,
		// The attacker controls both sides of the old "binding" check.
		BatchStateRoot: fabricatedRoot,
	}
	message := AnchorSignBytes(fake.LayerID, fake.LayerHeight, fake.StateRoot, fake.ValidatorSetHash)
	sig, err := pqc.MLDSA87.Sign(evilSec, message)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	fake.PqcSignature = hex.EncodeToString(sig)

	ctx := context.Background()

	// Signature-only: the signature is internally consistent, but proves nothing.
	sigOnly := VerifySettlementReceipt(ctx, fake, hex.EncodeToString(evilPub), nil)
	if !sigOnly.Checks.PqcSignature {
		t.Error("the attacker's self-signed signature should verify against their own key")
	}
	if sigOnly.Valid {
		t.Errorf("fabricated receipt accepted in signature-only mode: %+v", sigOnly)
	}
	if sigOnly.Mode != ReceiptModeSignatureOnly {
		t.Errorf("mode got %q want %q", sigOnly.Mode, ReceiptModeSignatureOnly)
	}

	// Against the chain: the rollup is not bound to the claimed layer, so it
	// cannot pass however well-formed the receipt is.
	const (
		layerID   = "layer-rollup-1"
		stateRoot = "98d658fb28540a2eca2a8a5930c309a9c37f89979d48d025a72c36a77a74510d"
		vsh       = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
		creator   = "qor1creator0000000000000000000000000000000"
	)
	honestPub, _, err := pqc.MLDSA87.Keygen()
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	srv := receiptTestServer(t, layerID, stateRoot, vsh, creator, hex.EncodeToString(honestPub), []byte{1, 2, 3})
	defer srv.Close()
	client := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})

	v := VerifySettlementReceipt(ctx, fake, hex.EncodeToString(evilPub), client)
	if v.Valid {
		t.Errorf("fabricated receipt accepted against chain state: %+v", v)
	}
	if v.Mode != ReceiptModeChain {
		t.Errorf("mode got %q want %q", v.Mode, ReceiptModeChain)
	}
	if v.Checks.RollupLayerBinding {
		t.Error("the chain does not bind victim-rollup to layer-victim")
	}
	if v.Checks.AnchorOnChain {
		t.Error("no anchor on chain matches the fabricated receipt")
	}
	if v.Reason == "" {
		t.Error("expected a reason for the rejection")
	}
}
