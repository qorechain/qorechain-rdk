package rdk

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// HTTPDoer is the minimal HTTP capability the clients depend on. *http.Client
// satisfies it; tests can inject an httptest-backed client or a custom
// implementation.
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// --- typed views ---

// ParamsView holds the rdk module parameters.
type ParamsView struct {
	MaxRollups             int
	MinStakeForRollup      string
	RollupCreationBurnRate string
	DefaultChallengeWindow int
	MaxDaBlobSize          int
	BlobRetentionBlocks    int
	MaxBatchesPerBlock     int

	// Chain v3.2.8+ (effective values; nil from an older node).
	FinalizedBatchRetentionBlocks *uint64
	MaxPostedDataBytes            *uint64
	MaxPostedDataBytesPerBlock    *uint64
	PostedDataFeePerByte          *uint64
	PostedDataRetentionBlocks     *uint64
	// MinSubmitterBond is the bond a qledger-v1 batch submitter must hold, in
	// uqor (chain v3.2.8+); "" from an older node.
	MinSubmitterBond string
}

// RollupView holds a rollup's configuration and status.
type RollupView struct {
	RollupID       string
	Creator        string
	Profile        string
	SettlementMode string
	DABackend      string
	BlockTimeMs    int
	MaxTxPerBlock  int
	VmType         string
	Status         string
	StakeAmount    string
	LayerID        string
	CreatedHeight  int
	// EscrowBalance is what the rollup still holds in the pooled module escrow,
	// in uqor (chain v3.2.3+). "0" from an older node.
	EscrowBalance string
	// ChallengeWindowSec is the rollup's own challenge window in seconds (chain
	// v3.2.4+), or nil from a node that does not expose it. The window is per
	// rollup, so the global default_challenge_window param is only a fallback.
	ChallengeWindowSec *uint64
	// ChallengeBond is the rollup's challenge bond in uqor (chain v3.2.4+).
	ChallengeBond string
	// ProofSystem is the rollup's proof system, e.g. "fraud" (chain v3.2.4+).
	ProofSystem string
	// HasVerificationKey reports whether the rollup has a ZK verification key
	// registered (chain v3.2.7+, MsgSetVerificationKey). It is true only when
	// the node serves the field as true; absent means none, and every zk batch
	// is then refused.
	HasVerificationKey bool
	// Sequencing is "based" or "" (the rollup's sequencer settles), chain
	// v3.2.8+.
	Sequencing string
	// ExecutionVm is "qledger-v1" or "", chain v3.2.8+.
	ExecutionVm string
	// Privacy is "encapsulated" or "", chain v3.2.8+.
	Privacy string
	// Members are a private rollup's members, in envelope order (chain v3.2.8+).
	Members []string
	// MembersEpoch is the membership epoch an envelope must carry (chain
	// v3.2.8+).
	MembersEpoch uint64
	// DepositPool is the uqor deposited into a qledger-v1 rollup and not
	// withdrawn (chain v3.2.8+); "0" when there is none.
	DepositPool string
}

// BatchView holds a settlement batch.
type BatchView struct {
	RollupID      string
	BatchIndex    int
	StateRoot     string
	PrevStateRoot string
	TxCount       int
	DataHash      string
	ProofType     string
	Status        string
	// SubmittedAt is the BLOCK HEIGHT the batch was submitted at — not a
	// timestamp. Releases before 0.6.0 treated it as one, which broke every
	// challenge deadline the health monitor computed.
	SubmittedAt     int
	FinalizedAt     int
	WithdrawalsRoot string
	// SubmittedTime is the submission block's time (Unix seconds) for a batch
	// under the chain's time-based challenge window (v3.2.4). Zero for every
	// earlier batch, which keeps the block-count window.
	SubmittedTime int64
	// WithdrawalsBound reports the chain's v2 transition binding (v3.2.5,
	// rdk-withdrawals-binding) for this batch. It is true only when the node
	// serves the field as true; TransitionRootVersionForBatch otherwise decides
	// by height.
	WithdrawalsBound bool
	// InboxStart and InboxEnd are the inbox range a based rollup's batch
	// consumed: the posts after InboxStart, up to InboxEnd (chain v3.2.8+).
	InboxStart uint64
	InboxEnd   uint64
	// WithdrawalsRootReduced reports that the stored WithdrawalsRoot is the
	// submitted root reduced modulo the BLS12-381 scalar field (chain v3.2.8+:
	// a Groth16 batch that binds its withdrawals, settled with
	// rdk-zk-canonical-inputs on). Compare a tree root with it modulo r
	// (WithdrawalsRootMatches), not byte for byte.
	WithdrawalsRootReduced bool
}

// InboxView is a rollup's inbox (chain v3.2.8+). Hex fields are as the node
// serves them.
type InboxView struct {
	RollupID   string
	Sequencing string
	// HeadSequence is the sequence of the last post (0 = none yet).
	HeadSequence uint64
	HeadAcc      string
	// ConsumedSequence is where the next based batch starts.
	ConsumedSequence uint64
	ConsumedAcc      string
	// RangeEnd is the range end RangeDataHash is for.
	RangeEnd uint64
	// RangeDataHash is the data_hash a based batch with InboxEnd = RangeEnd
	// must carry; empty when no longer retained.
	RangeDataHash string
}

// PostedDataView is one posted-data commitment (chain v3.2.8+).
type PostedDataView struct {
	RollupID string
	Sequence uint64
	// DataHash is SHA-256 of the payload.
	DataHash string
	Size     uint64
	Poster   string
	// Height is the block whose transaction carries the payload.
	Height          uint64
	InboxAcc        string
	ExpiresAtHeight uint64
}

// SubmitterBondView is a submitter's bond on a qledger-v1 rollup (chain
// v3.2.8+).
type SubmitterBondView struct {
	// Amount is in uqor; "0" when there is none.
	Amount         string
	LastSubmitTime int64
	// UnbondAfter is the block time (Unix seconds) from which an unbond
	// succeeds.
	UnbondAfter int64
	// Pending is the number of the submitter's batches on the rollup still
	// waiting for finality (chain v3.2.8+; at most 1,024).
	Pending uint64
}

