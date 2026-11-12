package rdk

import "fmt"

// Messages added in chain v3.2.7 (verification keys) and v3.2.8 (posted data,
// based sequencing, qledger-v1 rollups, private rollups), plus the x/pqc KEM
// registry message private-rollup members need. Fields are written in
// ascending order, as gogoproto does, so the bytes match the chain's tx.proto.

// MsgSetVerificationKey registers or replaces a zk rollup's verification key
// (chain v3.2.7+). Signed by the creator, before the rollup's first batch only.
// For "snark" the key is a Groth16 BLS12-381 verifying key in gnark's binary
// encoding for a circuit with exactly four public inputs (prev_state_root,
// state_root, data_hash, withdrawals_root). From v3.2.8 a "stark" key is
// refused.
type MsgSetVerificationKey struct {
	Creator         string
	RollupID        string
	VerificationKey []byte
	// ProofSystem is "snark", or empty to keep the rollup's proof system.
	ProofSystem string
}

func (MsgSetVerificationKey) TypeURL() string { return TypeURLMsgSetVerificationKey }

func (m MsgSetVerificationKey) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Creator)
	w.writeString(2, m.RollupID)
	w.writeBytes(3, m.VerificationKey)
	w.writeString(4, m.ProofSystem)
	return w.bytes()
}

// MsgUpdateVerificationKey is the governance-only key replacement (chain
// v3.2.7+); Authority is the gov module account.
type MsgUpdateVerificationKey struct {
	Authority       string
	RollupID        string
	VerificationKey []byte
	ProofSystem     string
}

func (MsgUpdateVerificationKey) TypeURL() string { return TypeURLMsgUpdateVerificationKey }

func (m MsgUpdateVerificationKey) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Authority)
	w.writeString(2, m.RollupID)
	w.writeBytes(3, m.VerificationKey)
	w.writeString(4, m.ProofSystem)
	return w.bytes()
}

// MsgPostRollupData puts rollup data on chain (chain v3.2.8+). The chain keeps
// a commitment (SHA-256 of Data) under the rollup's next inbox sequence; a
// native-DA batch may then carry that SHA-256 as its data_hash. Who may post:
// the rollup's sequencer (its creator when none is set); anyone on a based
// rollup. On a private rollup Data must be an envelope (SealEnvelope).
type MsgPostRollupData struct {
	Poster   string
	RollupID string
	Data     []byte
}

func (MsgPostRollupData) TypeURL() string { return TypeURLMsgPostRollupData }

func (m MsgPostRollupData) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Poster)
	w.writeString(2, m.RollupID)
	w.writeBytes(3, m.Data)
	return w.bytes()
}

// MsgPostRollupDataResponse is what MsgPostRollupData returns.
type MsgPostRollupDataResponse struct {
	// Sequence is the inbox sequence the post was given (from 1).
	Sequence uint64
	// DataHash is SHA-256 of the data: the hash a batch references.
	DataHash []byte
}

func (MsgPostRollupDataResponse) TypeURL() string { return TypeURLMsgPostRollupDataResponse }

func (m MsgPostRollupDataResponse) Marshal() []byte {
	w := &protoWriter{}
	w.writeUint64(1, m.Sequence)
	w.writeBytes(2, m.DataHash)
	return w.bytes()
}

// Unmarshal decodes the response bytes.
func (m *MsgPostRollupDataResponse) Unmarshal(b []byte) error {
	fields, err := readProtoFields(b)
	if err != nil {
		return err
	}
	*m = MsgPostRollupDataResponse{}
	for _, f := range fields {
		switch {
		case f.num == 1 && f.wire == wireVarint:
			m.Sequence = f.varint
		case f.num == 2 && f.wire == wireBytes:
			m.DataHash = f.bytes
		}
	}
	return nil
}

// MsgSetRollupSequencing is the governance-only move to based sequencing
// ("based") or back (""), chain v3.2.8+.
type MsgSetRollupSequencing struct {
	Authority  string
	RollupID   string
	Sequencing string
}

func (MsgSetRollupSequencing) TypeURL() string { return TypeURLMsgSetRollupSequencing }

func (m MsgSetRollupSequencing) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Authority)
	w.writeString(2, m.RollupID)
	w.writeString(3, m.Sequencing)
	return w.bytes()
}

// MsgDepositToRollup moves Amount uqor into a qledger-v1 rollup's deposit pool
// and credits the 32-byte L2 Account through the rollup's inbox (chain
// v3.2.8+). At least MinRollupDepositUqor (1 QOR).
type MsgDepositToRollup struct {
	Depositor string
	RollupID  string
	Account   []byte
	Amount    uint64
}

func (MsgDepositToRollup) TypeURL() string { return TypeURLMsgDepositToRollup }

