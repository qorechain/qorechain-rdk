package rdk

import (
	"fmt"
	"regexp"
	"strings"
)

// SequencerParams holds mode-specific sequencer parameters. Which fields apply
// depends on the sequencer mode: "dedicated" uses SequencerAddress, "shared"
// uses SharedSetMinSize, and "based" uses InclusionDelay / PriorityFeeShare.
type SequencerParams struct {
	// SequencerAddress is the operator address that sequences a dedicated rollup.
	SequencerAddress string `json:"sequencerAddress,omitempty"`
	// SharedSetMinSize is the minimum size of the shared sequencer set.
	SharedSetMinSize *int `json:"sharedSetMinSize,omitempty"`
	// InclusionDelay is the blocks of inclusion delay for host-chain proposers.
	InclusionDelay *int `json:"inclusionDelay,omitempty"`
	// PriorityFeeShare is the share of priority fees routed to proposers, as a
	// decimal string.
	PriorityFeeShare string `json:"priorityFeeShare,omitempty"`
}

// RollupConfig is a fully resolved rollup configuration.
//
// On creation the chain derives a rollup's settlement, sequencing, data
// availability, gas, and timing from its Profile (and VmType). This struct
// captures the resolved configuration for client-side validation, display, and
// to build a create message. Field overrides beyond Profile and VmType are used
// for local validation and clarity; the authoritative configuration is whatever
// the chain records for the chosen profile.
type RollupConfig struct {
	// RollupID is the unique rollup identifier.
	RollupID string `json:"rollupId"`
	// Profile is the preset profile this configuration is based on.
	Profile Profile `json:"profile"`
	// Settlement is the settlement paradigm.
	Settlement SettlementParadigm `json:"settlement"`
	// Sequencer is the sequencer mode.
	Sequencer SequencerMode `json:"sequencer"`
	// SequencerParams holds mode-specific sequencer parameters.
	SequencerParams *SequencerParams `json:"sequencerParams,omitempty"`
	// DA is the data-availability backend.
	DA DABackend `json:"da"`
	// ProofSystem is the proof system (must be compatible with Settlement).
	ProofSystem ProofSystem `json:"proofSystem"`
	// GasModel is the gas / fee model.
	GasModel GasModel `json:"gasModel"`
	// VmType is the execution environment.
	VmType VmType `json:"vmType"`
	// BlockTimeMs is the target block time, in milliseconds.
	BlockTimeMs int `json:"blockTimeMs"`
	// MaxTxPerBlock is the maximum transactions per rollup block.
	MaxTxPerBlock int `json:"maxTxPerBlock"`
	// ChallengeWindowSecs is the optimistic challenge window, in seconds. Zero
	// means unset.
	ChallengeWindowSecs int `json:"challengeWindowSecs,omitempty"`
	// ChallengeBondUqor is the optimistic challenge bond, in uqor.
	ChallengeBondUqor string `json:"challengeBondUqor,omitempty"`
	// MaxDaBlobSize is the maximum DA blob size, in bytes. Zero means unset.
	MaxDaBlobSize int `json:"maxDaBlobSize,omitempty"`
	// StakeAmountUqor is the stake committed at creation, in uqor. Required to
	// build a create message.
	StakeAmountUqor string `json:"stakeAmountUqor,omitempty"`
}

// CreateRollupMsgInput holds the inputs for an on-chain MsgCreateRollup, as the
// kit submits them.
type CreateRollupMsgInput struct {
	Creator     string
	RollupID    string
	Profile     Profile
	VmType      VmType
	StakeAmount string
}

// SettlementProofMatrix is the settlement -> proof-system compatibility matrix
// enforced by the chain:
//
//   - optimistic -> fraud
//   - zk         -> snark | stark
//   - based      -> none
//   - sovereign  -> none
var SettlementProofMatrix = map[SettlementParadigm][]ProofSystem{
	SettlementOptimistic: {ProofFraud},
	SettlementZK:         {ProofSnark, ProofStark},
	SettlementBased:      {ProofNone},
	SettlementSovereign:  {ProofNone},
}

// ValidProofSystems returns the proof systems valid for a settlement paradigm.
func ValidProofSystems(settlement SettlementParadigm) []ProofSystem {
	return SettlementProofMatrix[settlement]
}

// IsProofCompatible reports whether a proof system is compatible with a
// settlement paradigm.
func IsProofCompatible(settlement SettlementParadigm, proof ProofSystem) bool {
	for _, p := range SettlementProofMatrix[settlement] {
		if p == proof {
			return true
		}
	}
	return false
}

// RequiresBasedSequencer reports whether a settlement paradigm requires the
// "based" sequencer mode. Only "based" settlement carries this constraint.
func RequiresBasedSequencer(settlement SettlementParadigm) bool {
	return settlement == SettlementBased
}

