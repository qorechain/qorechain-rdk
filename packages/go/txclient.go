package rdk

import "context"

// TxBackend is the sign-and-broadcast capability RdkTxClient depends on. The
// default backend signs locally and broadcasts via the REST txs endpoint; the
// MockTxClient backend records calls and returns a fake successful result so the
// full lifecycle flow runs offline.
type TxBackend interface {
	// SignAndBroadcast submits messages signed by signer and returns the raw
	// broadcast response.
	SignAndBroadcast(ctx context.Context, signer string, messages []Msg, p TxParams) (map[string]any, error)
}

// SimulateBackend is the optional gas-estimation capability. The MockTxClient
// backend satisfies it; the default REST backend simulates via the chain's
// simulate endpoint.
type SimulateBackend interface {
	// Simulate estimates gas for messages without broadcasting.
	Simulate(ctx context.Context, signer string, messages []Msg, p TxParams) (uint64, error)
}

// RdkTxClient signs and broadcasts rdk transactions (rollup lifecycle,
// settlement batches, withdrawals). It builds the Cosmos tx envelope, signs the
// SignDoc, and broadcasts TxRaw via the REST txs endpoint.
//
// Two signing paths:
//
//   - Hybrid (post-quantum): set Hybrid (see WithHybrid and
//     RdkClient.ConnectTx). Every transaction is then built and signed by the
//     QoreChain SDK's hybrid builder, which attaches the ML-DSA-87 signature as
//     a tx-body extension alongside the classical secp256k1 signature. Both
//     public networks require it on native-lane transactions.
//   - Classical: without Hybrid the client signs secp256k1-only
//     (SIGN_MODE_DIRECT), which the public networks refuse. Useful offline and
//     against a local chain that does not require the post-quantum signature.
//
// Account and chain context (sequence, account number, chain id) must be
// supplied per call; read the sequence and account number from the chain's auth
// query before submitting. Broadcasting is only performed when Broadcast is
// called with a live REST client.
type RdkTxClient struct {
	// Account is the signing/operator account; its address is the message signer.
	Account Account
	// ChainID is the chain id signed into every SignDoc.
	ChainID string
	// Rest is the REST client used to broadcast. May be nil for offline use.
	Rest *RestClient
	// Backend, when set, replaces the default sign-and-broadcast path. Inject a
	// MockTxClient here to exercise the flow offline.
	Backend TxBackend
	// Hybrid, when set, makes every transaction this client signs hybrid
	// (post-quantum). Nil signs classical-only. Prefer WithHybrid, which also
	// gives the client a caching sign-bytes resolver.
	Hybrid *HybridOptions
}

// NewRdkTxClient creates a tx client for an account and chain id. The REST
// client is used for broadcasting and may be nil for offline signing. The
// client signs classical-only until given a post-quantum keypair with
// WithHybrid.
func NewRdkTxClient(account Account, chainID string, rest *RestClient) *RdkTxClient {
	return &RdkTxClient{Account: account, ChainID: chainID, Rest: rest}
}

// WithBackend returns a copy of the client wired to a custom sign-and-broadcast
// backend (e.g. a MockTxClient). The account address remains the message signer.
func (c *RdkTxClient) WithBackend(backend TxBackend) *RdkTxClient {
	copy := *c
	copy.Backend = backend
	return &copy
}

// TxParams carries the per-transaction signing context and fee.
type TxParams struct {
	// Sequence is the signer account sequence.
	Sequence uint64
	// AccountNumber is the signer account number.
	AccountNumber uint64
	// Fee is the transaction fee.
	Fee Fee
	// Memo is an optional memo.
	Memo string
}

// Sign builds and signs a transaction, returning the TxRaw bytes ready to
// broadcast: hybrid when the client has a Hybrid configuration, classical
// otherwise. It is BuildTx with a background context.
func (c *RdkTxClient) Sign(messages []Msg, p TxParams) ([]byte, error) {
	built, err := c.BuildTx(context.Background(), messages, p)
	if err != nil {
		return nil, err
	}
	return built.TxRaw, nil
}

