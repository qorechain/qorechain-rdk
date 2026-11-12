package rdk

// Type URLs for the qorechain.rdk.v1 transaction messages.
const rdkTypeURLPrefix = "/qorechain.rdk.v1."

const (
	TypeURLMsgCreateRollup      = rdkTypeURLPrefix + "MsgCreateRollup"
	TypeURLMsgSubmitBatch       = rdkTypeURLPrefix + "MsgSubmitBatch"
	TypeURLMsgChallengeBatch    = rdkTypeURLPrefix + "MsgChallengeBatch"
	TypeURLMsgResolveChallenge  = rdkTypeURLPrefix + "MsgResolveChallenge"
	TypeURLMsgPauseRollup       = rdkTypeURLPrefix + "MsgPauseRollup"
	TypeURLMsgResumeRollup      = rdkTypeURLPrefix + "MsgResumeRollup"
	TypeURLMsgStopRollup        = rdkTypeURLPrefix + "MsgStopRollup"
	TypeURLMsgExecuteWithdrawal = rdkTypeURLPrefix + "MsgExecuteWithdrawal"

	// Chain v3.2.7+.
	TypeURLMsgSetVerificationKey    = rdkTypeURLPrefix + "MsgSetVerificationKey"
	TypeURLMsgUpdateVerificationKey = rdkTypeURLPrefix + "MsgUpdateVerificationKey"

	// Chain v3.2.8+.
	TypeURLMsgPostRollupData                = rdkTypeURLPrefix + "MsgPostRollupData"
	TypeURLMsgPostRollupDataResponse        = rdkTypeURLPrefix + "MsgPostRollupDataResponse"
	TypeURLMsgSetRollupSequencing           = rdkTypeURLPrefix + "MsgSetRollupSequencing"
	TypeURLMsgDepositToRollup               = rdkTypeURLPrefix + "MsgDepositToRollup"
	TypeURLMsgDepositToRollupResponse       = rdkTypeURLPrefix + "MsgDepositToRollupResponse"
	TypeURLMsgBondRollupSubmitter           = rdkTypeURLPrefix + "MsgBondRollupSubmitter"
	TypeURLMsgBondRollupSubmitterResponse   = rdkTypeURLPrefix + "MsgBondRollupSubmitterResponse"
	TypeURLMsgUnbondRollupSubmitter         = rdkTypeURLPrefix + "MsgUnbondRollupSubmitter"
	TypeURLMsgUnbondRollupSubmitterResponse = rdkTypeURLPrefix + "MsgUnbondRollupSubmitterResponse"
	TypeURLMsgSetRollupMembers              = rdkTypeURLPrefix + "MsgSetRollupMembers"
	TypeURLMsgSetRollupMembersResponse      = rdkTypeURLPrefix + "MsgSetRollupMembersResponse"

	// TypeURLMsgRegisterKEMKey is the x/pqc KEM registry message (chain
	// v3.2.5+) a private rollup's members use to publish their key.
	TypeURLMsgRegisterKEMKey = "/qorechain.pqc.v1.MsgRegisterKEMKey"

	// The x/pqc signing-key registration messages. Since chain v3.2.3
	// (pqc-keyless-extension-closed) an account with no registered
	// post-quantum key may send only these.
	TypeURLMsgRegisterPQCKey   = "/qorechain.pqc.v1.MsgRegisterPQCKey"
	TypeURLMsgRegisterPQCKeyV2 = "/qorechain.pqc.v1.MsgRegisterPQCKeyV2"
	TypeURLMsgMigratePQCKey    = "/qorechain.pqc.v1.MsgMigratePQCKey"
)

// Msg is implemented by every rdk transaction message. TypeURL returns the wire
// type URL and Marshal returns the protobuf-encoded message bytes.
type Msg interface {
	TypeURL() string
	Marshal() []byte
}

// MsgCreateRollup registers a new rollup.
type MsgCreateRollup struct {
	Creator     string
	RollupID    string
	Profile     string
	VmType      string
	StakeAmount int64
	// VerificationKey is field 6 (chain v3.2.7+): the rollup's ZK verification
	// key, registered at creation, in the encoding MsgSetVerificationKey takes.
	// Empty: none.
	VerificationKey []byte
	// Sequencing is field 7 (chain v3.2.8+): "" (the rollup's sequencer
	// settles) or "based" (transactions are ordered by their inclusion on the
	// chain and every batch consumes the inbox in order). zk (snark), based
	// settlement and qledger-v1 optimistic rollups only.
	Sequencing string
	// ExecutionVm is field 8 (chain v3.2.8+): "" or "qledger-v1" (optimistic,
	// must be based).
	ExecutionVm string
	// Privacy is field 9 (chain v3.2.8+): "" or "encapsulated" (zk with a
	// Groth16 key only).
	Privacy string
}

func (MsgCreateRollup) TypeURL() string { return TypeURLMsgCreateRollup }

