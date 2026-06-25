package rdk

import (
	"strings"
	"testing"
)

func TestSettlementProofMatrix(t *testing.T) {
	cases := []struct {
		settlement SettlementParadigm
		proof      ProofSystem
		want       bool
	}{
		{SettlementOptimistic, ProofFraud, true},
		{SettlementOptimistic, ProofSnark, false},
		{SettlementZK, ProofSnark, true},
		{SettlementZK, ProofStark, true},
		{SettlementZK, ProofFraud, false},
		{SettlementBased, ProofNone, true},
		{SettlementBased, ProofSnark, false},
		{SettlementSovereign, ProofNone, true},
	}
	for _, c := range cases {
		if got := IsProofCompatible(c.settlement, c.proof); got != c.want {
			t.Errorf("IsProofCompatible(%s,%s)=%v want %v", c.settlement, c.proof, got, c.want)
		}
	}
	if !RequiresBasedSequencer(SettlementBased) {
		t.Error("based settlement should require based sequencer")
	}
	if RequiresBasedSequencer(SettlementZK) {
		t.Error("zk settlement should not require based sequencer")
	}
}

func TestValidateRollupConfig_Valid(t *testing.T) {
	cfg, err := PresetDefi().SetRollupID("my-rollup").Build()
	if err != nil {
		t.Fatalf("defi preset should build: %v", err)
	}
	r := ValidateRollupConfig(cfg)
	if !r.Valid || len(r.Errors) != 0 {
		t.Errorf("expected valid, got %+v", r)
	}
	if len(r.Warnings) != 0 {
		t.Errorf("defi (native DA) should have no warnings, got %v", r.Warnings)
	}
}

func TestValidateRollupConfig_MatrixError(t *testing.T) {
	cfg := RollupConfig{
		RollupID: "r", Profile: ProfileCustom,
		Settlement: SettlementZK, Sequencer: SequencerDedicated,
		DA: DANative, ProofSystem: ProofFraud, GasModel: GasStandard,
		VmType: VmEVM, BlockTimeMs: 1000, MaxTxPerBlock: 1000,
	}
	r := ValidateRollupConfig(cfg)
	if r.Valid {
		t.Fatal("zk + fraud should be invalid")
	}
	found := false
	for _, e := range r.Errors {
		if e == `proof system "fraud" is not compatible with "zk" settlement (expected one of: snark, stark)` {
			found = true
		}
	}
	if !found {
		t.Errorf("missing matrix error, got %v", r.Errors)
	}
}

func TestValidateRollupConfig_BasedSequencerRequired(t *testing.T) {
	cfg := RollupConfig{
		RollupID: "r", Profile: ProfileEnterprise,
		Settlement: SettlementBased, Sequencer: SequencerDedicated,
		DA: DANative, ProofSystem: ProofNone, GasModel: GasFlat,
		VmType: VmEVM, BlockTimeMs: 1000, MaxTxPerBlock: 1000,
	}
	r := ValidateRollupConfig(cfg)
	if r.Valid {
		t.Fatal("based settlement with dedicated sequencer should be invalid")
	}
}

func TestValidateRollupConfig_CelestiaWarning(t *testing.T) {
	cfg := PresetNFT().SetRollupID("nft-1").Get()
	r := ValidateRollupConfig(cfg)
	if !r.Valid {
		t.Fatalf("nft preset should be valid, got %v", r.Errors)
	}
	if len(r.Warnings) == 0 {
		t.Error("nft preset (celestia DA) should emit a warning")
	}
}

func TestValidateRollupConfig_FieldSanity(t *testing.T) {
	cfg := RollupConfig{
		RollupID: "", Settlement: SettlementOptimistic, Sequencer: SequencerDedicated,
		DA: DANative, ProofSystem: ProofFraud, GasModel: GasStandard, VmType: VmEVM,
		BlockTimeMs: 0, MaxTxPerBlock: -1, StakeAmountUqor: "abc",
	}
	r := ValidateRollupConfig(cfg)
	if r.Valid {
		t.Fatal("expected invalid")
	}
	wantSubstrings := []string{"rollupId", "blockTimeMs", "maxTxPerBlock", "stakeAmountUqor"}
	for _, sub := range wantSubstrings {
		found := false
		for _, e := range r.Errors {
			if strings.Contains(e, sub) {
				found = true
			}
		}
		if !found {
			t.Errorf("expected an error mentioning %q, got %v", sub, r.Errors)
		}
	}
}

func TestBuilderToCreateMsg(t *testing.T) {
	b := PresetDefi().SetRollupID("r1").SetStakeAmountUqor("10000000000")
	msg, err := b.ToCreateMsg("qor1creator", "")
	if err != nil {
		t.Fatal(err)
	}
	if msg.Creator != "qor1creator" || msg.RollupID != "r1" || msg.Profile != ProfileDefi ||
		msg.VmType != VmEVM || msg.StakeAmount != "10000000000" {
		t.Errorf("unexpected create msg: %+v", msg)
	}

	if _, err := PresetDefi().SetRollupID("r1").ToCreateMsg("qor1c", ""); err == nil {
		t.Error("expected error when no stake amount supplied")
	}
}
