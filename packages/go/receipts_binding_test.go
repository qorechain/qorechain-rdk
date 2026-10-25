package rdk

import (
	"context"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	pqc "github.com/qorechain/qorechain-pqc/go"
)

// genuineReceipt builds a receipt from a mock chain that signs its one anchor
// with a fresh ML-DSA-87 key, and returns the client that verifies it.
func genuineReceipt(t *testing.T) (SettlementReceipt, *RdkClient, func()) {
	t.Helper()
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
	sig, err := pqc.MLDSA87.Sign(sec, AnchorSignBytes(layerID, 42, stateRoot, vsh))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	srv := receiptTestServer(t, layerID, stateRoot, vsh, creator, hex.EncodeToString(pub), sig)
	client := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})
	receipt, err := BuildSettlementReceipt(context.Background(), client, "r", 0)
	if err != nil {
		srv.Close()
		t.Fatalf("build receipt: %v", err)
	}
	return receipt, client, srv.Close
}

func TestVerifiedReceiptIsRebuiltFromChain(t *testing.T) {
	receipt, client, done := genuineReceipt(t)
	defer done()
	v := VerifySettlementReceipt(context.Background(), receipt, "", client)
	if !v.Valid {
		t.Fatalf("genuine receipt refused: %s", v.Reason)
	}
	if v.Anchor == nil || v.Anchor.MainChainHeight != 100 {
		t.Fatalf("expected the chain's anchor, got %+v", v.Anchor)
	}
	if v.VerifiedReceipt == nil || *v.VerifiedReceipt != receipt {
		t.Fatalf("verified receipt %+v differs from the chain-built one %+v", v.VerifiedReceipt, receipt)
	}
}

// Every anchor field the receipt states is bound to the chain, not only the
// four the anchor lookup uses. Each forged copy keeps a genuine signature, so
// only the field comparison can catch it.
func TestForgedReceiptMetadataIsRefused(t *testing.T) {
	cases := []struct {
		field string
		forge func(*SettlementReceipt)
	}{
		{"MainChainHeight", func(r *SettlementReceipt) { r.MainChainHeight = 999999 }},
		{"AnchoredAt", func(r *SettlementReceipt) { r.AnchoredAt = 9999999999 }},
		{"ValidatorSetHash", func(r *SettlementReceipt) { r.ValidatorSetHash = strings.Repeat("00", 32) }},
		{"TransactionCount", func(r *SettlementReceipt) { r.TransactionCount = 8 }},
		{"CompressedStateProof", func(r *SettlementReceipt) { r.CompressedStateProof = "deadbeef" }},
		{"BatchStateRoot", func(r *SettlementReceipt) { r.BatchStateRoot = strings.Repeat("11", 32) }},
	}
	for _, c := range cases {
		t.Run(c.field, func(t *testing.T) {
			receipt, client, done := genuineReceipt(t)
			defer done()
			c.forge(&receipt)
			v := VerifySettlementReceipt(context.Background(), receipt, "", client)
			if v.Valid || v.Checks.AnchorOnChain || v.VerifiedReceipt != nil {
				t.Fatalf("forged %s accepted: %+v", c.field, v)
			}
			if !strings.Contains(v.Reason, c.field) {
				t.Fatalf("reason %q does not name %s", v.Reason, c.field)
			}
		})
	}
}

func TestUnknownReceiptSchemaIsRefusedBeforeReadingTheChain(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.NotFound(w, r)
	}))
	defer srv.Close()
	counting := NewRdkClient(RdkClientOptions{Endpoints: &Endpoints{Rest: srv.URL}, HTTP: srv.Client()})

	cases := []struct {
		name, want string
		forge      func(*SettlementReceipt)
	}{
		{"version 99", "unsupported receipt version 99", func(r *SettlementReceipt) { r.Version = 99 }},
		{"version 0", "unsupported receipt version 0", func(r *SettlementReceipt) { r.Version = 0 }},
		{"algorithm", `unsupported algorithm "ML-DSA-44"`, func(r *SettlementReceipt) { r.Algorithm = "ML-DSA-44" }},
		{"v2 without chain", "ChainID", func(r *SettlementReceipt) { r.ChainID = "" }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			receipt, _, done := genuineReceipt(t)
			done()
			c.forge(&receipt)
			v := VerifySettlementReceipt(context.Background(), receipt, "", counting)
			if v.Valid || !strings.Contains(v.Reason, c.want) {
				t.Fatalf("got %+v, want reason containing %q", v, c.want)
			}
		})
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("schema check read the chain %d times", n)
	}
}

func TestVersion1ReceiptWithoutV2FieldsStillVerifies(t *testing.T) {
	receipt, client, done := genuineReceipt(t)
	defer done()
	receipt.Version, receipt.ChainID, receipt.TransactionCount, receipt.CompressedStateProof = 1, "", 0, ""
	if v := VerifySettlementReceipt(context.Background(), receipt, "", client); !v.Valid {
		t.Fatalf("version-1 receipt refused: %s", v.Reason)
	}
}