func (m MsgDepositToRollup) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Depositor)
	w.writeString(2, m.RollupID)
	w.writeBytes(3, m.Account)
	w.writeUint64(4, m.Amount)
	return w.bytes()
}

// MsgDepositToRollupResponse carries the inbox sequence of the deposit entry.
type MsgDepositToRollupResponse struct {
	Sequence uint64
}

func (MsgDepositToRollupResponse) TypeURL() string { return TypeURLMsgDepositToRollupResponse }

func (m MsgDepositToRollupResponse) Marshal() []byte {
	w := &protoWriter{}
	w.writeUint64(1, m.Sequence)
	return w.bytes()
}

// Unmarshal decodes the response bytes.
func (m *MsgDepositToRollupResponse) Unmarshal(b []byte) error {
	v, err := readSingleUint64(b)
	m.Sequence = v
	return err
}

// MsgBondRollupSubmitter adds Amount uqor to the submitter's bond on a
// qledger-v1 rollup (chain v3.2.8+).
type MsgBondRollupSubmitter struct {
	Submitter string
	RollupID  string
	Amount    uint64
}

func (MsgBondRollupSubmitter) TypeURL() string { return TypeURLMsgBondRollupSubmitter }

func (m MsgBondRollupSubmitter) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Submitter)
	w.writeString(2, m.RollupID)
	w.writeUint64(3, m.Amount)
	return w.bytes()
}

// MsgBondRollupSubmitterResponse carries the submitter's bond after the call.
type MsgBondRollupSubmitterResponse struct {
	Bond uint64
}

func (MsgBondRollupSubmitterResponse) TypeURL() string {
	return TypeURLMsgBondRollupSubmitterResponse
}

func (m MsgBondRollupSubmitterResponse) Marshal() []byte {
	w := &protoWriter{}
	w.writeUint64(1, m.Bond)
	return w.bytes()
}

// Unmarshal decodes the response bytes.
func (m *MsgBondRollupSubmitterResponse) Unmarshal(b []byte) error {
	v, err := readSingleUint64(b)
	m.Bond = v
	return err
}

// MsgUnbondRollupSubmitter returns the submitter's whole bond, a full
// challenge window after its last batch (chain v3.2.8+).
type MsgUnbondRollupSubmitter struct {
	Submitter string
	RollupID  string
}

func (MsgUnbondRollupSubmitter) TypeURL() string { return TypeURLMsgUnbondRollupSubmitter }

func (m MsgUnbondRollupSubmitter) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Submitter)
	w.writeString(2, m.RollupID)
	return w.bytes()
}

// MsgUnbondRollupSubmitterResponse carries the uqor returned.
type MsgUnbondRollupSubmitterResponse struct {
	Returned uint64
}

func (MsgUnbondRollupSubmitterResponse) TypeURL() string {
	return TypeURLMsgUnbondRollupSubmitterResponse
}

func (m MsgUnbondRollupSubmitterResponse) Marshal() []byte {
	w := &protoWriter{}
	w.writeUint64(1, m.Returned)
	return w.bytes()
}

// Unmarshal decodes the response bytes.
func (m *MsgUnbondRollupSubmitterResponse) Unmarshal(b []byte) error {
	v, err := readSingleUint64(b)
	m.Returned = v
	return err
}

// MsgSetRollupMembers sets a private rollup's member list (chain v3.2.8+): at
// most MaxRollupMembers canonical account addresses, each with a registered
// ML-KEM-1024 key. Signed by the creator; each change starts a new membership
// epoch.
type MsgSetRollupMembers struct {
	Creator  string
	RollupID string
	Members  []string
}

func (MsgSetRollupMembers) TypeURL() string { return TypeURLMsgSetRollupMembers }

func (m MsgSetRollupMembers) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Creator)
	w.writeString(2, m.RollupID)
	w.writeRepeatedString(3, m.Members)
	return w.bytes()
}

// MsgSetRollupMembersResponse carries the new membership epoch.
type MsgSetRollupMembersResponse struct {
	Epoch uint64
}

func (MsgSetRollupMembersResponse) TypeURL() string { return TypeURLMsgSetRollupMembersResponse }

func (m MsgSetRollupMembersResponse) Marshal() []byte {
	w := &protoWriter{}
	w.writeUint64(1, m.Epoch)
	return w.bytes()
}

// Unmarshal decodes the response bytes.
func (m *MsgSetRollupMembersResponse) Unmarshal(b []byte) error {
	v, err := readSingleUint64(b)
	m.Epoch = v
	return err
}

// MlKem1024AlgorithmID is ML-KEM-1024's id in the chain's algorithm registry.
const MlKem1024AlgorithmID = 2

