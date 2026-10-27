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
		Sha256Legacy        struct {
			Root                string   `json:"root"`
			ProofIndex1Siblings []string `json:"proofIndex1Siblings"`
		} `json:"sha256Legacy"`
	} `json:"merkle"`
	WithdrawalTree struct {
		ChainID     string `json:"chainId"`
		RollupID    string `json:"rollupId"`
		Denom       string `json:"denom"`
		Withdrawals []struct {
			Recipient string `json:"recipient"`
			Amount    uint64 `json:"amount"`
		} `json:"withdrawals"`
		V1 goldenWithdrawalTree `json:"v1"`
		V2 goldenWithdrawalTree `json:"v2"`
	} `json:"withdrawalTree"`
	DaBlob struct {
		DataUtf8   string `json:"dataUtf8"`
		Commitment string `json:"commitment"`
	} `json:"daBlob"`
	MsgProtoHex     map[string]string          `json:"msgProtoHex"`
	PresetDefaults  map[string]json.RawMessage `json:"presetDefaults"`
	AnchorSignBytes struct {
		LayerID          string `json:"layerId"`
		LayerHeight      uint64 `json:"layerHeight"`
		StateRoot        string `json:"stateRoot"`
		ValidatorSetHash string `json:"validatorSetHash"`
		ExpectedHex      string `json:"expectedHex"`
		ExpectedHexV1    string `json:"expectedHexV1"`
		V2               struct {
			Domain               string `json:"domain"`
			ChainID              string `json:"chainId"`
			LayerID              string `json:"layerId"`
			LayerHeight          uint64 `json:"layerHeight"`
			StateRoot            string `json:"stateRoot"`
			ValidatorSetHash     string `json:"validatorSetHash"`
			TransactionCount     uint64 `json:"transactionCount"`
			CompressedStateProof string `json:"compressedStateProof"`
			ExpectedHex          string `json:"expectedHex"`
		} `json:"v2"`
	} `json:"anchorSignBytes"`
	MldsaVector struct {
		Algorithm    string `json:"algorithm"`
		Note         string `json:"note"`
		MessageUtf8  string `json:"messageUtf8"`
		PublicKeyHex string `json:"publicKeyHex"`
		SignatureHex string `json:"signatureHex"`
	} `json:"mldsaVector"`
}

type goldenWithdrawalTree struct {
	Leaves []string   `json:"leaves"`
	Root   string     `json:"root"`
	Proofs [][]string `json:"proofs"`
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
