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

	// Verify offline with a supplied public key.
	v := VerifySettlementReceipt(ctx, receipt, pubHex, nil)
	if !v.Valid || !v.Checks.StateRootBinding || !v.Checks.PqcSignature || !v.Checks.HasMaterial {
		t.Errorf("offline verify failed: %+v", v)
	}

	// Verify by fetching the creator's PQC key from the chain.
	v2 := VerifySettlementReceipt(ctx, receipt, "", client)
	if !v2.Valid {
		t.Errorf("client-fetched verify failed: %+v", v2)
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
	v := VerifySettlementReceipt(ctx, receipt, pubHex, nil)
	if v.Valid {
		t.Error("expected tampered receipt to be invalid")
	}
	if v.Checks.PqcSignature {
		t.Error("expected pqcSignature check to fail for tampered signature")
	}
	if !v.Checks.StateRootBinding {
		t.Error("state-root binding should still hold for a tampered signature")
	}
}

func TestVerifyReceiptNoKeyNoClient(t *testing.T) {
	v := VerifySettlementReceipt(context.Background(), SettlementReceipt{
		StateRoot: "ab", BatchStateRoot: "ab", PqcSignature: "cd",
	}, "", nil)
	if v.Valid || v.Reason == "" {
		t.Errorf("expected invalid with reason, got %+v", v)
	}
}