// ValidationResult is the outcome of validating a RollupConfig.
type ValidationResult struct {
	// Valid is true when there are no errors (warnings do not affect validity).
	Valid bool
	// Errors are hard failures that block submission.
	Errors []string
	// Warnings are non-fatal notices (e.g. selecting a not-yet-active DA backend).
	Warnings []string
}

// RollupConfigError is returned when a rollup configuration fails validation.
type RollupConfigError struct {
	// Errors are the individual validation failures.
	Errors []string
}

func (e *RollupConfigError) Error() string {
	return "Invalid rollup configuration:\n- " + strings.Join(e.Errors, "\n- ")
}

var positiveIntegerStringRe = regexp.MustCompile(`^[1-9][0-9]*$`)

func isPositiveIntegerString(value string) bool {
	return positiveIntegerStringRe.MatchString(value)
}

func contains[T comparable](slice []T, v T) bool {
	for _, s := range slice {
		if s == v {
			return true
		}
	}
	return false
}

// ValidateRollupConfig validates a rollup configuration against the on-chain
// rules: the settlement -> proof compatibility matrix, the based-settlement =>
// based-sequencer constraint, the closed value sets, and basic field sanity.
//
// It returns a structured result; callers that prefer to fail fast can use
// AssertValidRollupConfig.
func ValidateRollupConfig(config RollupConfig) ValidationResult {
	errs := []string{}
	warnings := []string{}

	if strings.TrimSpace(config.RollupID) == "" {
		errs = append(errs, "rollupId must be a non-empty string")
	}

	if !contains(SettlementParadigms, config.Settlement) {
		errs = append(errs, fmt.Sprintf("settlement %q is not a valid settlement paradigm", config.Settlement))
	}
	if !contains(SequencerModes, config.Sequencer) {
		errs = append(errs, fmt.Sprintf("sequencer %q is not a valid sequencer mode", config.Sequencer))
	}
	if !contains(ProofSystems, config.ProofSystem) {
		errs = append(errs, fmt.Sprintf("proofSystem %q is not a valid proof system", config.ProofSystem))
	}
	if !contains(DABackends, config.DA) {
		errs = append(errs, fmt.Sprintf("da %q is not a valid data-availability backend", config.DA))
	}
	if !contains(GasModels, config.GasModel) {
		errs = append(errs, fmt.Sprintf("gasModel %q is not a valid gas model", config.GasModel))
	}
	if !contains(VmTypes, config.VmType) {
		errs = append(errs, fmt.Sprintf("vmType %q is not a valid VM type", config.VmType))
	}

	// Compatibility matrix (only meaningful once both values are valid).
	if contains(SettlementParadigms, config.Settlement) &&
		contains(ProofSystems, config.ProofSystem) &&
		!IsProofCompatible(config.Settlement, config.ProofSystem) {
		valid := ValidProofSystems(config.Settlement)
		names := make([]string, len(valid))
		for i, p := range valid {
			names[i] = string(p)
		}
		errs = append(errs, fmt.Sprintf(
			"proof system %q is not compatible with %q settlement (expected one of: %s)",
			config.ProofSystem, config.Settlement, strings.Join(names, ", "),
		))
	}

	// Based settlement requires the based sequencer mode.
	if RequiresBasedSequencer(config.Settlement) && config.Sequencer != SequencerBased {
		errs = append(errs, `based settlement requires the "based" sequencer mode`)
	}

	if config.BlockTimeMs <= 0 {
		errs = append(errs, "blockTimeMs must be a positive integer")
	}
	if config.MaxTxPerBlock <= 0 {
		errs = append(errs, "maxTxPerBlock must be a positive integer")
	}

	if config.StakeAmountUqor != "" && !isPositiveIntegerString(config.StakeAmountUqor) {
		errs = append(errs, "stakeAmountUqor must be a positive integer string (base uqor)")
	}
	if config.ChallengeWindowSecs < 0 {
		errs = append(errs, "challengeWindowSecs must be a positive integer")
	}
	if config.MaxDaBlobSize < 0 {
		errs = append(errs, "maxDaBlobSize must be a positive integer (bytes)")
	}

	// Celestia is a selectable but not-yet-active backend on the network.
	if config.DA == DACelestia || config.DA == DABoth {
		warnings = append(warnings,
			"Celestia data availability is selectable but not yet active on the network; "+
				"batches targeting it will not be served until it is enabled.")
	}

	return ValidationResult{Valid: len(errs) == 0, Errors: errs, Warnings: warnings}
}

// AssertValidRollupConfig validates a configuration and returns a
// *RollupConfigError on any error.
func AssertValidRollupConfig(config RollupConfig) error {
	result := ValidateRollupConfig(config)
	if !result.Valid {
		return &RollupConfigError{Errors: result.Errors}
	}
	return nil
}
