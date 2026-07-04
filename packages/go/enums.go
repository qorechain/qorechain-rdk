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

// VmType is the execution environment the rollup exposes.
//
//   - "evm"    -- Ethereum/Solidity.
//   - "native" -- the QoreChain Native runtime (Wasm smart contracts).
//   - "svm"    -- the Solana VM.
//   - "custom" -- an application-defined VM.
//
// "cosmwasm" is accepted as a legacy alias of "native" and is what both map to
// on the wire (the network, explorer, and dashboard use "cosmwasm"). Do not
// localize or re-case these values.
type VmType string

const (
	VmEVM      VmType = "evm"
	VmNative   VmType = "native"
	VmSVM      VmType = "svm"
	VmCustom   VmType = "custom"
	VmCosmWasm VmType = "cosmwasm"
)

// VmTypes enumerates the advertised VmType values. "native" is the QoreChain
// Native runtime; the "cosmwasm" legacy alias is accepted (see IsVMType) but
// deliberately kept out of the advertised list.
var VmTypes = []VmType{
	VmEVM,
	VmNative,
	VmSVM,
	VmCustom,
}

// acceptedVMTypes is the set of VM types IsVMType accepts: the four advertised
// values plus the "cosmwasm" legacy alias.
var acceptedVMTypes = map[string]struct{}{
	string(VmEVM):      {},
	string(VmNative):   {},
	string(VmSVM):      {},
	string(VmCustom):   {},
	string(VmCosmWasm): {},
}

// IsVMType reports whether value is a VM type the RDK accepts (the four
// advertised values plus the "cosmwasm" legacy alias).
func IsVMType(value string) bool {
	_, ok := acceptedVMTypes[value]
	return ok
}

// VMTypeWireValue returns the on-chain wire value for a VM type. The QoreChain
// Native runtime ("native") is transmitted as "cosmwasm" for consistency with
// the network, explorer, and dashboard; all other values pass through
// unchanged. The wire value is never "native".
func VMTypeWireValue(vmType string) string {
	if vmType == string(VmNative) {
		return string(VmCosmWasm)
	}
	return vmType
}

// VMTypeLabel returns a human-readable label for a VM type. The Wasm runtime
// (native/cosmwasm) reads as "QoreChain Native".
func VMTypeLabel(vmType string) string {
	switch vmType {
	case string(VmNative), string(VmCosmWasm):
		return "QoreChain Native"
	case string(VmEVM):
		return "EVM"
	case string(VmSVM):
		return "SVM"
	case string(VmCustom):
		return "Custom"
	default:
		return vmType
	}
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