// KemKeyView is a key-encapsulation key an address published (x/pqc, chain
// v3.2.5+).
type KemKeyView struct {
	Address       string
	AlgorithmID   int
	AlgorithmName string
	// PublicKey is the FIPS 203 encapsulation key, lowercase hex.
	PublicKey        string
	RegisteredHeight uint64
}

// AnchorView holds a subsidiary-layer state anchor committed to the Main Chain
// (the x/multilayer StateAnchorView). Byte fields are normalized to lowercase
// hex. The PQC (Dilithium-5) signature covers the canonical message
// layer_id || layer_height(8B BE) || state_root || validator_set_hash, signed by
// the layer creator's registered post-quantum key.
type AnchorView struct {
	LayerID              string
	LayerHeight          uint64
	StateRoot            string
	ValidatorSetHash     string
	MainChainHeight      uint64
	AnchoredAt           int64
	PqcSignature         string
	TransactionCount     uint64
	CompressedStateProof string
}

// PqcAccountView holds a post-quantum account view (the x/pqc PQCAccountView).
type PqcAccountView struct {
	Address       string
	PublicKey     string
	AlgorithmID   int
	AlgorithmName string
	EcdsaPubkey   string
}

func pick(raw map[string]any, keys ...string) any {
	for _, k := range keys {
		if v, ok := raw[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

func asStr(v any, fallback string) string {
	if v == nil {
		return fallback
	}
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func asNum(v any, fallback int) int {
	switch t := v.(type) {
	case nil:
		return fallback
	case float64:
		return int(t)
	case string:
		if t == "" {
			return fallback
		}
		if n, err := strconv.ParseFloat(t, 64); err == nil {
			return int(n)
		}
		return fallback
	default:
		return fallback
	}
}

func asRecord(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func asArray(v any) []map[string]any {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(arr))
	for _, item := range arr {
		out = append(out, asRecord(item))
	}
	return out
}

// MapParamsView maps a raw params payload to a ParamsView.
func MapParamsView(raw map[string]any) ParamsView {
	return ParamsView{
		MaxRollups:             asNum(pick(raw, "max_rollups", "maxRollups"), 0),
		MinStakeForRollup:      asStr(pick(raw, "min_stake_for_rollup", "minStakeForRollup"), "0"),
		RollupCreationBurnRate: asStr(pick(raw, "rollup_creation_burn_rate", "rollupCreationBurnRate"), "0"),
		DefaultChallengeWindow: asNum(pick(raw, "default_challenge_window", "defaultChallengeWindow"), 0),
		MaxDaBlobSize:          asNum(pick(raw, "max_da_blob_size", "maxDaBlobSize"), 0),
		BlobRetentionBlocks:    asNum(pick(raw, "blob_retention_blocks", "blobRetentionBlocks"), 0),
		MaxBatchesPerBlock:     asNum(pick(raw, "max_batches_per_block", "maxBatchesPerBlock"), 0),

		FinalizedBatchRetentionBlocks: optionalU64(pick(raw, "finalized_batch_retention_blocks", "finalizedBatchRetentionBlocks")),
		MaxPostedDataBytes:            optionalU64(pick(raw, "max_posted_data_bytes", "maxPostedDataBytes")),
		MaxPostedDataBytesPerBlock:    optionalU64(pick(raw, "max_posted_data_bytes_per_block", "maxPostedDataBytesPerBlock")),
		PostedDataFeePerByte:          optionalU64(pick(raw, "posted_data_fee_per_byte", "postedDataFeePerByte")),
		PostedDataRetentionBlocks:     optionalU64(pick(raw, "posted_data_retention_blocks", "postedDataRetentionBlocks")),
		MinSubmitterBond:              asStr(pick(raw, "min_submitter_bond", "minSubmitterBond"), ""),
	}
}

// MapInboxView maps a raw inbox payload to an InboxView.
func MapInboxView(raw map[string]any) InboxView {
	return InboxView{
		RollupID:         asStr(pick(raw, "rollup_id", "rollupId"), ""),
		Sequencing:       asStr(pick(raw, "sequencing"), ""),
		HeadSequence:     asU64(pick(raw, "head_sequence", "headSequence"), 0),
		HeadAcc:          asStr(pick(raw, "head_acc", "headAcc"), ""),
		ConsumedSequence: asU64(pick(raw, "consumed_sequence", "consumedSequence"), 0),
		ConsumedAcc:      asStr(pick(raw, "consumed_acc", "consumedAcc"), ""),
		RangeEnd:         asU64(pick(raw, "range_end", "rangeEnd"), 0),
		RangeDataHash:    asStr(pick(raw, "range_data_hash", "rangeDataHash"), ""),
	}
}

// MapPostedDataView maps a raw posted-data payload to a PostedDataView.
func MapPostedDataView(raw map[string]any) PostedDataView {
	return PostedDataView{
		RollupID:        asStr(pick(raw, "rollup_id", "rollupId"), ""),
		Sequence:        asU64(pick(raw, "sequence"), 0),
		DataHash:        asStr(pick(raw, "data_hash", "dataHash"), ""),
		Size:            asU64(pick(raw, "size"), 0),
		Poster:          asStr(pick(raw, "poster"), ""),
		Height:          asU64(pick(raw, "height"), 0),
		InboxAcc:        asStr(pick(raw, "inbox_acc", "inboxAcc"), ""),
		ExpiresAtHeight: asU64(pick(raw, "expires_at_height", "expiresAtHeight"), 0),
	}
}

// MapSubmitterBondView maps a raw submitter-bond payload to a
// SubmitterBondView.
func MapSubmitterBondView(raw map[string]any) SubmitterBondView {
	return SubmitterBondView{
		Amount:         asStr(pick(raw, "amount"), "0"),
		LastSubmitTime: asI64(pick(raw, "last_submit_time", "lastSubmitTime"), 0),
		UnbondAfter:    asI64(pick(raw, "unbond_after", "unbondAfter"), 0),
		Pending:        asU64(pick(raw, "pending"), 0),
	}
}

// MapKemKeyView maps a raw KEM key payload to a KemKeyView, normalizing the
// key to lowercase hex.
func MapKemKeyView(raw map[string]any) KemKeyView {
	return KemKeyView{
		Address:          asStr(pick(raw, "address"), ""),
		AlgorithmID:      asNum(pick(raw, "algorithm_id", "algorithmId"), 0),
		AlgorithmName:    asStr(pick(raw, "algorithm_name", "algorithmName"), ""),
		PublicKey:        hexWireBytes(asStr(pick(raw, "public_key", "publicKey"), "")),
		RegisteredHeight: asU64(pick(raw, "registered_height", "registeredHeight"), 0),
	}
}

// MapRollupView maps a raw rollup payload to a RollupView.
func MapRollupView(raw map[string]any) RollupView {
	return RollupView{
		RollupID:       asStr(pick(raw, "rollup_id", "rollupId"), ""),
		Creator:        asStr(pick(raw, "creator"), ""),
		Profile:        asStr(pick(raw, "profile"), ""),
		SettlementMode: asStr(pick(raw, "settlement_mode", "settlementMode"), ""),
		DABackend:      asStr(pick(raw, "da_backend", "daBackend"), ""),
		BlockTimeMs:    asNum(pick(raw, "block_time_ms", "blockTimeMs"), 0),
		MaxTxPerBlock:  asNum(pick(raw, "max_tx_per_block", "maxTxPerBlock"), 0),
		VmType:         asStr(pick(raw, "vm_type", "vmType"), ""),
		Status:         asStr(pick(raw, "status"), ""),
		StakeAmount:    asStr(pick(raw, "stake_amount", "stakeAmount"), "0"),
		LayerID:        asStr(pick(raw, "layer_id", "layerId"), ""),
		CreatedHeight:  asNum(pick(raw, "created_height", "createdHeight"), 0),

		EscrowBalance:      asStr(pick(raw, "escrow_balance", "escrowBalance"), "0"),
		ChallengeWindowSec: optionalU64(pick(raw, "challenge_window_sec", "challengeWindowSec")),
		ChallengeBond:      asStr(pick(raw, "challenge_bond", "challengeBond"), ""),
		ProofSystem:        asStr(pick(raw, "proof_system", "proofSystem"), ""),
		HasVerificationKey: pick(raw, "has_verification_key", "hasVerificationKey") == true,

		Sequencing:   asStr(pick(raw, "sequencing"), ""),
		ExecutionVm:  asStr(pick(raw, "execution_vm", "executionVm"), ""),
		Privacy:      asStr(pick(raw, "privacy"), ""),
		Members:      asStringList(pick(raw, "members")),
		MembersEpoch: asU64(pick(raw, "members_epoch", "membersEpoch"), 0),
		DepositPool:  asStr(pick(raw, "deposit_pool", "depositPool"), "0"),
	}
}

// asStringList reads a JSON array as strings; anything else is empty.
func asStringList(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return []string{}
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		out = append(out, asStr(item, ""))
	}
	return out
}

// optionalU64 is nil when the node did not send the field.
func optionalU64(v any) *uint64 {
	if v == nil {
		return nil
	}
	if s, ok := v.(string); ok && s == "" {
		return nil
	}
	n := asU64(v, 0)
	return &n
}

// MapBatchView maps a raw batch payload to a BatchView.
func MapBatchView(raw map[string]any) BatchView {
	return BatchView{
		RollupID:        asStr(pick(raw, "rollup_id", "rollupId"), ""),
		BatchIndex:      asNum(pick(raw, "batch_index", "batchIndex"), 0),
		StateRoot:       asStr(pick(raw, "state_root", "stateRoot"), ""),
		PrevStateRoot:   asStr(pick(raw, "prev_state_root", "prevStateRoot"), ""),
		TxCount:         asNum(pick(raw, "tx_count", "txCount"), 0),
		DataHash:        asStr(pick(raw, "data_hash", "dataHash"), ""),
		ProofType:       asStr(pick(raw, "proof_type", "proofType"), ""),
		Status:          asStr(pick(raw, "status"), ""),
		SubmittedAt:     asNum(pick(raw, "submitted_at", "submittedAt"), 0),
		FinalizedAt:     asNum(pick(raw, "finalized_at", "finalizedAt"), 0),
		WithdrawalsRoot: asStr(pick(raw, "withdrawals_root", "withdrawalsRoot"), ""),
		SubmittedTime:   int64(asU64(pick(raw, "submitted_time", "submittedTime"), 0)),

		WithdrawalsBound: pick(raw, "withdrawals_bound", "withdrawalsBound") == true,

		InboxStart: asU64(pick(raw, "inbox_start", "inboxStart"), 0),
		InboxEnd:   asU64(pick(raw, "inbox_end", "inboxEnd"), 0),

		WithdrawalsRootReduced: pick(raw, "withdrawals_root_reduced", "withdrawalsRootReduced") == true,
	}
}

func asU64(v any, fallback uint64) uint64 {
	switch t := v.(type) {
	case nil:
		return fallback
	case float64:
		return uint64(t)
	case string:
		if t == "" {
			return fallback
		}
		if n, err := strconv.ParseUint(t, 10, 64); err == nil {
			return n
		}
		return fallback
	default:
		return fallback
	}
}

func asI64(v any, fallback int64) int64 {
	switch t := v.(type) {
	case nil:
		return fallback
	case float64:
		return int64(t)
	case string:
		if t == "" {
			return fallback
		}
		if n, err := strconv.ParseInt(t, 10, 64); err == nil {
			return n
		}
		return fallback
	default:
		return fallback
	}
}

// MapAnchorView maps a raw anchor payload to an AnchorView, normalizing wire
// bytes (base64 or hex) to lowercase hex.
func MapAnchorView(raw map[string]any) AnchorView {
	return AnchorView{
		LayerID:              asStr(pick(raw, "layer_id", "layerId"), ""),
		LayerHeight:          asU64(pick(raw, "layer_height", "layerHeight"), 0),
		StateRoot:            hexWireBytes(asStr(pick(raw, "state_root", "stateRoot"), "")),
		ValidatorSetHash:     hexWireBytes(asStr(pick(raw, "validator_set_hash", "validatorSetHash"), "")),
		MainChainHeight:      asU64(pick(raw, "main_chain_height", "mainChainHeight"), 0),
		AnchoredAt:           asI64(pick(raw, "anchored_at", "anchoredAt"), 0),
		PqcSignature:         hexWireBytes(asStr(pick(raw, "pqc_aggregate_signature", "pqcAggregateSignature"), "")),
		TransactionCount:     asU64(pick(raw, "transaction_count", "transactionCount"), 0),
		CompressedStateProof: hexWireBytes(asStr(pick(raw, "compressed_state_proof", "compressedStateProof"), "")),
	}
}

// MapPqcAccountView maps a raw pqc account payload to a PqcAccountView.
func MapPqcAccountView(raw map[string]any) PqcAccountView {
	return PqcAccountView{
		Address:       asStr(pick(raw, "address"), ""),
		PublicKey:     hexWireBytes(asStr(pick(raw, "public_key", "publicKey"), "")),
		AlgorithmID:   asNum(pick(raw, "algorithm_id", "algorithmId"), 0),
		AlgorithmName: asStr(pick(raw, "algorithm_name", "algorithmName"), ""),
		EcdsaPubkey:   hexWireBytes(asStr(pick(raw, "ecdsa_pubkey", "ecdsaPubkey"), "")),
	}
}

// --- REST client ---

// RestClient is a typed read client over the rdk REST (LCD) routes.
type RestClient struct {
	base string
	http HTTPDoer
}

// NewRestClient creates a REST client. A nil doer uses http.DefaultClient.
func NewRestClient(baseURL string, doer HTTPDoer) *RestClient {
	if doer == nil {
		doer = http.DefaultClient
	}
	return &RestClient{base: strings.TrimRight(baseURL, "/"), http: doer}
}

// BaseURL returns the REST (LCD) base URL, without a trailing slash.
func (c *RestClient) BaseURL() string {
	return c.base
}

// ProtocolFeature is one protocol switch as the chain reports it.
type ProtocolFeature struct {
	Name    string
	Enabled bool
}

// GetProtocolFeatures reads the chain's protocol switches
// (/qorechain/pqc/v1/protocol_features). Chains before the route existed
// answer 404 or 501, which is returned as an error; see
// IsProtocolFeatureEnabled.
func (c *RestClient) GetProtocolFeatures(ctx context.Context) ([]ProtocolFeature, error) {
	body, err := c.get(ctx, "/qorechain/pqc/v1/protocol_features")
	if err != nil {
		return nil, err
	}
	list, _ := body["features"].([]any)
	out := make([]ProtocolFeature, 0, len(list))
	for _, f := range list {
		r := asRecord(f)
		out = append(out, ProtocolFeature{Name: asStr(r["name"], ""), Enabled: r["enabled"] == true})
	}
	return out, nil
}

// IsProtocolFeatureEnabled reports whether the chain has feature name
// enabled. A chain that does not serve the feature route has none of its
// features, so an unavailable route (404/501) reads as false; other errors are
// returned.
func (c *RestClient) IsProtocolFeatureEnabled(ctx context.Context, name string) (bool, error) {
	features, err := c.GetProtocolFeatures(ctx)
	if err != nil {
		if msg := err.Error(); strings.Contains(msg, " failed: 404") || strings.Contains(msg, " failed: 501") {
			return false, nil
		}
		return false, err
	}
	for _, f := range features {
		if f.Name == name && f.Enabled {
			return true, nil
		}
	}
	return false, nil
}

// GetAppliedPlanHeight returns the height at which upgrade plan name was
// applied on this chain (/cosmos/upgrade/v1beta1/applied_plan/{name}), or 0 if
// it has not been.
func (c *RestClient) GetAppliedPlanHeight(ctx context.Context, name string) (int64, error) {
	body, err := c.get(ctx, "/cosmos/upgrade/v1beta1/applied_plan/"+url.PathEscape(name))
	if err != nil {
		return 0, err
	}
	return int64(asU64(body["height"], 0)), nil
}

func (c *RestClient) get(ctx context.Context, path string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("REST GET %s failed: %d %s", path, res.StatusCode, http.StatusText(res.StatusCode))
	}
	var parsed any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, err
	}
	return asRecord(parsed), nil
}

// GetParams reads the live module parameters.
func (c *RestClient) GetParams(ctx context.Context) (ParamsView, error) {
	body, err := c.get(ctx, "/qorechain/rdk/v1/params")
	if err != nil {
		return ParamsView{}, err
	}
	if p := pick(body, "params"); p != nil {
		return MapParamsView(asRecord(p)), nil
	}
	return MapParamsView(body), nil
}

// GetRollup reads a single rollup's configuration and status.
func (c *RestClient) GetRollup(ctx context.Context, rollupID string) (RollupView, error) {
	body, err := c.get(ctx, "/qorechain/rdk/v1/rollup/"+url.PathEscape(rollupID))
	if err != nil {
		return RollupView{}, err
	}
	if r := pick(body, "rollup"); r != nil {
		return MapRollupView(asRecord(r)), nil
	}
	return MapRollupView(body), nil
}

// ListRollups reads all registered rollups.
func (c *RestClient) ListRollups(ctx context.Context) ([]RollupView, error) {
	body, err := c.get(ctx, "/qorechain/rdk/v1/rollups")
	if err != nil {
		return nil, err
	}
	out := []RollupView{}
	for _, r := range asArray(pick(body, "rollups")) {
		out = append(out, MapRollupView(r))
	}
	return out, nil
}

// GetBatch reads a settlement batch by index.
func (c *RestClient) GetBatch(ctx context.Context, rollupID string, batchIndex uint64) (BatchView, error) {
	body, err := c.get(ctx, fmt.Sprintf("/qorechain/rdk/v1/batch/%s/%d", url.PathEscape(rollupID), batchIndex))
	if err != nil {
		return BatchView{}, err
	}
	if b := pick(body, "batch"); b != nil {
		return MapBatchView(asRecord(b)), nil
	}
	return MapBatchView(body), nil
}

// ListBatchesPage reads one page of a rollup's batches, in index order, from
// startIndex. The chain returns at most limit (0 means 50, capped at 100) and a
// next index that is 0 when there is no further page.
func (c *RestClient) ListBatchesPage(ctx context.Context, rollupID string, startIndex uint64, limit uint32) ([]BatchView, uint64, error) {
	q := url.Values{}
	if startIndex > 0 {
		q.Set("start_index", strconv.FormatUint(startIndex, 10))
	}
	if limit > 0 {
		q.Set("limit", strconv.FormatUint(uint64(limit), 10))
	}
	path := "/qorechain/rdk/v1/batches/" + url.PathEscape(rollupID)
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	body, err := c.get(ctx, path)
	if err != nil {
		return nil, 0, err
	}
	out := []BatchView{}
	for _, b := range asArray(pick(body, "batches")) {
		out = append(out, MapBatchView(b))
	}
	return out, asU64(pick(body, "next_index", "nextIndex"), 0), nil
}

// ListBatches reads all settlement batches for a rollup, following every page.
//
// The chain's Batches query is paged (50 per page by default). Releases before
// 0.6.0 read only the first page, so nothing past batch #49 was ever returned.
func (c *RestClient) ListBatches(ctx context.Context, rollupID string) ([]BatchView, error) {
	return c.ListBatchesFrom(ctx, rollupID, 0)
}

// ListBatchesFrom reads every batch from startIndex onwards, following pages.
func (c *RestClient) ListBatchesFrom(ctx context.Context, rollupID string, startIndex uint64) ([]BatchView, error) {
	out := []BatchView{}
	start := startIndex
	for pages := 0; pages < 100_000; pages++ { // bounded against a misbehaving node
		page, next, err := c.ListBatchesPage(ctx, rollupID, start, 100)
		if err != nil {
			return nil, err
		}
		out = append(out, page...)
		if next == 0 || len(page) == 0 {
			break
		}
		start = next
	}
	return out, nil
}

// GetLatestBatch reads the latest settlement batch for a rollup (the chain's
// LatestBatch query).
//
// Releases before 0.6.0 requested /batches/{id}?latest=true, which is not a
// chain route: the node returned the first page of the list, which was then
// read as one empty batch — so health reported "no batches yet" for every
// rollup.
func (c *RestClient) GetLatestBatch(ctx context.Context, rollupID string) (BatchView, error) {
	body, err := c.get(ctx, "/qorechain/rdk/v1/latest_batch/"+url.PathEscape(rollupID))
	if err != nil {
		return BatchView{}, err
	}
	if b := pick(body, "batch"); b != nil {
		return MapBatchView(asRecord(b)), nil
	}
	return MapBatchView(body), nil
}

// GetInbox reads a rollup's inbox (chain v3.2.8+): head, consumed position,
// and the data_hash a based batch ending at inboxEnd must carry (0 = the head).
func (c *RestClient) GetInbox(ctx context.Context, rollupID string, inboxEnd uint64) (InboxView, error) {
	path := "/qorechain/rdk/v1/inbox/" + url.PathEscape(rollupID)
	if inboxEnd > 0 {
		path += "?inbox_end=" + strconv.FormatUint(inboxEnd, 10)
	}
	body, err := c.get(ctx, path)
	if err != nil {
		return InboxView{}, err
	}
	if r := pick(body, "inbox"); r != nil {
		return MapInboxView(asRecord(r)), nil
	}
	return MapInboxView(body), nil
}

// GetPostedData reads one posted-data commitment (chain v3.2.8+). The payload
// is in the transaction at its Height.
func (c *RestClient) GetPostedData(ctx context.Context, rollupID string, sequence uint64) (PostedDataView, error) {
	body, err := c.get(ctx, fmt.Sprintf("/qorechain/rdk/v1/posted_data/%s/%d", url.PathEscape(rollupID), sequence))
	if err != nil {
		return PostedDataView{}, err
	}
	if r := pick(body, "posted_data", "postedData"); r != nil {
		return MapPostedDataView(asRecord(r)), nil
	}
	return MapPostedDataView(body), nil
}

// GetSubmitterBond reads a submitter's bond on a qledger-v1 rollup and when it
// unlocks (chain v3.2.8+).
func (c *RestClient) GetSubmitterBond(ctx context.Context, rollupID, submitter string) (SubmitterBondView, error) {
	body, err := c.get(ctx, "/qorechain/rdk/v1/submitter_bond/"+url.PathEscape(rollupID)+"/"+url.PathEscape(submitter))
	if err != nil {
		return SubmitterBondView{}, err
	}
	return MapSubmitterBondView(body), nil
}

// GetKemKey reads the key-encapsulation key address published (chain
// v3.2.5+). It returns nil when the address has none.
func (c *RestClient) GetKemKey(ctx context.Context, address string) (*KemKeyView, error) {
	body, err := c.get(ctx, "/qorechain/pqc/v1/kem/"+url.PathEscape(address))
	if err != nil {
		return nil, err
	}
	if body["found"] != true {
		return nil, nil
	}
	view := MapKemKeyView(asRecord(body["key"]))
	return &view, nil
}

// PrivateRollupRecipients are the recipients a post on a private rollup must
// be sealed to, and the membership epoch to seal at.
type PrivateRollupRecipients struct {
	Epoch      uint64
	Recipients []EnvelopeRecipient
}

// GetPrivateRollupRecipients reads a private rollup's members, in order, each
// with its registered ML-KEM-1024 key, and the membership epoch: what
// SealEnvelope needs. It errors when the rollup is not private, has no members,
// or a member has no ML-KEM-1024 key (the chain would refuse any envelope).
func (c *RestClient) GetPrivateRollupRecipients(ctx context.Context, rollupID string) (PrivateRollupRecipients, error) {
	rollup, err := c.GetRollup(ctx, rollupID)
	if err != nil {
		return PrivateRollupRecipients{}, err
	}
	if rollup.Privacy != string(PrivacyEncapsulated) {
		return PrivateRollupRecipients{}, fmt.Errorf("rollup %s is not private", rollupID)
	}
	if len(rollup.Members) == 0 {
		return PrivateRollupRecipients{}, fmt.Errorf("rollup %s has no members yet", rollupID)
	}
	out := PrivateRollupRecipients{Epoch: rollup.MembersEpoch}
	for _, member := range rollup.Members {
		key, err := c.GetKemKey(ctx, member)
		if err != nil {
			return PrivateRollupRecipients{}, err
		}
		if key == nil || key.AlgorithmID != MlKem1024AlgorithmID {
			return PrivateRollupRecipients{}, fmt.Errorf("member %s has no ML-KEM-1024 key registered", member)
		}
		ek, err := HexToBytes(key.PublicKey)
		if err != nil {
			return PrivateRollupRecipients{}, fmt.Errorf("member %s: %w", member, err)
		}
		out.Recipients = append(out.Recipients, EnvelopeRecipient{Member: member, EncapsulationKey: ek})
	}
	return out, nil
}

// GetBlob reads raw data-availability blob details.
func (c *RestClient) GetBlob(ctx context.Context, rollupID string, blobIndex uint64) (map[string]any, error) {
	return c.get(ctx, fmt.Sprintf("/qorechain/rdk/v1/blob/%s/%d", url.PathEscape(rollupID), blobIndex))
}

// GetAnchor reads the latest state anchor a layer committed to the Main Chain
// (the x/multilayer Anchor query). layerID is the rollup's layer_id.
func (c *RestClient) GetAnchor(ctx context.Context, layerID string) (AnchorView, error) {
	body, err := c.get(ctx, "/qorechain/multilayer/v1/anchor/"+url.PathEscape(layerID))
	if err != nil {
		return AnchorView{}, err
	}
	if a := pick(body, "anchor"); a != nil {
		return MapAnchorView(asRecord(a)), nil
	}
	return MapAnchorView(body), nil
}

// GetLatestAnchor is an alias for GetAnchor — the chain's Anchor query returns
// the latest anchor.
func (c *RestClient) GetLatestAnchor(ctx context.Context, layerID string) (AnchorView, error) {
	return c.GetAnchor(ctx, layerID)
}

// GetAnchors reads all state anchors a layer has committed (newest first).
func (c *RestClient) GetAnchors(ctx context.Context, layerID string) ([]AnchorView, error) {
	body, err := c.get(ctx, "/qorechain/multilayer/v1/anchors/"+url.PathEscape(layerID))
	if err != nil {
		return nil, err
	}
	out := []AnchorView{}
	for _, a := range asArray(pick(body, "anchors")) {
		out = append(out, MapAnchorView(a))
	}
	return out, nil
}

// GetPqcAccount reads an account's post-quantum key record (the x/pqc account
// query). The PublicKey is the registered ML-DSA-87 (Dilithium-5) verification
// key.
func (c *RestClient) GetPqcAccount(ctx context.Context, address string) (PqcAccountView, error) {
	body, err := c.get(ctx, "/qorechain/pqc/v1/account/"+url.PathEscape(address))
	if err != nil {
		return PqcAccountView{}, err
	}
	if a := pick(body, "account"); a != nil {
		return MapPqcAccountView(asRecord(a)), nil
	}
	return MapPqcAccountView(body), nil
}

// --- QCAI advisory reads (the ai REST surface) ---

// GetFeeEstimate reads the QCAI fee estimate. urgency is one of low | normal |
// high (optional; empty to omit).
func (c *RestClient) GetFeeEstimate(ctx context.Context, urgency string) (map[string]any, error) {
	q := ""
	if urgency != "" {
		q = "?urgency=" + url.QueryEscape(urgency)
	}
	return c.get(ctx, "/qorechain/ai/v1/fee-estimate"+q)
}

// GetNetworkRecommendations reads the QCAI network recommendations (congestion,
// suggested settings).
func (c *RestClient) GetNetworkRecommendations(ctx context.Context) (map[string]any, error) {
	return c.get(ctx, "/qorechain/ai/v1/network/recommendations")
}

// GetFraudInvestigations reads the open fraud investigations across the network.
func (c *RestClient) GetFraudInvestigations(ctx context.Context) ([]map[string]any, error) {
	body, err := c.get(ctx, "/qorechain/ai/v1/fraud/investigations")
	if err != nil {
		return nil, err
	}
	if v := pick(body, "investigations", "data"); v != nil {
		return asArray(v), nil
	}
	return asArray(body), nil
}

// GetFraudInvestigation reads a single fraud investigation by id.
func (c *RestClient) GetFraudInvestigation(ctx context.Context, id string) (map[string]any, error) {
	return c.get(ctx, "/qorechain/ai/v1/fraud/investigations/"+url.PathEscape(id))
}

// GetCircuitBreakers reads the active QCAI circuit breakers (network safety
// throttles).
func (c *RestClient) GetCircuitBreakers(ctx context.Context) (map[string]any, error) {
	return c.get(ctx, "/qorechain/ai/v1/circuit-breakers")
}

// GetBalance reads an account's balance for a single denom (default uqor) as an
// integer string.
func (c *RestClient) GetBalance(ctx context.Context, address, denom string) (string, error) {
	if denom == "" {
		denom = "uqor"
	}
	body, err := c.get(ctx, fmt.Sprintf("/cosmos/bank/v1beta1/balances/%s/by_denom?denom=%s",
		url.PathEscape(address), url.QueryEscape(denom)))
	if err != nil {
		return "", err
	}
	balance := asRecord(pick(body, "balance"))
	return asStr(pick(balance, "amount"), "0"), nil
}

// Balance is an account balance for a single denom.
type Balance struct {
	Denom  string
	Amount string
}

// GetAllBalances reads all of an account's balances.
func (c *RestClient) GetAllBalances(ctx context.Context, address string) ([]Balance, error) {
	body, err := c.get(ctx, "/cosmos/bank/v1beta1/balances/"+url.PathEscape(address))
	if err != nil {
		return nil, err
	}
	out := []Balance{}
	for _, b := range asArray(pick(body, "balances")) {
		out = append(out, Balance{Denom: asStr(pick(b, "denom"), ""), Amount: asStr(pick(b, "amount"), "0")})
	}
	return out, nil
}

// GetTx reads a transaction by hash (the raw response).
func (c *RestClient) GetTx(ctx context.Context, hash string) (map[string]any, error) {
	return c.get(ctx, "/cosmos/tx/v1beta1/txs/"+url.PathEscape(hash))
}

// GetLatestHeight reads the node's latest block height
// (/cosmos/base/node/v1beta1/status).
func (c *RestClient) GetLatestHeight(ctx context.Context) (uint64, error) {
	body, err := c.get(ctx, "/cosmos/base/node/v1beta1/status")
	if err != nil {
		return 0, err
	}
	h := asU64(pick(body, "height"), 0)
	if h == 0 {
		return 0, fmt.Errorf("the node did not report its height")
	}
	return h, nil
}

// SearchTxsOptions configures SearchTxs.
type SearchTxsOptions struct {
	// PageLimit is the page size (default 100).
	PageLimit int
	// MaxPages bounds the pages read (default 50).
	MaxPages int
}

// SearchTxs reads every transaction matching an event query (for example
// rdk_data_posted.rollup_id='my-rollup'), as raw tx_responses, oldest first.
// Needs a node with transaction indexing on.
func (c *RestClient) SearchTxs(ctx context.Context, query string, opts ...SearchTxsOptions) ([]map[string]any, error) {
	limit, maxPages := 100, 50
	if len(opts) > 0 {
		if opts[0].PageLimit > 0 {
			limit = opts[0].PageLimit
		}
		if opts[0].MaxPages > 0 {
			maxPages = opts[0].MaxPages
		}
	}
	out := []map[string]any{}
	for page := 1; page <= maxPages; page++ {
		body, err := c.get(ctx, fmt.Sprintf("/cosmos/tx/v1beta1/txs?query=%s&page=%d&limit=%d&order_by=ORDER_BY_ASC",
			url.QueryEscape(query), page, limit))
		if err != nil {
			return nil, err
		}
		txs := asArray(pick(body, "tx_responses", "txResponses"))
		out = append(out, txs...)
		total := asU64(pick(body, "total"), 0)
		if len(txs) < limit || (total > 0 && uint64(len(out)) >= total) {
			break
		}
	}
	return out, nil
}

// BroadcastTxBytes broadcasts TxRaw bytes via the REST txs endpoint in
// BROADCAST_MODE_SYNC and returns the raw response.
func (c *RestClient) BroadcastTxBytes(ctx context.Context, txBytes []byte) (map[string]any, error) {
	payload := map[string]any{
		"tx_bytes": base64.StdEncoding.EncodeToString(txBytes),
		"mode":     "BROADCAST_MODE_SYNC",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/cosmos/tx/v1beta1/txs", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	respBody, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("broadcast failed: %d %s", res.StatusCode, http.StatusText(res.StatusCode))
	}
	var parsed any
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, err
	}
	return asRecord(parsed), nil
}

