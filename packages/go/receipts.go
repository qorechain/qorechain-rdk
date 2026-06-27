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

// SettlementReceipt is a portable, offline-verifiable proof that a rollup's
// settlement batch was anchored to the QoreChain Main Chain under a post-quantum
// (ML-DSA-87 / Dilithium-5) signature.
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
	// BatchStateRoot is the state root read from the settlement batch (hex), for
	// the binding check.
	BatchStateRoot string
}

// ReceiptChecks records the individual checks performed when verifying a
// receipt.
type ReceiptChecks struct {
	// StateRootBinding is true when the batch's state root equals the anchored
	// state root.
	StateRootBinding bool
	// PqcSignature is true when the Dilithium-5 signature over the canonical
	// message verified.
	PqcSignature bool
	// HasMaterial is true when a non-empty signature and key were present to
	// check.
	HasMaterial bool
}

// ReceiptVerification is the outcome of verifying a receipt.
type ReceiptVerification struct {
	Valid  bool
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

// VerifySettlementReceipt verifies a settlement receipt: the batch<->anchor
// state-root binding and the Dilithium-5 signature over the canonical anchor
// message.
//
// creatorPublicKeyHex (optional) is the layer creator's ML-DSA-87 public key in
// hex; supply it for a fully offline check. If it is empty, client is used to
// fetch the creator's registered post-quantum key from the chain. ctx and client
// may be nil when creatorPublicKeyHex is supplied.
func VerifySettlementReceipt(ctx context.Context, receipt SettlementReceipt, creatorPublicKeyHex string, client *RdkClient) ReceiptVerification {
	checks := ReceiptChecks{}
	checks.StateRootBinding = receipt.StateRoot != "" && receipt.StateRoot == receipt.BatchStateRoot

	publicKeyHex := creatorPublicKeyHex
	if publicKeyHex == "" {
		if client == nil {
			return ReceiptVerification{
				Valid:  false,
				Checks: checks,
				Reason: "no creatorPublicKey supplied and no client to fetch the creator's PQC key",
			}
		}
		account, err := client.Rest.GetPqcAccount(ctx, receipt.Creator)
		if err != nil {
			return ReceiptVerification{Valid: false, Checks: checks, Reason: fmt.Sprintf("failed to fetch creator PQC key: %v", err)}
		}
		publicKeyHex = account.PublicKey
	}

	checks.HasMaterial = publicKeyHex != "" && receipt.PqcSignature != ""
	if !checks.HasMaterial {
		return ReceiptVerification{Valid: false, Checks: checks, Reason: "missing public key or anchor signature"}
	}

	pub, err := HexToBytes(publicKeyHex)
	if err != nil {
		return ReceiptVerification{Valid: false, Checks: checks, Reason: fmt.Sprintf("invalid public key: %v", err)}
	}
	sig, err := HexToBytes(receipt.PqcSignature)
	if err != nil {
		return ReceiptVerification{Valid: false, Checks: checks, Reason: fmt.Sprintf("invalid signature: %v", err)}
	}

	message := AnchorSignBytes(receipt.LayerID, receipt.LayerHeight, receipt.StateRoot, receipt.ValidatorSetHash)
	checks.PqcSignature = pqc.MLDSA87.Verify(pub, message, sig)

	valid := checks.StateRootBinding && checks.PqcSignature
	reason := ""
	if !valid {
		if !checks.StateRootBinding {
			reason = "batch state root does not match the anchored state root"
		} else {
			reason = "Dilithium-5 anchor signature did not verify"
		}
	}
	return ReceiptVerification{Valid: valid, Checks: checks, Reason: reason}
}