// Broadcast signs and broadcasts the messages and returns the raw response.
// When a Backend is configured it is used; otherwise the messages are signed
// locally (hybrid when the client has a Hybrid configuration) and broadcast via
// the REST txs endpoint, which requires a non-nil REST client. The rule checks
// run before anything is signed.
func (c *RdkTxClient) Broadcast(ctx context.Context, messages []Msg, p TxParams) (map[string]any, error) {
	if err := preflightMessages(messages); err != nil {
		return nil, err
	}
	if c.Backend != nil {
		return c.Backend.SignAndBroadcast(ctx, c.Account.Address, messages, p)
	}
	if c.Rest == nil {
		return nil, &RollupConfigError{Errors: []string{"no REST client configured for broadcast"}}
	}
	if c.Hybrid != nil {
		return c.broadcastHybrid(ctx, messages, p)
	}
	built, err := c.BuildTx(ctx, messages, p)
	if err != nil {
		return nil, err
	}
	return c.Rest.BroadcastTxBytes(ctx, built.TxRaw)
}

// Simulate estimates gas for a set of messages without broadcasting — the basis
// for a dry run. When a Backend that supports simulation is configured it is
// used; otherwise the assembled tx is simulated via the chain's simulate
// endpoint, which requires a non-nil REST client.
func (c *RdkTxClient) Simulate(ctx context.Context, messages []Msg, p TxParams) (uint64, error) {
	if c.Backend != nil {
		sim, ok := c.Backend.(SimulateBackend)
		if !ok {
			return 0, &RollupConfigError{Errors: []string{"the configured backend does not support simulation"}}
		}
		return sim.Simulate(ctx, c.Account.Address, messages, p)
	}
	if c.Rest == nil {
		return 0, &RollupConfigError{Errors: []string{"no REST client configured for simulation"}}
	}
	built, err := c.BuildTx(ctx, messages, p)
	if err != nil {
		return 0, err
	}
	return c.Rest.SimulateTxBytes(ctx, built.TxRaw)
}

// --- message builders that fill in the signer from the client's address ---

// CreateRollup builds a MsgCreateRollup with this client's address as creator.
func (c *RdkTxClient) CreateRollup(in CreateRollupInput) MsgCreateRollup {
	in.Creator = c.Account.Address
	return CreateRollupMsg(in)
}

// SubmitBatch builds a MsgSubmitBatch with this client's address as sequencer.
func (c *RdkTxClient) SubmitBatch(in SubmitBatchInput) MsgSubmitBatch {
	in.Sequencer = c.Account.Address
	return SubmitBatchMsg(in)
}

// ChallengeBatch builds a MsgChallengeBatch with this client's address as
// challenger.
func (c *RdkTxClient) ChallengeBatch(in ChallengeBatchInput) MsgChallengeBatch {
	in.Challenger = c.Account.Address
	return ChallengeBatchMsg(in)
}

// ResolveChallenge builds a MsgResolveChallenge with this client's address as
// resolver.
func (c *RdkTxClient) ResolveChallenge(in ResolveChallengeInput) MsgResolveChallenge {
	in.Resolver = c.Account.Address
	return ResolveChallengeMsg(in)
}

// PauseRollup builds a MsgPauseRollup, optionally guarding the transition. Pass
// a non-empty currentStatus to enforce the lifecycle guard.
func (c *RdkTxClient) PauseRollup(rollupID, reason string, currentStatus RollupStatus) (MsgPauseRollup, error) {
	if currentStatus != "" {
		if err := AssertRollupAction(ActionPause, currentStatus); err != nil {
			return MsgPauseRollup{}, err
		}
	}
	return PauseRollupMsg(PauseRollupInput{Creator: c.Account.Address, RollupID: rollupID, Reason: reason}), nil
}

// ResumeRollup builds a MsgResumeRollup, optionally guarding the transition.
func (c *RdkTxClient) ResumeRollup(rollupID string, currentStatus RollupStatus) (MsgResumeRollup, error) {
	if currentStatus != "" {
		if err := AssertRollupAction(ActionResume, currentStatus); err != nil {
			return MsgResumeRollup{}, err
		}
	}
	return ResumeRollupMsg(RollupRefInput{Creator: c.Account.Address, RollupID: rollupID}), nil
}

// StopRollup builds a MsgStopRollup, optionally guarding the transition.
func (c *RdkTxClient) StopRollup(rollupID string, currentStatus RollupStatus) (MsgStopRollup, error) {
	if currentStatus != "" {
		if err := AssertRollupAction(ActionStop, currentStatus); err != nil {
			return MsgStopRollup{}, err
		}
	}
	return StopRollupMsg(RollupRefInput{Creator: c.Account.Address, RollupID: rollupID}), nil
}

// ExecuteWithdrawal builds a MsgExecuteWithdrawal with this client's address as
// submitter.
func (c *RdkTxClient) ExecuteWithdrawal(in ExecuteWithdrawalInput) MsgExecuteWithdrawal {
	in.Submitter = c.Account.Address
	return ExecuteWithdrawalMsg(in)
}