// SimulateTxBytes simulates TxRaw bytes via the REST simulate endpoint and
// returns the estimated gas used (gas_info.gas_used).
func (c *RestClient) SimulateTxBytes(ctx context.Context, txBytes []byte) (uint64, error) {
	payload := map[string]any{
		"tx_bytes": base64.StdEncoding.EncodeToString(txBytes),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/cosmos/tx/v1beta1/simulate", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	respBody, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return 0, fmt.Errorf("simulate failed: %d %s", res.StatusCode, http.StatusText(res.StatusCode))
	}
	var parsed any
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return 0, err
	}
	record := asRecord(parsed)
	gasInfo := asRecord(pick(record, "gas_info", "gasInfo"))
	gasUsed := asStr(pick(gasInfo, "gas_used", "gasUsed"), "0")
	n, err := strconv.ParseUint(gasUsed, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("simulate: invalid gas_used %q: %w", gasUsed, err)
	}
	return n, nil
}

// --- qor_ JSON-RPC client ---

// QorClient calls the custom qor_ JSON-RPC namespace served at the EVM JSON-RPC
// endpoint.
type QorClient struct {
	url  string
	http HTTPDoer
	id   int
}

// NewQorClient creates a qor_ JSON-RPC client. A nil doer uses
// http.DefaultClient.
func NewQorClient(rpcURL string, doer HTTPDoer) *QorClient {
	if doer == nil {
		doer = http.DefaultClient
	}
	return &QorClient{url: rpcURL, http: doer}
}

type jsonRPCResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Call makes a raw qor_* JSON-RPC call and unmarshals the result into out.
func (c *QorClient) Call(ctx context.Context, method string, params []any, out any) error {
	c.id++
	reqBody, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": c.id, "method": method, "params": params,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("JSON-RPC %s failed: %d %s", method, res.StatusCode, http.StatusText(res.StatusCode))
	}
	var parsed jsonRPCResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return err
	}
	if parsed.Error != nil {
		return fmt.Errorf("JSON-RPC %s error %d: %s", method, parsed.Error.Code, parsed.Error.Message)
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(parsed.Result, out)
}

// GetRollupStatus returns a rollup's configuration, status, and settlement mode.
func (c *QorClient) GetRollupStatus(ctx context.Context, rollupID string) (map[string]any, error) {
	var out map[string]any
	err := c.Call(ctx, "qor_getRollupStatus", []any{rollupID}, &out)
	return out, err
}

// ListRollups returns all registered rollups with a status summary.
func (c *QorClient) ListRollups(ctx context.Context) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.Call(ctx, "qor_listRollups", []any{}, &out)
	return out, err
}

// GetSettlementBatch returns settlement batch details and finalization status.
func (c *QorClient) GetSettlementBatch(ctx context.Context, rollupID string, batchIndex uint64) (map[string]any, error) {
	var out map[string]any
	err := c.Call(ctx, "qor_getSettlementBatch", []any{rollupID, batchIndex}, &out)
	return out, err
}

