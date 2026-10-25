package rdk

import (
	"context"
	"encoding/binary"
	"fmt"
	"strings"

	pqc "github.com/qorechain/qorechain-pqc/go"
)

// RECEIPT_ALGORITHM is the post-quantum algorithm the anchor signature uses.
const ReceiptAlgorithm = "ML-DSA-87"

// ReceiptVersion is the current receipt schema version.
//
// v2 adds ChainID. The v2 anchor message binds the signature to one network,
// and a receipt shown to a third party should say which network it is for
// rather than leave them to assume. Version-1 receipts still verify.
const ReceiptVersion = 2

// SupportedReceiptVersions are the receipt schema versions this release can
// verify.
var SupportedReceiptVersions = []int{1, 2}

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
	// the receipt was built. Verification requires it to equal the chain's
	// batch root.
	BatchStateRoot string
	// ChainID is the chain the receipt was built on (e.g. "qorechain-vladi").
	// It is bound into the v2 anchor signature, and cross-checked against the
	// node being queried. Empty on version-1 receipts.
	ChainID string
	// TransactionCount is the anchor's transaction count, covered by the v2
	// signature. Verification requires it to equal the chain's anchor on a
	// version-2 receipt, and on a version-1 receipt whenever it is non-zero.
	TransactionCount uint64
	// CompressedStateProof is the anchor's compressed state proof (hex),
	// covered by the v2 signature. Empty for a settlement batch. Compared like
	// TransactionCount.
	CompressedStateProof string
}

// ReceiptVerificationMode says how a receipt was checked.
type ReceiptVerificationMode string

const (
	// ReceiptModeChain means every receipt field was checked against live chain state.
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
	// AnchorOnChain is true when an anchor exists on chain that matches every
	// anchor field of the receipt: state root, layer height, validator-set
	// hash, signature, Main Chain height, anchor time, transaction count and
	// compressed state proof.
	AnchorOnChain bool
	// CreatorAuthority is true when the receipt names the chain's rollup creator
	// and that creator has a registered post-quantum key (resolved from chain,
	// not taken from the receipt).
	CreatorAuthority bool
	// PqcSignature is true when the Dilithium-5 signature over the canonical
	// message verified.
	PqcSignature bool
	// ChainBinding is true when the receipt names the chain that was actually
	// queried. A version-1 receipt carries no chain id and passes on the
	// strength of the anchor having been found on this chain.
	ChainBinding bool
}

// ReceiptVerification is the outcome of verifying a receipt.
type ReceiptVerification struct {
	// Valid is true only when the receipt was reproduced from live chain state.
	Valid bool
	// Mode records which check was actually performed.
	Mode   ReceiptVerificationMode
	Checks ReceiptChecks
	// SignBytesVersion records which canonical anchor message the signature
	// was checked against: "v2" from the chain's rdk-integrity height, "v1"
	// below it.
	SignBytesVersion string
	Reason           string
	// Anchor is the chain's own anchor the receipt was matched to, once one
	// was found. Read facts from this, not from the receipt you were handed.
	Anchor *AnchorView
	// VerifiedReceipt is the receipt rebuilt from chain state, set only when
	// Valid is true.
	VerifiedReceipt *SettlementReceipt
}

// ReceiptSchemaError says why receipt cannot be verified at all, or returns ""
// when its version, algorithm and required fields are acceptable. It is
// checked before anything is read from chain: an unknown version or algorithm
// is refused, never guessed.
func ReceiptSchemaError(receipt SettlementReceipt) string {
	supported := false
	for _, v := range SupportedReceiptVersions {
		if receipt.Version == v {
			supported = true
		}
	}
	if !supported {
		return fmt.Sprintf("unsupported receipt version %d (this release verifies versions 1 and 2)", receipt.Version)
	}
	if receipt.Algorithm != ReceiptAlgorithm {
		return fmt.Sprintf("unsupported algorithm %q: QoreChain anchors are signed with %s", receipt.Algorithm, ReceiptAlgorithm)
	}
	if receipt.Version == 2 && receipt.ChainID == "" {
		return "a version-2 receipt must name its chain (ChainID)"
	}
	return ""
}

