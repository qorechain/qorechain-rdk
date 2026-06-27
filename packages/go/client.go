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
}

// BatchView holds a settlement batch.
type BatchView struct {
	RollupID        string
	BatchIndex      int
	StateRoot       string
	PrevStateRoot   string
	TxCount         int
	DataHash        string
	ProofType       string
	Status          string
	SubmittedAt     int
	FinalizedAt     int
	WithdrawalsRoot string
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
	}
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

// ListBatches reads all settlement batches for a rollup.
func (c *RestClient) ListBatches(ctx context.Context, rollupID string) ([]BatchView, error) {
	body, err := c.get(ctx, "/qorechain/rdk/v1/batches/"+url.PathEscape(rollupID))
	if err != nil {
		return nil, err
	}
	out := []BatchView{}
	for _, b := range asArray(pick(body, "batches")) {
		out = append(out, MapBatchView(b))
	}
	return out, nil
}

// GetLatestBatch reads the latest settlement batch for a rollup.
func (c *RestClient) GetLatestBatch(ctx context.Context, rollupID string) (BatchView, error) {
	body, err := c.get(ctx, "/qorechain/rdk/v1/batches/"+url.PathEscape(rollupID)+"?latest=true")
	if err != nil {
		return BatchView{}, err
	}
	if b := pick(body, "batch"); b != nil {
		return MapBatchView(asRecord(b)), nil
	}
	return MapBatchView(body), nil
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
	body, err := c.get(ctx, "/qorechain/pqc/v1/accounts/"+url.PathEscape(address))
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
	return &RdkClient{
		Network: net,
		Rest:    NewRestClient(net.Endpoints.Rest, options.HTTP),
		Qor:     NewQorClient(net.Endpoints.EvmRPC, options.HTTP),
	}
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