// SuggestRollupProfile returns the QCAI-assisted profile recommendation for a
// use-case description as a raw value.
func (c *QorClient) SuggestRollupProfile(ctx context.Context, useCase string) (json.RawMessage, error) {
	var out json.RawMessage
	err := c.Call(ctx, "qor_suggestRollupProfile", []any{useCase}, &out)
	return out, err
}

// GetDABlobStatus returns the data-availability blob storage status.
func (c *QorClient) GetDABlobStatus(ctx context.Context, rollupID string, blobIndex uint64) (map[string]any, error) {
	var out map[string]any
	err := c.Call(ctx, "qor_getDABlobStatus", []any{rollupID, blobIndex}, &out)
	return out, err
}

// GetRLAgentStatus returns the QCAI reinforcement-learning agent status (the
// fee/routing policy agent).
func (c *QorClient) GetRLAgentStatus(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	err := c.Call(ctx, "qor_getRLAgentStatus", []any{}, &out)
	return out, err
}

// GetRLObservation returns the RL agent's current observation vector (the
// network state it acts on).
func (c *QorClient) GetRLObservation(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	err := c.Call(ctx, "qor_getRLObservation", []any{}, &out)
	return out, err
}

// GetRLReward returns the RL agent's latest reward signal.
func (c *QorClient) GetRLReward(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	err := c.Call(ctx, "qor_getRLReward", []any{}, &out)
	return out, err
}