// anchorFieldMismatch names the first anchor field on which receipt and the
// chain's anchor differ, or returns "". A version-1 receipt may predate the
// transaction count and proof, so those are compared on it only when set.
func anchorFieldMismatch(receipt SettlementReceipt, anchor AnchorView) string {
	if receipt.ValidatorSetHash != anchor.ValidatorSetHash {
		return fmt.Sprintf("receipt's ValidatorSetHash %q does not match the chain's anchor (%q)", receipt.ValidatorSetHash, anchor.ValidatorSetHash)
	}
	if receipt.MainChainHeight != anchor.MainChainHeight {
		return fmt.Sprintf("receipt's MainChainHeight %d does not match the chain's anchor (%d)", receipt.MainChainHeight, anchor.MainChainHeight)
	}
	if receipt.AnchoredAt != anchor.AnchoredAt {
		return fmt.Sprintf("receipt's AnchoredAt %d does not match the chain's anchor (%d)", receipt.AnchoredAt, anchor.AnchoredAt)
	}
	v2 := receipt.Version == 2
	if (v2 || receipt.TransactionCount != 0) && receipt.TransactionCount != anchor.TransactionCount {
		return fmt.Sprintf("receipt's TransactionCount %d does not match the chain's anchor (%d)", receipt.TransactionCount, anchor.TransactionCount)
	}
	claimed, onChain := strings.ToLower(receipt.CompressedStateProof), strings.ToLower(anchor.CompressedStateProof)
	if (v2 || claimed != "") && claimed != onChain {
		return fmt.Sprintf("receipt's CompressedStateProof %q does not match the chain's anchor (%q)", claimed, onChain)
	}
	return ""
}

// AnchorSignDomainV2 tags the v2 anchor sign bytes (chain v3.2.2 and above).
const AnchorSignDomainV2 = "qorechain-multilayer-anchor-v2"

