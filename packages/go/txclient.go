package rdk

import "context"

// RdkTxClient signs and broadcasts rdk transactions (rollup lifecycle,
// settlement batches, withdrawals). It builds the Cosmos tx envelope, signs the
// SignDoc, and broadcasts TxRaw via the REST txs endpoint.
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
}

// NewRdkTxClient creates a tx client for an account and chain id. The REST
// client is used for broadcasting and may be nil for offline signing.
func NewRdkTxClient(account Account, chainID string, rest *RestClient) *RdkTxClient {
	return &RdkTxClient{Account: account, ChainID: chainID, Rest: rest}
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
// broadcast.
func (c *RdkTxClient) Sign(messages []Msg, p TxParams) []byte {
	return SignTx(c.Account, messages, p.Memo, p.Fee, p.Sequence, c.ChainID, p.AccountNumber)
}

// Broadcast signs and broadcasts the messages via the REST txs endpoint and
// returns the raw response. It requires a non-nil REST client.
func (c *RdkTxClient) Broadcast(ctx context.Context, messages []Msg, p TxParams) (map[string]any, error) {
	if c.Rest == nil {
		return nil, &RollupConfigError{Errors: []string{"no REST client configured for broadcast"}}
	}
	txBytes := c.Sign(messages, p)
	return c.Rest.BroadcastTxBytes(ctx, txBytes)
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
