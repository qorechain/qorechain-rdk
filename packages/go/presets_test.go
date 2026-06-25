package rdk

import (
	"encoding/json"
	"testing"
)

// goldenPreset is the JSON shape of each preset in the golden fixture.
type goldenPreset struct {
	Profile             string `json:"profile"`
	Settlement          string `json:"settlement"`
	Sequencer           string `json:"sequencer"`
	DA                  string `json:"da"`
	ProofSystem         string `json:"proofSystem"`
	GasModel            string `json:"gasModel"`
	VmType              string `json:"vmType"`
	BlockTimeMs         int    `json:"blockTimeMs"`
	MaxTxPerBlock       int    `json:"maxTxPerBlock"`
	ChallengeWindowSecs int    `json:"challengeWindowSecs"`
	ChallengeBondUqor   string `json:"challengeBondUqor"`
}

func TestPresetsMatchGolden(t *testing.T) {
	g := loadGolden(t)
	for name, raw := range g.PresetDefaults {
		var want goldenPreset
		if err := json.Unmarshal(raw, &want); err != nil {
			t.Fatalf("parse golden preset %s: %v", name, err)
		}
		got := PresetDefaults[Profile(name)]
		if string(got.Profile) != want.Profile {
			t.Errorf("%s profile: got %s want %s", name, got.Profile, want.Profile)
		}
		if string(got.Settlement) != want.Settlement {
			t.Errorf("%s settlement: got %s want %s", name, got.Settlement, want.Settlement)
		}
		if string(got.Sequencer) != want.Sequencer {
			t.Errorf("%s sequencer: got %s want %s", name, got.Sequencer, want.Sequencer)
		}
		if string(got.DA) != want.DA {
			t.Errorf("%s da: got %s want %s", name, got.DA, want.DA)
		}
		if string(got.ProofSystem) != want.ProofSystem {
			t.Errorf("%s proofSystem: got %s want %s", name, got.ProofSystem, want.ProofSystem)
		}
		if string(got.GasModel) != want.GasModel {
			t.Errorf("%s gasModel: got %s want %s", name, got.GasModel, want.GasModel)
		}
		if string(got.VmType) != want.VmType {
			t.Errorf("%s vmType: got %s want %s", name, got.VmType, want.VmType)
		}
		if got.BlockTimeMs != want.BlockTimeMs {
			t.Errorf("%s blockTimeMs: got %d want %d", name, got.BlockTimeMs, want.BlockTimeMs)
		}
		if got.MaxTxPerBlock != want.MaxTxPerBlock {
			t.Errorf("%s maxTxPerBlock: got %d want %d", name, got.MaxTxPerBlock, want.MaxTxPerBlock)
		}
		if got.ChallengeWindowSecs != want.ChallengeWindowSecs {
			t.Errorf("%s challengeWindowSecs: got %d want %d", name, got.ChallengeWindowSecs, want.ChallengeWindowSecs)
		}
		if got.ChallengeBondUqor != want.ChallengeBondUqor {
			t.Errorf("%s challengeBondUqor: got %q want %q", name, got.ChallengeBondUqor, want.ChallengeBondUqor)
		}
	}
}

func TestAllFivePresetsPresent(t *testing.T) {
	for _, p := range Profiles {
		if _, ok := PresetDefaults[p]; !ok {
			t.Errorf("missing preset %s", p)
		}
	}
	if len(PresetDefaults) != 5 {
		t.Errorf("expected 5 presets, got %d", len(PresetDefaults))
	}
}