func (m MsgCreateRollup) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Creator)
	w.writeString(2, m.RollupID)
	w.writeString(3, m.Profile)
	w.writeString(4, m.VmType)
	w.writeInt64(5, m.StakeAmount)
	w.writeBytes(6, m.VerificationKey)
	w.writeString(7, m.Sequencing)
	w.writeString(8, m.ExecutionVm)
	w.writeString(9, m.Privacy)
	return w.bytes()
}

// MsgSubmitBatch submits a settlement batch.
type MsgSubmitBatch struct {
	Sequencer       string
	RollupID        string
	BatchIndex      uint64
	StateRoot       []byte
	PrevStateRoot   []byte
	TxCount         uint64
	DataHash        []byte
	Proof           []byte
	WithdrawalsRoot []byte
	// InboxEnd is field 12 (chain v3.2.8+): for a based rollup, the inbox
	// sequence of the last post this batch consumes; DataHash must then be the
	// inbox range commitment (InboxRangeHash). Zero for every other rollup.
	InboxEnd uint64
}

func (MsgSubmitBatch) TypeURL() string { return TypeURLMsgSubmitBatch }

func (m MsgSubmitBatch) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Sequencer)
	w.writeString(2, m.RollupID)
	w.writeUint64(3, m.BatchIndex)
	w.writeBytes(4, m.StateRoot)
	w.writeBytes(5, m.PrevStateRoot)
	w.writeUint64(6, m.TxCount)
	w.writeBytes(7, m.DataHash)
	w.writeBytes(8, m.Proof)
	w.writeBytes(9, m.WithdrawalsRoot)
	w.writeUint64(12, m.InboxEnd)
	return w.bytes()
}

// MsgChallengeBatch challenges an optimistic batch with a fraud proof.
type MsgChallengeBatch struct {
	Challenger string
	RollupID   string
	BatchIndex uint64
	Proof      []byte
}

func (MsgChallengeBatch) TypeURL() string { return TypeURLMsgChallengeBatch }

func (m MsgChallengeBatch) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Challenger)
	w.writeString(2, m.RollupID)
	w.writeUint64(3, m.BatchIndex)
	w.writeBytes(4, m.Proof)
	return w.bytes()
}

// MsgResolveChallenge resolves an open challenge (upheld or dismissed).
type MsgResolveChallenge struct {
	Resolver    string
	RollupID    string
	BatchIndex  uint64
	FraudUpheld bool
}

func (MsgResolveChallenge) TypeURL() string { return TypeURLMsgResolveChallenge }

func (m MsgResolveChallenge) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Resolver)
	w.writeString(2, m.RollupID)
	w.writeUint64(3, m.BatchIndex)
	w.writeBool(4, m.FraudUpheld)
	return w.bytes()
}

// MsgPauseRollup pauses an active rollup.
type MsgPauseRollup struct {
	Creator  string
	RollupID string
	Reason   string
}

func (MsgPauseRollup) TypeURL() string { return TypeURLMsgPauseRollup }

func (m MsgPauseRollup) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Creator)
	w.writeString(2, m.RollupID)
	w.writeString(3, m.Reason)
	return w.bytes()
}

// MsgResumeRollup resumes a paused rollup.
type MsgResumeRollup struct {
	Creator  string
	RollupID string
}

func (MsgResumeRollup) TypeURL() string { return TypeURLMsgResumeRollup }

func (m MsgResumeRollup) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Creator)
	w.writeString(2, m.RollupID)
	return w.bytes()
}

// MsgStopRollup stops a rollup permanently.
type MsgStopRollup struct {
	Creator  string
	RollupID string
}

func (MsgStopRollup) TypeURL() string { return TypeURLMsgStopRollup }

func (m MsgStopRollup) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Creator)
	w.writeString(2, m.RollupID)
	return w.bytes()
}

// MsgExecuteWithdrawal finalizes an L2->L1 cross-layer message (withdrawal).
type MsgExecuteWithdrawal struct {
	Submitter       string
	RollupID        string
	BatchIndex      uint64
	WithdrawalIndex uint64
	Recipient       string
	Denom           string
	Amount          int64
	Proof           [][]byte
}

func (MsgExecuteWithdrawal) TypeURL() string { return TypeURLMsgExecuteWithdrawal }

func (m MsgExecuteWithdrawal) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Submitter)
	w.writeString(2, m.RollupID)
	w.writeUint64(3, m.BatchIndex)
	w.writeUint64(4, m.WithdrawalIndex)
	w.writeString(5, m.Recipient)
	w.writeString(6, m.Denom)
	w.writeInt64(7, m.Amount)
	w.writeRepeatedBytes(8, m.Proof)
	return w.bytes()
}

// --- Friendly message-builder inputs (mirror the TypeScript messages.ts) ---

