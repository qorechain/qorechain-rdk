package rdk

import (
	"context"
	"encoding/binary"
	"fmt"

	pqc "github.com/qorechain/qorechain-pqc/go"
)

// RECEIPT_ALGORITHM is the post-quantum algorithm the anchor signature uses.
const ReceiptAlgorithm = "ML-DSA-87"

// ReceiptVersion is the current receipt schema version.
const ReceiptVersion = 1

// SettlementReceipt is a portable record that a rollup's settlement batch was
// anchored to the QoreChain Main Chain under a post-quantum (ML-DSA-87 /
// Dilithium-5) signature.
//
// A receipt is a claim, not evidence — every field in it is supplied by whoever
// hands it to you. VerifySettlementReceipt therefore re-reads the claim from
// live chain state (the rollup's layer, the batch's state root, the anchor, and
// the creator's registered key) and only then reports it valid. Checking the
// signature alone, against a key you were handed, proves that someone signed
// those bytes — not that QoreChain anchored anything.
//
// Canonical anchor message (matches the chain's anchorSignBytes):
//
//	layer_id || layer_height(8-byte big-endian) || state_root || validator_set_hash
type SettlementReceipt struct {
	Version    int
	RollupID   string
	LayerID    string
	BatchIndex uint64
	// Creator is the layer creator — the registered signer of the anchor's PQC
	// signature.
	Creator   string
	Algorithm string
	// StateRoot is the anchored state root (hex).
	StateRoot        string
	LayerHeight      uint64
	ValidatorSetHash string
	MainChainHeight  uint64
	AnchoredAt       int64
	// PqcSignature is the Dilithium-5 anchor signature (hex).
	PqcSignature string
	// BatchStateRoot is the state root read from the settlement batch (hex) when
	// the receipt was built. Informational only — verification compares the
	// receipt against the chain's batch, never against this copy of it.
	BatchStateRoot string
}

// ReceiptVerificationMode says how a receipt was checked.
type ReceiptVerificationMode string

const (
	// ReceiptModeChain means every field was reproduced from live chain state.
	// Only this mode can yield Valid: true.
	ReceiptModeChain ReceiptVerificationMode = "chain"
	// ReceiptModeSignatureOnly means only the ML-DSA-87 signature was checked,
	// against a key the caller supplied. That proves whoever holds that key
	// signed these bytes; it does NOT prove the anchor exists on QoreChain, so
	// the result is always Valid: false.
	ReceiptModeSignatureOnly ReceiptVerificationMode = "signature-only"
)

// ReceiptChecks records the individual checks performed when verifying a
// receipt. Every check is answered from chain state, never from the receipt
// itself.
type ReceiptChecks struct {
	// RollupLayerBinding is true when the chain says the receipt's rollup
	// belongs to the receipt's layer.
	RollupLayerBinding bool
	// BatchStateRoot is true when the chain's batch carries the receipt's state
	// root.
	BatchStateRoot bool
	// AnchorOnChain is true when an anchor with this state root, height,
	// validator-set hash and signature exists on chain.
	AnchorOnChain bool
	// CreatorAuthority is true when the receipt names the chain's rollup creator
	// and that creator has a registered post-quantum key (resolved from chain,
	// not taken from the receipt).
	CreatorAuthority bool
	// PqcSignature is true when the Dilithium-5 signature over the canonical
	// message verified.
	PqcSignature bool
}

// ReceiptVerification is the outcome of verifying a receipt.
type ReceiptVerification struct {
	// Valid is true only when the receipt was reproduced from live chain state.
	Valid bool
	// Mode records which check was actually performed.
	Mode   ReceiptVerificationMode
	Checks ReceiptChecks
	Reason string
}

// AnchorSignBytes reconstructs the canonical message the chain signs for a state
// anchor:
//
//	layer_id || layer_height(8B BE) || state_root || validator_set_hash
//
// stateRootHex and vshHex are hex strings (with or without a 0x prefix) and
// layerHeight is a uint64. Invalid hex inputs are treated as empty byte runs, so
// callers that have validated their inputs get an exact canonical encoding.
func AnchorSignBytes(layerID string, layerHeight uint64, stateRootHex, vshHex string) []byte {
	height := make([]byte, 8)
	binary.BigEndian.PutUint64(height, layerHeight)
	stateRoot, _ := HexToBytes(stateRootHex)
	vsh, _ := HexToBytes(vshHex)
	out := make([]byte, 0, len(layerID)+len(height)+len(stateRoot)+len(vsh))
	out = append(out, []byte(layerID)...)
	out = append(out, height...)
	out = append(out, stateRoot...)
	out = append(out, vsh...)
	return out
}