// --- high-level RdkClient ---

// RdkClientOptions configures an RdkClient.
type RdkClientOptions struct {
	// Network preset (default "testnet").
	Network string
	// Endpoints overrides; merged onto the network preset's defaults.
	Endpoints *Endpoints
	// HTTP doer for the read clients (testing or custom environments).
	HTTP HTTPDoer
}

// RdkClient is the high-level entry point. It resolves a network and composes the
// REST and qor_ JSON-RPC read clients.
type RdkClient struct {
	// Network is the resolved network (chain id and endpoints).
	Network NetworkConfig
	// Rest is the REST (LCD) read client.
	Rest *RestClient
	// Qor is the qor_ JSON-RPC client.
	Qor *QorClient

	http HTTPDoer
}

// NewRdkClient creates an RdkClient. It defaults to the public testnet.
func NewRdkClient(options RdkClientOptions) *RdkClient {
	net := GetNetwork(options.Network)
	if options.Endpoints != nil {
		o := options.Endpoints
		if o.Rest != "" {
			net.Endpoints.Rest = o.Rest
		}
		if o.RPC != "" {
			net.Endpoints.RPC = o.RPC
		}
		if o.GRPC != "" {
			net.Endpoints.GRPC = o.GRPC
		}
		if o.EvmRPC != "" {
			net.Endpoints.EvmRPC = o.EvmRPC
		}
	}
	doer := options.HTTP
	if doer == nil {
		doer = http.DefaultClient
	}
	return &RdkClient{
		Network: net,
		Rest:    NewRestClient(net.Endpoints.Rest, options.HTTP),
		Qor:     NewQorClient(net.Endpoints.EvmRPC, options.HTTP),
		http:    doer,
	}
}

