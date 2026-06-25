package rdk

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// golden mirrors the testdata/golden.json fixture produced by the TypeScript
// reference. All cross-language assertions compare against it.
type golden struct {
	Mnemonic      string `json:"mnemonic"`
	NativeAddress string `json:"nativeAddress"`
	PrivateKeyHex string `json:"privateKeyHex"`
	Denom         struct {
		QorToUqor15   string `json:"qorToUqor_1_5"`
		UqorToQor1e10 string `json:"uqorToQor_1e10"`
		QorToUqor000  string `json:"qorToUqor_0_000001"`
	} `json:"denom"`
	Economics struct {
		StakeUqor         string `json:"stakeUqor"`
		BurnUqor          string `json:"burnUqor"`
		NetStakeUqor      string `json:"netStakeUqor"`
		TotalRequiredUqor string `json:"totalRequiredUqor"`
		BurnRate          string `json:"burnRate"`
	} `json:"economics"`
	Merkle struct {
		LeavesHex           []string `json:"leavesHex"`
		Root                string   `json:"root"`
		ProofIndex1Siblings []string `json:"proofIndex1Siblings"`
	} `json:"merkle"`
	MsgProtoHex    map[string]string          `json:"msgProtoHex"`
	PresetDefaults map[string]json.RawMessage `json:"presetDefaults"`
}

func loadGolden(t *testing.T) golden {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "golden.json"))
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	var g golden
	if err := json.Unmarshal(data, &g); err != nil {
		t.Fatalf("parse golden: %v", err)
	}
	return g
}
