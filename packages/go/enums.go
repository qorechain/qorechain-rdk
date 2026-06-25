package rdk

// The closed value sets accepted by the QoreChain rdk module. These mirror the
// on-chain rdk module exactly. The string values are the wire values the chain
// expects -- do not localize or re-case them.

// SettlementParadigm is how a rollup settles to the Main Chain.
type SettlementParadigm string

const (
	SettlementOptimistic SettlementParadigm = "optimistic"
	SettlementZK         SettlementParadigm = "zk"
	SettlementBased      SettlementParadigm = "based"
	SettlementSovereign  SettlementParadigm = "sovereign"
)

// SettlementParadigms enumerates every valid SettlementParadigm.
var SettlementParadigms = []SettlementParadigm{
	SettlementOptimistic,
	SettlementZK,
	SettlementBased,
	SettlementSovereign,
}

// SequencerMode is who orders the rollup's transactions.
type SequencerMode string

const (
	SequencerDedicated SequencerMode = "dedicated"
	SequencerShared    SequencerMode = "shared"
	SequencerBased     SequencerMode = "based"
)

// SequencerModes enumerates every valid SequencerMode.
var SequencerModes = []SequencerMode{
	SequencerDedicated,
	SequencerShared,
	SequencerBased,
}

// ProofSystem is the proof a settlement batch carries.
type ProofSystem string

const (
	ProofFraud ProofSystem = "fraud"
	ProofSnark ProofSystem = "snark"
	ProofStark ProofSystem = "stark"
	ProofNone  ProofSystem = "none"
)

// ProofSystems enumerates every valid ProofSystem.
var ProofSystems = []ProofSystem{
	ProofFraud,
	ProofSnark,
	ProofStark,
	ProofNone,
}

// DABackend is where rollup data is made available.
type DABackend string

const (
	DANative   DABackend = "native"
	DACelestia DABackend = "celestia"
	DABoth     DABackend = "both"
)

// DABackends enumerates every valid DABackend.
var DABackends = []DABackend{
	DANative,
	DACelestia,
	DABoth,
}

// GasModel is the fee model the rollup charges.
type GasModel string

const (
	GasStandard   GasModel = "standard"
	GasEIP1559    GasModel = "eip1559"
	GasFlat       GasModel = "flat"
	GasSubsidized GasModel = "subsidized"
)

// GasModels enumerates every valid GasModel.
var GasModels = []GasModel{
	GasStandard,
	GasEIP1559,
	GasFlat,
	GasSubsidized,
}

// VmType is the execution environment the rollup exposes. "custom" denotes an
// application-defined VM; the wire value may be any identifier the network
// recognizes.
type VmType string

const (
	VmEVM      VmType = "evm"
	VmCosmWasm VmType = "cosmwasm"
	VmSVM      VmType = "svm"
	VmCustom   VmType = "custom"
)

// VmTypes enumerates the well-known VmType values.
var VmTypes = []VmType{
	VmEVM,
	VmCosmWasm,
	VmSVM,
	VmCustom,
}

// RollupStatus is a rollup lifecycle state.
type RollupStatus string

const (
	RollupPending RollupStatus = "pending"
	RollupActive  RollupStatus = "active"
	RollupPaused  RollupStatus = "paused"
	RollupStopped RollupStatus = "stopped"
)

// RollupStatuses enumerates every valid RollupStatus.
var RollupStatuses = []RollupStatus{
	RollupPending,
	RollupActive,
	RollupPaused,
	RollupStopped,
}

// BatchStatus is a settlement-batch lifecycle state.
type BatchStatus string

const (
	BatchSubmitted  BatchStatus = "submitted"
	BatchChallenged BatchStatus = "challenged"
	BatchFinalized  BatchStatus = "finalized"
	BatchRejected   BatchStatus = "rejected"
)

// BatchStatuses enumerates every valid BatchStatus.
var BatchStatuses = []BatchStatus{
	BatchSubmitted,
	BatchChallenged,
	BatchFinalized,
	BatchRejected,
}

// Profile is one of the five preset profiles.
type Profile string

const (
	ProfileDefi       Profile = "defi"
	ProfileGaming     Profile = "gaming"
	ProfileNFT        Profile = "nft"
	ProfileEnterprise Profile = "enterprise"
	ProfileCustom     Profile = "custom"
)

// Profiles enumerates every preset Profile.
var Profiles = []Profile{
	ProfileDefi,
	ProfileGaming,
	ProfileNFT,
	ProfileEnterprise,
	ProfileCustom,
}