// BuildSettlementReceipt builds a settlement receipt for rollupID's batch
// batchIndex: it resolves the rollup's layer, reads the batch's state root, and
// finds the state anchor that commits that root to the Main Chain. It errors if
// the rollup has no layer, the batch is missing, or no anchor covers the batch's
// state root yet.
func BuildSettlementReceipt(ctx context.Context, client *RdkClient, rollupID string, batchIndex uint64) (SettlementReceipt, error) {
	rollup, err := client.Rest.GetRollup(ctx, rollupID)
	if err != nil {
		return SettlementReceipt{}, err
	}
	if rollup.LayerID == "" {
		return SettlementReceipt{}, fmt.Errorf("rollup %q has no layer_id — it is not anchored to a multilayer layer", rollupID)
	}
	batch, err := client.Rest.GetBatch(ctx, rollupID, batchIndex)
	if err != nil {
		return SettlementReceipt{}, err
	}
	batchStateRootHex := hexWireBytes(batch.StateRoot)

	anchors, err := client.Rest.GetAnchors(ctx, rollup.LayerID)
	if err != nil {
		return SettlementReceipt{}, err
	}
	var covering *AnchorView
	for i := range anchors {
		if anchors[i].StateRoot != "" && anchors[i].StateRoot == batchStateRootHex {
			covering = &anchors[i]
			break
		}
	}
	anchor := covering
	if anchor == nil {
		latest, lerr := client.Rest.GetLatestAnchor(ctx, rollup.LayerID)
		if lerr != nil {
			return SettlementReceipt{}, lerr
		}
		anchor = &latest
	}
	if anchor.StateRoot == "" {
		return SettlementReceipt{}, fmt.Errorf("no state anchor found for layer %q", rollup.LayerID)
	}
	if covering == nil {
		return SettlementReceipt{}, fmt.Errorf(
			"no anchor commits batch %d's state root yet (latest anchored height %d); the batch may not be anchored to the Main Chain",
			batchIndex, anchor.LayerHeight)
	}
	return SettlementReceipt{
		Version:          ReceiptVersion,
		RollupID:         rollupID,
		LayerID:          rollup.LayerID,
		BatchIndex:       batchIndex,
		Creator:          rollup.Creator,
		Algorithm:        ReceiptAlgorithm,
		StateRoot:        anchor.StateRoot,
		LayerHeight:      anchor.LayerHeight,
		ValidatorSetHash: anchor.ValidatorSetHash,
		MainChainHeight:  anchor.MainChainHeight,
		AnchoredAt:       anchor.AnchoredAt,
		PqcSignature:     anchor.PqcSignature,
		BatchStateRoot:   batchStateRootHex,
	}, nil
}

// signatureOver checks the receipt's Dilithium-5 anchor signature against
// publicKeyHex over the canonical anchor message.
func signatureOver(receipt SettlementReceipt, publicKeyHex string) bool {
	if publicKeyHex == "" || receipt.PqcSignature == "" {
		return false
	}
	pub, err := HexToBytes(publicKeyHex)
	if err != nil {
		return false
	}
	sig, err := HexToBytes(receipt.PqcSignature)
	if err != nil {
		return false
	}
	message := AnchorSignBytes(receipt.LayerID, receipt.LayerHeight, receipt.StateRoot, receipt.ValidatorSetHash)
	return pqc.MLDSA87.Verify(pub, message, sig)
}