// MsgRegisterKEMKey publishes the sender's key-encapsulation public key in the
// chain's KEM registry (x/pqc, chain v3.2.5+). A private rollup's members need
// an ML-KEM-1024 key there (AlgorithmID 2, the 1568-byte FIPS 203
// encapsulation key). Sign it hybrid like the other key maintenance.
type MsgRegisterKEMKey struct {
	Sender      string
	AlgorithmID uint32
	PublicKey   []byte
}

func (MsgRegisterKEMKey) TypeURL() string { return TypeURLMsgRegisterKEMKey }

func (m MsgRegisterKEMKey) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Sender)
	w.writeUint64(2, uint64(m.AlgorithmID))
	w.writeBytes(3, m.PublicKey)
	return w.bytes()
}

// MsgRegisterPQCKeyV2 registers the sender's post-quantum signing key (x/pqc).
// Since chain v3.2.3 a key carried in the hybrid signature extension is no
// longer registered on first use, so a new account sends this, in a
// transaction of its own, before anything else. The hybrid tx client does that
// automatically when IncludePqcPublicKey is set.
type MsgRegisterPQCKeyV2 struct {
	Sender string
	// PublicKey is the ML-DSA-87 public key (2592 bytes).
	PublicKey []byte
	// AlgorithmID is the key's algorithm (1 = ML-DSA-87).
	AlgorithmID uint32
	// ECDSAPubkey is the sender's compressed secp256k1 key; optional.
	ECDSAPubkey []byte
	// KeyType is "hybrid" for a classical plus post-quantum account.
	KeyType string
	// ProofOfPossession is the key's own signature over
	// "qorechain-pqc-pop-v1|<chainId>|<algorithmId>|<sender>|<hex(public key)>".
	ProofOfPossession []byte
}

func (MsgRegisterPQCKeyV2) TypeURL() string { return TypeURLMsgRegisterPQCKeyV2 }

func (m MsgRegisterPQCKeyV2) Marshal() []byte {
	w := &protoWriter{}
	w.writeString(1, m.Sender)
	w.writeBytes(2, m.PublicKey)
	w.writeUint64(3, uint64(m.AlgorithmID))
	w.writeBytes(4, m.ECDSAPubkey)
	w.writeString(5, m.KeyType)
	w.writeBytes(6, m.ProofOfPossession)
	return w.bytes()
}

// readSingleUint64 reads field 1 (varint) of a one-field response.
func readSingleUint64(b []byte) (uint64, error) {
	fields, err := readProtoFields(b)
	if err != nil {
		return 0, err
	}
	var v uint64
	for _, f := range fields {
		if f.num == 1 && f.wire == wireVarint {
			v = f.varint
		}
	}
	return v, nil
}

// --- builders ---

// SetVerificationKeyInput builds a MsgSetVerificationKey.
type SetVerificationKeyInput struct {
	Creator  string
	RollupID string
	// VerificationKey is a Groth16 BLS12-381 verifying key, gnark binary
	// encoding, four public inputs.
	VerificationKey []byte
	// ProofSystem is "snark"; empty keeps the rollup's proof system. "stark" is
	// refused from chain v3.2.8.
	ProofSystem string
}

// SetVerificationKeyMsg builds a MsgSetVerificationKey from input.
func SetVerificationKeyMsg(in SetVerificationKeyInput) MsgSetVerificationKey {
	return MsgSetVerificationKey(in)
}

// UpdateVerificationKeyInput builds a MsgUpdateVerificationKey.
type UpdateVerificationKeyInput struct {
	Authority       string
	RollupID        string
	VerificationKey []byte
	ProofSystem     string
}

// UpdateVerificationKeyMsg builds a MsgUpdateVerificationKey. Governance only:
// put it in a proposal; Authority is the gov module account.
func UpdateVerificationKeyMsg(in UpdateVerificationKeyInput) MsgUpdateVerificationKey {
	return MsgUpdateVerificationKey(in)
}

// PostRollupDataInput builds a MsgPostRollupData.
type PostRollupDataInput struct {
	Poster   string
	RollupID string
	Data     []byte
}

// PostRollupDataMsg builds a MsgPostRollupData from input.
func PostRollupDataMsg(in PostRollupDataInput) MsgPostRollupData {
	return MsgPostRollupData(in)
}

// SetRollupSequencingInput builds a MsgSetRollupSequencing.
type SetRollupSequencingInput struct {
	Authority string
	RollupID  string
	// Sequencing is "based" or "".
	Sequencing string
}

// SetRollupSequencingMsg builds a MsgSetRollupSequencing. Governance only.
func SetRollupSequencingMsg(in SetRollupSequencingInput) MsgSetRollupSequencing {
	return MsgSetRollupSequencing(in)
}