// AnchorSignBytesV1 is the pre-v3.2.2 canonical anchor message:
//
//	layer_id || layer_height(8B BE) || state_root || validator_set_hash
//
// It is kept because anchors written before the chain's rdk-integrity switch
// are signed this way and stay valid forever. Do not use it for new work: it
// carries no length prefixes, so field boundaries are ambiguous, and no chain
// id, so a signature is valid on every chain. Both are why v2 exists.
//
// Invalid hex inputs are treated as empty byte runs, so callers that have
// validated their inputs get an exact canonical encoding.
func AnchorSignBytesV1(layerID string, layerHeight uint64, stateRootHex, vshHex string) []byte {
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

// AnchorSignBytesV2 is the v3.2.2 and later canonical anchor message. Every
// variable-length field carries an 8-byte big-endian length, the chain id binds
// the signature to one network, and the transaction count and compressed state
// proof are covered too, because the chain computes its anchor fraud check from
// them:
//
//	"qorechain-multilayer-anchor-v2"
//	 | BE64 len(chain_id)               chain_id
//	 | BE64 len(layer_id)               layer_id
//	 | BE64                             layer_height
//	 | BE64 len(state_root)             state_root
//	 | BE64 len(validator_set_hash)     validator_set_hash
//	 | BE64                             transaction_count
//	 | BE64 len(compressed_state_proof) compressed_state_proof
//
// For a settlement batch the chain maps these as: layer_id is the rollup's
// layer id, layer_height is the batch index, state_root is the batch state
// root, transaction_count is the batch's transaction count, and
// compressed_state_proof is empty.
func AnchorSignBytesV2(
	chainID, layerID string,
	layerHeight uint64,
	stateRootHex, vshHex string,
	txCount uint64,
	compressedStateProofHex string,
) []byte {
	stateRoot, _ := HexToBytes(stateRootHex)
	vsh, _ := HexToBytes(vshHex)
	proof, _ := HexToBytes(compressedStateProofHex)

	out := make([]byte, 0, len(AnchorSignDomainV2)+6*8+len(chainID)+len(layerID)+
		len(stateRoot)+len(vsh)+len(proof))
	out = append(out, []byte(AnchorSignDomainV2)...)
	putBytes := func(b []byte) {
		out = binary.BigEndian.AppendUint64(out, uint64(len(b)))
		out = append(out, b...)
	}
	putBytes([]byte(chainID))
	putBytes([]byte(layerID))
	out = binary.BigEndian.AppendUint64(out, layerHeight)
	putBytes(stateRoot)
	putBytes(vsh)
	out = binary.BigEndian.AppendUint64(out, txCount)
	putBytes(proof)
	return out
}

// AnchorSignBytesVersionFor reports which anchor message a given anchor was
// signed over: the form in force at the Main Chain height it was recorded at.
//
// Deciding by height rather than trying both forms matters. A v1 signature
// covers no chain id, so it is valid on every chain; accepting v1 where v2 is in
// force would re-admit exactly the weakness v2 was introduced to close.
func AnchorSignBytesVersionFor(anchorMainChainHeight, v2Height uint64) string {
	if anchorMainChainHeight >= v2Height {
		return "v2"
	}
	return "v1"
}

// AnchorSignBytes is the v1 canonical anchor message, kept for backwards
// compatibility. New code should call AnchorSignBytesV1 or AnchorSignBytesV2
// explicitly.
func AnchorSignBytes(layerID string, layerHeight uint64, stateRootHex, vshHex string) []byte {
	return AnchorSignBytesV1(layerID, layerHeight, stateRootHex, vshHex)
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
	return receiptFromParts(rollupID, rollup.LayerID, batchIndex, rollup.Creator, *anchor,
		batchStateRootHex, client.Network.ChainID), nil
}

func receiptFromParts(rollupID, layerID string, batchIndex uint64, creator string,
	anchor AnchorView, batchStateRootHex, chainID string) SettlementReceipt {
	return SettlementReceipt{
		Version:          ReceiptVersion,
		RollupID:         rollupID,
		LayerID:          layerID,
		BatchIndex:       batchIndex,
		Creator:          creator,
		Algorithm:        ReceiptAlgorithm,
		StateRoot:        anchor.StateRoot,
		LayerHeight:      anchor.LayerHeight,
		ValidatorSetHash: anchor.ValidatorSetHash,
		MainChainHeight:  anchor.MainChainHeight,
		AnchoredAt:       anchor.AnchoredAt,
		PqcSignature:     anchor.PqcSignature,
		BatchStateRoot:   batchStateRootHex,

		ChainID:              chainID,
		TransactionCount:     anchor.TransactionCount,
		CompressedStateProof: anchor.CompressedStateProof,
	}
}

// signatureOver verifies an anchor's post-quantum signature.
//
// Every signed field is taken from the chain's anchor, never from the receipt —
// the receipt only says which anchor to go and look for. chainID likewise comes
// from the network being queried.
func signatureOver(anchor AnchorView, publicKeyHex, chainID, version string) bool {
	if publicKeyHex == "" || anchor.PqcSignature == "" {
		return false
	}
	pub, err := HexToBytes(publicKeyHex)
	if err != nil {
		return false
	}
	sig, err := HexToBytes(anchor.PqcSignature)
	if err != nil {
		return false
	}
	var message []byte
	if version == "v2" {
		message = AnchorSignBytesV2(chainID, anchor.LayerID, anchor.LayerHeight,
			anchor.StateRoot, anchor.ValidatorSetHash, anchor.TransactionCount,
			anchor.CompressedStateProof)
	} else {
		message = AnchorSignBytesV1(anchor.LayerID, anchor.LayerHeight,
			anchor.StateRoot, anchor.ValidatorSetHash)
	}
	return pqc.MLDSA87.Verify(pub, message, sig)
}

// receiptAsAnchor exposes the receipt's own copies of the signed fields, for
// signature-only mode where there is no chain to read.
func receiptAsAnchor(receipt SettlementReceipt) AnchorView {
	return AnchorView{
		LayerID:              receipt.LayerID,
		LayerHeight:          receipt.LayerHeight,
		StateRoot:            receipt.StateRoot,
		ValidatorSetHash:     receipt.ValidatorSetHash,
		MainChainHeight:      receipt.MainChainHeight,
		AnchoredAt:           receipt.AnchoredAt,
		PqcSignature:         receipt.PqcSignature,
		TransactionCount:     receipt.TransactionCount,
		CompressedStateProof: receipt.CompressedStateProof,
	}
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

	if reason := ReceiptSchemaError(receipt); reason != "" {
		mode := ReceiptModeChain
		if client == nil {
			mode = ReceiptModeSignatureOnly
		}
		return ReceiptVerification{Valid: false, Mode: mode, Checks: checks, Reason: reason}
	}

	if client == nil {
		if creatorPublicKeyHex == "" {
			return ReceiptVerification{
				Valid:  false,
				Mode:   ReceiptModeSignatureOnly,
				Checks: checks,
				Reason: "no client supplied — pass a client to verify against chain state; a receipt on its own proves nothing",
			}
		}
		// Without a client there is no chain to read, so the receipt's own
		// copies are all there is — which is why this mode is never valid.
		// Both forms are tried because nothing here reveals the anchor's height.
		asAnchor := receiptAsAnchor(receipt)
		signVersion := ""
		if receipt.ChainID != "" && signatureOver(asAnchor, creatorPublicKeyHex, receipt.ChainID, "v2") {
			checks.PqcSignature = true
			signVersion = "v2"
		} else if signatureOver(asAnchor, creatorPublicKeyHex, "", "v1") {
			checks.PqcSignature = true
			signVersion = "v1"
		}
		_ = signVersion
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
	checks.BatchStateRoot = onChainRoot != "" && onChainRoot == receipt.StateRoot &&
		onChainRoot == receipt.BatchStateRoot
	if !checks.BatchStateRoot {
		return fail("the chain's batch does not carry the receipt's state root (StateRoot and BatchStateRoot)")
	}

	// 3. An anchor matching this receipt must actually exist on chain, and agree
	//    with it on every anchor field the receipt states. The matched anchor,
	//    not the receipt, is what step 6 verifies and what is returned.
	anchors, err := rest.GetAnchors(ctx, receipt.LayerID)
	if err != nil {
		return fail("could not read anchors for layer %q: %v", receipt.LayerID, err)
	}
	var matched *AnchorView
	for i := range anchors {
		a := anchors[i]
		if a.StateRoot == receipt.StateRoot &&
			a.LayerHeight == receipt.LayerHeight &&
			a.PqcSignature == receipt.PqcSignature {
			matched = &a
			break
		}
	}
	if matched == nil {
		return fail("no anchor on chain matches this receipt — it is fabricated or superseded")
	}
	failAt := func(format string, args ...any) ReceiptVerification {
		v := fail(format, args...)
		v.Anchor = matched
		return v
	}
	if mismatch := anchorFieldMismatch(receipt, *matched); mismatch != "" {
		return failAt("%s", mismatch)
	}
	checks.AnchorOnChain = true

	// 4. The signing key is resolved from the chain, never taken from the receipt.
	account, err := rest.GetPqcAccount(ctx, rollup.Creator)
	if err != nil {
		return failAt("could not resolve the creator's post-quantum key: %v", err)
	}
	if receipt.Creator != rollup.Creator {
		return failAt("receipt names creator %q but the chain says the rollup's creator is %q", receipt.Creator, rollup.Creator)
	}
	checks.CreatorAuthority = account.PublicKey != ""
	if !checks.CreatorAuthority {
		return failAt("no post-quantum key is registered for creator %s", rollup.Creator)
	}

	// 5. The receipt must name the chain we actually queried. A version-1
	// receipt carries no chain id; it still verifies, because step 3 already
	// required the anchor to exist on this chain, but the binding is the chain
	// read rather than the receipt's own word.
	chainID := client.Network.ChainID
	if receipt.ChainID != "" && receipt.ChainID != chainID {
		return failAt("receipt is for chain %q but this client is connected to %q — verify it against a node for its own network",
			receipt.ChainID, chainID)
	}
	checks.ChainBinding = true

	// 6. Finally the post-quantum signature, over the form the chain had in
	// force at the height this anchor was recorded at.
	version := AnchorSignBytesVersionFor(matched.MainChainHeight, client.Network.AnchorSignV2Height)
	checks.PqcSignature = signatureOver(*matched, account.PublicKey, chainID, version)
	if !checks.PqcSignature {
		return ReceiptVerification{
			Valid:            false,
			Mode:             ReceiptModeChain,
			Checks:           checks,
			SignBytesVersion: version,
			Anchor:           matched,
			Reason: fmt.Sprintf(
				"Dilithium-5 anchor signature did not verify against the creator's registered key (checked as %s, for an anchor at height %d)",
				version, matched.MainChainHeight),
		}
	}
	verified := receiptFromParts(receipt.RollupID, rollup.LayerID, receipt.BatchIndex, rollup.Creator,
		*matched, receipt.BatchStateRoot, chainID)
	return ReceiptVerification{
		Valid:            true,
		Mode:             ReceiptModeChain,
		Checks:           checks,
		SignBytesVersion: version,
		Anchor:           matched,
		VerifiedReceipt:  &verified,
	}
}
