package rdk

import (
	"context"
	"fmt"
	"strings"
)

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
// run before anything is signed; on the REST path each MsgSubmitBatch is also
// checked against the rollup as the chain reads it (CheckSubmitBatch).
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
	for _, m := range messages {
		if batch, ok := m.(MsgSubmitBatch); ok {
			if err := c.CheckSubmitBatch(ctx, batch); err != nil {
				return nil, err
			}
		}
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

// --- chain v3.2.7 and v3.2.8 messages ---

// SetVerificationKey builds a MsgSetVerificationKey with this client's address
// as creator (chain v3.2.7+). The creator only, and only before the first
// batch. ProofSystem "stark" is refused from chain v3.2.8.
func (c *RdkTxClient) SetVerificationKey(in SetVerificationKeyInput) (MsgSetVerificationKey, error) {
	if e := setVerificationKeyError(in.ProofSystem); e != "" {
		return MsgSetVerificationKey{}, &RollupConfigError{Errors: []string{e}}
	}
	in.Creator = c.Account.Address
	return SetVerificationKeyMsg(in), nil
}

// PostRollupData builds a MsgPostRollupData with this client's address as
// poster (chain v3.2.8+). The response's MsgPostRollupDataResponse carries the
// inbox sequence and SHA-256; on a private rollup data must be an envelope
// (SealEnvelope). The poster pays posted_data_fee_per_byte per billable byte
// (at least 1 KiB) on top of gas.
func (c *RdkTxClient) PostRollupData(rollupID string, data []byte) (MsgPostRollupData, error) {
	if e := postRollupDataError(data); e != "" {
		return MsgPostRollupData{}, &RollupConfigError{Errors: []string{e}}
	}
	return PostRollupDataMsg(PostRollupDataInput{Poster: c.Account.Address, RollupID: rollupID, Data: data}), nil
}

// DepositToRollup builds a MsgDepositToRollup with this client's address as
// depositor (chain v3.2.8+): amount uqor into a qledger-v1 rollup, credited to
// the 32-byte L2 account through the rollup's inbox. At least
// MinRollupDepositUqor (1 QOR).
func (c *RdkTxClient) DepositToRollup(rollupID string, account []byte, amount uint64) (MsgDepositToRollup, error) {
	if e := depositToRollupError(account, amount); e != "" {
		return MsgDepositToRollup{}, &RollupConfigError{Errors: []string{e}}
	}
	return DepositToRollupMsg(DepositToRollupInput{
		Depositor: c.Account.Address, RollupID: rollupID, Account: account, Amount: amount,
	}), nil
}

// BondRollupSubmitter builds a MsgBondRollupSubmitter adding amount uqor to
// this client's submitter bond on a qledger-v1 rollup (chain v3.2.8+).
func (c *RdkTxClient) BondRollupSubmitter(rollupID string, amount uint64) (MsgBondRollupSubmitter, error) {
	if e := bondRollupSubmitterError(amount); e != "" {
		return MsgBondRollupSubmitter{}, &RollupConfigError{Errors: []string{e}}
	}
	return BondRollupSubmitterMsg(BondRollupSubmitterInput{Submitter: c.Account.Address, RollupID: rollupID, Amount: amount}), nil
}

// UnbondRollupSubmitter builds a MsgUnbondRollupSubmitter withdrawing this
// client's whole submitter bond, a full challenge window after its last batch
// (chain v3.2.8+).
func (c *RdkTxClient) UnbondRollupSubmitter(rollupID string) MsgUnbondRollupSubmitter {
	return UnbondRollupSubmitterMsg(UnbondRollupSubmitterInput{Submitter: c.Account.Address, RollupID: rollupID})
}

// SetRollupMembers builds a MsgSetRollupMembers with this client's address as
// creator (chain v3.2.8+): 1 to MaxRollupMembers distinct members, each with a
// registered ML-KEM-1024 key. Starts a new membership epoch.
func (c *RdkTxClient) SetRollupMembers(rollupID string, members []string) (MsgSetRollupMembers, error) {
	if e := setRollupMembersError(members); e != "" {
		return MsgSetRollupMembers{}, &RollupConfigError{Errors: []string{e}}
	}
	return SetRollupMembersMsg(SetRollupMembersInput{Creator: c.Account.Address, RollupID: rollupID, Members: members}), nil
}

// RegisterKEMKey builds a MsgRegisterKEMKey publishing this client's
// ML-KEM-1024 encapsulation key (1568 bytes) in the chain's KEM registry (chain
// v3.2.5+), so a private rollup can list it as a member. Derive the key pair
// with KemKeypairFromSeed and keep the seed secret.
func (c *RdkTxClient) RegisterKEMKey(publicKey []byte) (MsgRegisterKEMKey, error) {
	if e := registerKEMKeyError(publicKey); e != "" {
		return MsgRegisterKEMKey{}, &RollupConfigError{Errors: []string{e}}
	}
	return RegisterKEMKeyMsg(RegisterKEMKeyInput{Sender: c.Account.Address, PublicKey: publicKey}), nil
}

// CheckSubmitBatch makes the checks the chain would make on a batch after the
// fee is paid, reading the rollup over the client's REST client: a based
// rollup's InboxEnd, a native-DA data hash (allowed once rdk-post-rollup-data
// is on), the qledger-v1 admission rules (QledgerBatchErrors: bond, pending
// batches, range, retained end, fresh-post and checkpoint stops), the paused
// STARK settlement, and, while rdk-zk-canonical-inputs is on, canonical ZK
// public inputs. Without a REST client it checks nothing.
// Broadcast calls it for every MsgSubmitBatch on the REST path.
func (c *RdkTxClient) CheckSubmitBatch(ctx context.Context, m MsgSubmitBatch) error {
	if c.Rest == nil {
		return nil
	}
	fail := func(why string) error {
		return &RollupConfigError{Errors: []string{fmt.Sprintf("cannot submit batch %d: %s", m.BatchIndex, why)}}
	}
	rollup, err := c.Rest.GetRollup(ctx, m.RollupID)
	if err != nil {
		return err
	}
	based := rollup.Sequencing == string(SequencingBased)
	if based && m.InboxEnd == 0 {
		return fail("the rollup is based: set InboxEnd and carry the inbox range commitment as DataHash")
	}
	if !based && m.InboxEnd != 0 {
		return fail("InboxEnd must be 0 on a rollup that is not based")
	}
	if !based && len(m.DataHash) > 0 {
		postedData, err := c.Rest.IsProtocolFeatureEnabled(ctx, FeatureRDKPostRollupData)
		if err != nil {
			return err
		}
		if e := DataHashError(rollup.DABackend, m.DataHash, DataHashOptions{PostedDataEnabled: postedData}); e != "" {
			return fail(e)
		}
	}
	if rollup.ExecutionVm == string(ExecutionVmQLedgerV1) {
		// Chain v3.2.8 admission rules for qledger-v1 batches.
		submitter := m.Sequencer
		if submitter == "" {
			submitter = c.Account.Address
		}
		inbox, err := c.Rest.GetInbox(ctx, m.RollupID, 0)
		if err != nil {
			return err
		}
		facts, err := qledgerLiveFacts(ctx, c.Rest, m.RollupID, submitter, inbox, m.InboxEnd, 2)
		if err != nil {
			return err
		}
		if errs := QledgerBatchErrors(facts); len(errs) > 0 {
			return fail(strings.Join(errs, "; "))
		}
	}
	if rollup.SettlementMode != string(SettlementZK) {
		return nil
	}
	if contains(PausedProofSystems, ProofSystem(rollup.ProofSystem)) {
		paused, err := c.Rest.IsProtocolFeatureEnabled(ctx, FeatureRDKStarkStatement)
		if err != nil {
			return err
		}
		if paused {
			return fail("STARK settlement is paused on the network; governance can move the rollup to a Groth16 key")
		}
		return nil
	}
	canonical, err := c.Rest.IsProtocolFeatureEnabled(ctx, FeatureRDKZkCanonicalInputs)
	if err != nil {
		return err
	}
	if canonical {
		errs := ZkPublicInputErrors(ZkBatchInputs{
			PrevStateRoot:   m.PrevStateRoot,
			StateRoot:       m.StateRoot,
			DataHash:        m.DataHash,
			WithdrawalsRoot: m.WithdrawalsRoot,
		}, ZkInputOptions{DataHashBound: IsDataHashChainBound(rollup, m.DataHash)})
		if len(errs) > 0 {
			return fail(strings.Join(errs, "; "))
		}
	}
	return nil
}