// CreateRollupInput builds a MsgCreateRollup.
type CreateRollupInput struct {
	Creator     string
	RollupID    string
	Profile     string
	VmType      string
	StakeAmount int64
	// VerificationKey registers the zk verification key at creation (chain
	// v3.2.7+, see SetVerificationKeyMsg).
	VerificationKey []byte
	// Sequencing is "based" to order the rollup's transactions by their
	// inclusion on the chain (chain v3.2.8+). Allowed for zk (snark), based
	// settlement and qledger-v1 optimistic rollups.
	Sequencing string
	// ExecutionVm is "qledger-v1", the execution model the chain re-executes in
	// a fraud proof (chain v3.2.8+). Required for every new optimistic rollup
	// (nft, custom), together with Sequencing "based".
	ExecutionVm string
	// Privacy is "encapsulated" for a private rollup (chain v3.2.8+, zk with a
	// Groth16 key only).
	Privacy string
}

// CreateRollupMsg builds a MsgCreateRollup from input. The VmType is mapped to
// its on-chain wire value (the QoreChain Native runtime "native" is transmitted
// as "cosmwasm"); "native" is never emitted on the wire.
func CreateRollupMsg(in CreateRollupInput) MsgCreateRollup {
	return MsgCreateRollup{
		Creator:     in.Creator,
		RollupID:    in.RollupID,
		Profile:     in.Profile,
		VmType:      VMTypeWireValue(in.VmType),
		StakeAmount: in.StakeAmount,

		VerificationKey: in.VerificationKey,
		Sequencing:      in.Sequencing,
		ExecutionVm:     in.ExecutionVm,
		Privacy:         in.Privacy,
	}
}

// SubmitBatchInput builds a MsgSubmitBatch.
type SubmitBatchInput struct {
	Sequencer       string
	RollupID        string
	BatchIndex      uint64
	StateRoot       []byte
	PrevStateRoot   []byte
	TxCount         uint64
	DataHash        []byte
	Proof           []byte
	WithdrawalsRoot []byte
	// InboxEnd is for based rollups only (chain v3.2.8+): the inbox sequence of
	// the last post this batch consumes. DataHash must then be the inbox range
	// commitment (InboxRangeHash, or RestClient.GetInbox(rollupID, inboxEnd)).
	InboxEnd uint64
}

// SubmitBatchMsg builds a MsgSubmitBatch from input.
func SubmitBatchMsg(in SubmitBatchInput) MsgSubmitBatch {
	return MsgSubmitBatch{
		Sequencer:       in.Sequencer,
		RollupID:        in.RollupID,
		BatchIndex:      in.BatchIndex,
		StateRoot:       in.StateRoot,
		PrevStateRoot:   in.PrevStateRoot,
		TxCount:         in.TxCount,
		DataHash:        in.DataHash,
		Proof:           in.Proof,
		WithdrawalsRoot: in.WithdrawalsRoot,
		InboxEnd:        in.InboxEnd,
	}
}

// ChallengeBatchInput builds a MsgChallengeBatch.
type ChallengeBatchInput struct {
	Challenger string
	RollupID   string
	BatchIndex uint64
	Proof      []byte
}

// ChallengeBatchMsg builds a MsgChallengeBatch from input.
func ChallengeBatchMsg(in ChallengeBatchInput) MsgChallengeBatch {
	return MsgChallengeBatch(in)
}

// ResolveChallengeInput builds a MsgResolveChallenge.
type ResolveChallengeInput struct {
	Resolver    string
	RollupID    string
	BatchIndex  uint64
	FraudUpheld bool
}

// ResolveChallengeMsg builds a MsgResolveChallenge from input.
func ResolveChallengeMsg(in ResolveChallengeInput) MsgResolveChallenge {
	return MsgResolveChallenge(in)
}

// PauseRollupInput builds a MsgPauseRollup.
type PauseRollupInput struct {
	Creator  string
	RollupID string
	Reason   string
}

// PauseRollupMsg builds a MsgPauseRollup from input.
func PauseRollupMsg(in PauseRollupInput) MsgPauseRollup {
	return MsgPauseRollup(in)
}

// RollupRefInput identifies a rollup for resume/stop.
type RollupRefInput struct {
	Creator  string
	RollupID string
}

// ResumeRollupMsg builds a MsgResumeRollup from input.
func ResumeRollupMsg(in RollupRefInput) MsgResumeRollup {
	return MsgResumeRollup(in)
}

// StopRollupMsg builds a MsgStopRollup from input.
func StopRollupMsg(in RollupRefInput) MsgStopRollup {
	return MsgStopRollup(in)
}

// ExecuteWithdrawalInput builds a MsgExecuteWithdrawal.
type ExecuteWithdrawalInput struct {
	Submitter       string
	RollupID        string
	BatchIndex      uint64
	WithdrawalIndex uint64
	Recipient       string
	Denom           string
	Amount          int64
	Proof           [][]byte
}

// ExecuteWithdrawalMsg builds a MsgExecuteWithdrawal from input.
func ExecuteWithdrawalMsg(in ExecuteWithdrawalInput) MsgExecuteWithdrawal {
	return MsgExecuteWithdrawal(in)
}
