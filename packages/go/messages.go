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
}

func (MsgCreateRollup) TypeURL() string { return TypeURLMsgCreateRollup }

func (m MsgCreateRollup) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Creator)
	w.writeString(2, m.RollupID)
	w.writeString(3, m.Profile)
	w.writeString(4, m.VmType)
	w.writeInt64(5, m.StakeAmount)
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
}

// CreateRollupMsg builds a MsgCreateRollup from input.
func CreateRollupMsg(in CreateRollupInput) MsgCreateRollup {
	return MsgCreateRollup{
		Creator:     in.Creator,
		RollupID:    in.RollupID,
		Profile:     in.Profile,
		VmType:      in.VmType,
		StakeAmount: in.StakeAmount,
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