// VerifySettlementReceipt verifies a settlement receipt against live chain
// state.
//
// A receipt is a claim, not evidence: every field in it is supplied by whoever
// hands it to you. Verification therefore re-reads the claim from the chain —
// the rollup's layer, the batch's state root, the anchor itself, and the signing
// key — and reports Valid: true (with Mode ReceiptModeChain) only when the
// receipt reproduces what the chain actually holds. Pass a non-nil client for
// this.
//
// Without a client, creatorPublicKeyHex (the layer creator's ML-DSA-87 public
// key in hex, obtained out-of-band) still lets you check the signature, but that
// is Mode ReceiptModeSignatureOnly and never Valid: a signature proves someone
// signed these bytes, not that the anchor exists on QoreChain. Verification is
// NOT possible offline. creatorPublicKeyHex is ignored when client is supplied —
// the key is always resolved from chain state in that case.
func VerifySettlementReceipt(ctx context.Context, receipt SettlementReceipt, creatorPublicKeyHex string, client *RdkClient) ReceiptVerification {
	checks := ReceiptChecks{}

	if client == nil {
		if creatorPublicKeyHex == "" {
			return ReceiptVerification{
				Valid:  false,
				Mode:   ReceiptModeSignatureOnly,
				Checks: checks,
				Reason: "no client supplied — pass a client to verify against chain state; a receipt on its own proves nothing",
			}
		}
		checks.PqcSignature = signatureOver(receipt, creatorPublicKeyHex)
		reason := "signature did not verify against the supplied key"
		if checks.PqcSignature {
			reason = "signature is valid for the supplied key, but nothing was checked against the chain — pass a client to verify settlement"
		}
		return ReceiptVerification{Valid: false, Mode: ReceiptModeSignatureOnly, Checks: checks, Reason: reason}
	}

	if ctx == nil {
		ctx = context.Background()
	}
	rest := client.Rest
	fail := func(format string, args ...any) ReceiptVerification {
		return ReceiptVerification{
			Valid:  false,
			Mode:   ReceiptModeChain,
			Checks: checks,
			Reason: fmt.Sprintf(format, args...),
		}
	}

	// 1. The rollup must exist on chain and belong to the layer the receipt names.
	rollup, err := rest.GetRollup(ctx, receipt.RollupID)
	if err != nil {
		return fail("rollup %q not found on chain: %v", receipt.RollupID, err)
	}
	checks.RollupLayerBinding = rollup.LayerID != "" && rollup.LayerID == receipt.LayerID
	if !checks.RollupLayerBinding {
		onChainLayer := rollup.LayerID
		if onChainLayer == "" {
			onChainLayer = "(none)"
		}
		return fail("rollup %q is anchored to layer %q, not %q", receipt.RollupID, onChainLayer, receipt.LayerID)
	}

	// 2. The chain's batch must carry the receipt's state root (never the
	//    receipt's own copy of it).
	batch, err := rest.GetBatch(ctx, receipt.RollupID, receipt.BatchIndex)
	if err != nil {
		return fail("batch %d not found on chain: %v", receipt.BatchIndex, err)
	}
	onChainRoot := hexWireBytes(batch.StateRoot)
	checks.BatchStateRoot = onChainRoot != "" && onChainRoot == receipt.StateRoot
	if !checks.BatchStateRoot {
		return fail("the chain's batch does not carry the receipt's state root")
	}

	// 3. An anchor matching this receipt must actually exist on chain.
	anchors, err := rest.GetAnchors(ctx, receipt.LayerID)
	if err != nil {
		return fail("could not read anchors for layer %q: %v", receipt.LayerID, err)
	}
	for _, a := range anchors {
		if a.StateRoot == receipt.StateRoot &&
			a.LayerHeight == receipt.LayerHeight &&
			a.ValidatorSetHash == receipt.ValidatorSetHash &&
			a.PqcSignature == receipt.PqcSignature {
			checks.AnchorOnChain = true
			break
		}
	}
	if !checks.AnchorOnChain {
		return fail("no anchor on chain matches this receipt — it is fabricated or superseded")
	}

	// 4. The signing key is resolved from the chain, never taken from the receipt.
	account, err := rest.GetPqcAccount(ctx, rollup.Creator)
	if err != nil {
		return fail("could not resolve the creator's post-quantum key: %v", err)
	}
	if receipt.Creator != rollup.Creator {
		return fail("receipt names creator %q but the chain says the rollup's creator is %q", receipt.Creator, rollup.Creator)
	}
	checks.CreatorAuthority = account.PublicKey != ""
	if !checks.CreatorAuthority {
		return fail("no post-quantum key is registered for creator %s", rollup.Creator)
	}

	// 5. Finally the post-quantum signature over the canonical anchor message.
	checks.PqcSignature = signatureOver(receipt, account.PublicKey)
	if !checks.PqcSignature {
		return fail("Dilithium-5 anchor signature did not verify against the creator's registered key")
	}
	return ReceiptVerification{Valid: true, Mode: ReceiptModeChain, Checks: checks}
}