// ConnectTx returns a tx client that signs as account on this client's network
// (its chain id) and broadcasts through this client's REST client. Pass hybrid
// to sign every transaction hybrid (post-quantum), which both public networks
// require; nil signs classical-only. PqcKeypairFromEnv or ResolvePqcKeypair
// find the keypair:
//
//	resolved, err := rdk.ResolvePqcKeypair(ctx, client, account.Address, mnemonic)
//	if err != nil {
//		return err
//	}
//	opts := resolved.HybridOptions()
//	tx := client.ConnectTx(account, &opts)
func (c *RdkClient) ConnectTx(account Account, hybrid *HybridOptions) *RdkTxClient {
	tx := NewRdkTxClient(account, c.Network.ChainID, c.Rest)
	if hybrid != nil {
		return tx.WithHybrid(*hybrid)
	}
	return tx
}

// GetChainTip reads the chain tip — latest height and its block time — from the
// consensus RPC's /status. A challenge window is judged against this, not the
// local clock: the block-count path counts heights, and the time-based path
// compares block time, which can lag wall time.
func (c *RdkClient) GetChainTip(ctx context.Context) (ChainTip, error) {
	u := strings.TrimRight(c.Network.Endpoints.RPC, "/") + "/status"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return ChainTip{}, err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return ChainTip{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ChainTip{}, fmt.Errorf("could not read the chain tip from %s (HTTP %d)", u, res.StatusCode)
	}
	var body struct {
		Result struct {
			SyncInfo struct {
				LatestBlockHeight string `json:"latest_block_height"`
				LatestBlockTime   string `json:"latest_block_time"`
			} `json:"sync_info"`
		} `json:"result"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return ChainTip{}, fmt.Errorf("could not decode %s: %w", u, err)
	}
	info := body.Result.SyncInfo
	height, err := strconv.ParseInt(info.LatestBlockHeight, 10, 64)
	if err != nil {
		return ChainTip{}, fmt.Errorf("the node at %s did not report a latest block height", u)
	}
	t, err := time.Parse(time.RFC3339Nano, info.LatestBlockTime)
	if err != nil {
		return ChainTip{}, fmt.Errorf("the node at %s did not report a latest block time", u)
	}
	return ChainTip{Height: height, TimeSecs: t.Unix()}, nil
}

// Params reads the live rdk module parameters from the chain.
func (c *RdkClient) Params(ctx context.Context) (ParamsView, error) {
	return c.Rest.GetParams(ctx)
}

// --- profile suggestion ---

// ProfileSuggestion is the result of a profile suggestion.
type ProfileSuggestion struct {
	// Profile is the recommended profile.
	Profile Profile
	// Source is "advisory" when from the service, "fallback" otherwise.
	Source string
	// Raw is the raw advisory response (or error message), for transparency.
	Raw any
}

func isProfileName(v string) bool {
	return contains(Profiles, Profile(v))
}

func extractProfile(result json.RawMessage) (Profile, bool) {
	var s string
	if err := json.Unmarshal(result, &s); err == nil && isProfileName(s) {
		return Profile(s), true
	}
	var m map[string]any
	if err := json.Unmarshal(result, &m); err == nil {
		for _, k := range []string{"profile", "suggestedProfile", "suggested_profile", "recommendation"} {
			if v, ok := m[k].(string); ok && isProfileName(v) {
				return Profile(v), true
			}
		}
	}
	return "", false
}

// SuggestProfile suggests a rollup profile from a plain-language use-case
// description, falling back to a documented default (defi) when the advisory is
// unavailable. An empty fallback defaults to defi.
func (c *RdkClient) SuggestProfile(ctx context.Context, useCase string, fallback Profile) ProfileSuggestion {
	if fallback == "" {
		fallback = ProfileDefi
	}
	result, err := c.Qor.SuggestRollupProfile(ctx, useCase)
	if err != nil {
		return ProfileSuggestion{Profile: fallback, Source: "fallback", Raw: err.Error()}
	}
	if profile, ok := extractProfile(result); ok {
		return ProfileSuggestion{Profile: profile, Source: "advisory", Raw: json.RawMessage(result)}
	}
	return ProfileSuggestion{Profile: fallback, Source: "fallback", Raw: json.RawMessage(result)}
}