// DepositToRollupInput builds a MsgDepositToRollup.
type DepositToRollupInput struct {
	Depositor string
	RollupID  string
	// Account is the 32-byte qledger-v1 account id to credit.
	Account []byte
	Amount  uint64
}

// DepositToRollupMsg builds a MsgDepositToRollup from input.
func DepositToRollupMsg(in DepositToRollupInput) MsgDepositToRollup {
	return MsgDepositToRollup(in)
}

// BondRollupSubmitterInput builds a MsgBondRollupSubmitter.
type BondRollupSubmitterInput struct {
	Submitter string
	RollupID  string
	Amount    uint64
}

// BondRollupSubmitterMsg builds a MsgBondRollupSubmitter from input.
func BondRollupSubmitterMsg(in BondRollupSubmitterInput) MsgBondRollupSubmitter {
	return MsgBondRollupSubmitter(in)
}

// UnbondRollupSubmitterInput builds a MsgUnbondRollupSubmitter.
type UnbondRollupSubmitterInput struct {
	Submitter string
	RollupID  string
}

// UnbondRollupSubmitterMsg builds a MsgUnbondRollupSubmitter from input.
func UnbondRollupSubmitterMsg(in UnbondRollupSubmitterInput) MsgUnbondRollupSubmitter {
	return MsgUnbondRollupSubmitter(in)
}

// SetRollupMembersInput builds a MsgSetRollupMembers.
type SetRollupMembersInput struct {
	Creator  string
	RollupID string
	Members  []string
}

// SetRollupMembersMsg builds a MsgSetRollupMembers from input. The member list
// is copied.
func SetRollupMembersMsg(in SetRollupMembersInput) MsgSetRollupMembers {
	return MsgSetRollupMembers{
		Creator:  in.Creator,
		RollupID: in.RollupID,
		Members:  append([]string(nil), in.Members...),
	}
}

// RegisterKEMKeyInput builds a MsgRegisterKEMKey.
type RegisterKEMKeyInput struct {
	Sender    string
	PublicKey []byte
	// AlgorithmID defaults to MlKem1024AlgorithmID (2) when zero.
	AlgorithmID uint32
}

// RegisterKEMKeyMsg builds a MsgRegisterKEMKey, defaulting the algorithm to
// ML-KEM-1024.
func RegisterKEMKeyMsg(in RegisterKEMKeyInput) MsgRegisterKEMKey {
	alg := in.AlgorithmID
	if alg == 0 {
		alg = MlKem1024AlgorithmID
	}
	return MsgRegisterKEMKey{Sender: in.Sender, AlgorithmID: alg, PublicKey: in.PublicKey}
}

// --- client-side checks the chain would make after the fee is paid ---

// setVerificationKeyError refuses a paused proof system.
func setVerificationKeyError(proofSystem string) string {
	if proofSystem != "" && contains(PausedProofSystems, ProofSystem(proofSystem)) {
		return "STARK keys are refused by the chain from v3.2.8; register a snark (Groth16) key"
	}
	return ""
}

// postRollupDataError refuses an empty post.
func postRollupDataError(data []byte) string {
	if len(data) == 0 {
		return "data cannot be empty"
	}
	return ""
}

// depositToRollupError checks the account id and the minimum deposit.
func depositToRollupError(account []byte, amount uint64) string {
	if len(account) != 32 || isAllZero(account) {
		return "account must be a non-zero 32-byte qledger-v1 account id"
	}
	if amount < MinRollupDepositUqor {
		return fmt.Sprintf("a deposit is at least %d uqor (1 QOR)", MinRollupDepositUqor)
	}
	return ""
}

// bondRollupSubmitterError refuses a zero bond.
func bondRollupSubmitterError(amount uint64) string {
	if amount == 0 {
		return "amount must be positive"
	}
	return ""
}

// setRollupMembersError checks the member count and uniqueness.
func setRollupMembersError(members []string) string {
	if len(members) == 0 || len(members) > MaxRollupMembers {
		return fmt.Sprintf("a private rollup has 1 to %d members", MaxRollupMembers)
	}
	seen := make(map[string]struct{}, len(members))
	for _, m := range members {
		if _, dup := seen[m]; dup {
			return "a member is listed twice"
		}
		seen[m] = struct{}{}
	}
	return ""
}

// registerKEMKeyError requires a 1568-byte ML-KEM-1024 encapsulation key.
func registerKEMKeyError(publicKey []byte) string {
	if len(publicKey) != EncapsulationKeySize {
		return fmt.Sprintf("an ML-KEM-1024 key is %d bytes, got %d", EncapsulationKeySize, len(publicKey))
	}
	return ""
}

func isAllZero(b []byte) bool {
	for _, x := range b {
		if x != 0 {
			return false
		}
	}
	return true
}
