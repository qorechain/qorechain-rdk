package rdk

// PresetDefaults are the documented default fields for the five preset profiles,
// excluding the per-user RollupID and stake.
//
// These mirror the network's published profile table. The proof system for each
// profile is the one its settlement paradigm requires (optimistic -> fraud,
// zk -> snark, based -> none).
var PresetDefaults = map[Profile]RollupConfig{
	ProfileDefi: {
		Profile:       ProfileDefi,
		Settlement:    SettlementZK,
		Sequencer:     SequencerDedicated,
		DA:            DANative,
		ProofSystem:   ProofSnark,
		GasModel:      GasEIP1559,
		VmType:        VmEVM,
		BlockTimeMs:   500,
		MaxTxPerBlock: 10000,
	},
	ProfileGaming: {
		Profile:       ProfileGaming,
		Settlement:    SettlementBased,
		Sequencer:     SequencerBased,
		DA:            DANative,
		ProofSystem:   ProofNone,
		GasModel:      GasFlat,
		VmType:        VmCustom,
		BlockTimeMs:   200,
		MaxTxPerBlock: 50000,
	},
	ProfileNFT: {
		Profile:             ProfileNFT,
		Settlement:          SettlementOptimistic,
		Sequencer:           SequencerDedicated,
		DA:                  DACelestia,
		ProofSystem:         ProofFraud,
		GasModel:            GasStandard,
		VmType:              VmCosmWasm,
		BlockTimeMs:         2000,
		MaxTxPerBlock:       5000,
		ChallengeWindowSecs: DefaultChallengeWindowSecs,
		ChallengeBondUqor:   DefaultChallengeBondUqor,
	},
	ProfileEnterprise: {
		Profile:       ProfileEnterprise,
		Settlement:    SettlementBased,
		Sequencer:     SequencerBased,
		DA:            DANative,
		ProofSystem:   ProofNone,
		GasModel:      GasSubsidized,
		VmType:        VmEVM,
		BlockTimeMs:   1000,
		MaxTxPerBlock: 20000,
	},
	ProfileCustom: {
		Profile:             ProfileCustom,
		Settlement:          SettlementOptimistic,
		Sequencer:           SequencerDedicated,
		DA:                  DANative,
		ProofSystem:         ProofFraud,
		GasModel:            GasStandard,
		VmType:              VmEVM,
		BlockTimeMs:         1000,
		MaxTxPerBlock:       10000,
		ChallengeWindowSecs: DefaultChallengeWindowSecs,
		ChallengeBondUqor:   DefaultChallengeBondUqor,
	},
}

// Preset returns a RollupConfigBuilder for a profile, pre-filled with the
// profile's documented defaults. The Profile field always reflects the chosen
// preset (it is the wire value sent in the create message).
func Preset(name Profile) *RollupConfigBuilder {
	base, ok := PresetDefaults[name]
	if !ok {
		base = RollupConfig{Profile: name}
	}
	cfg := cloneConfig(base)
	cfg.Profile = name
	return NewRollupConfigBuilder(cfg)
}

// PresetDefi returns a builder pre-filled with the defi profile defaults.
func PresetDefi() *RollupConfigBuilder { return Preset(ProfileDefi) }

// PresetGaming returns a builder pre-filled with the gaming profile defaults.
func PresetGaming() *RollupConfigBuilder { return Preset(ProfileGaming) }

// PresetNFT returns a builder pre-filled with the nft profile defaults.
func PresetNFT() *RollupConfigBuilder { return Preset(ProfileNFT) }

// PresetEnterprise returns a builder pre-filled with the enterprise profile
// defaults.
func PresetEnterprise() *RollupConfigBuilder { return Preset(ProfileEnterprise) }

// PresetCustom returns a builder pre-filled with the custom profile defaults.
func PresetCustom() *RollupConfigBuilder { return Preset(ProfileCustom) }
