package rdk

import "testing"

// TestVMTypeAdvertisedList mirrors ts/test/vmtype.test.ts: the advertised list
// carries "native", not the "cosmwasm" legacy alias.
func TestVMTypeAdvertisedList(t *testing.T) {
	hasNative := false
	hasCosmWasm := false
	for _, v := range VmTypes {
		if v == VmNative {
			hasNative = true
		}
		if v == VmCosmWasm {
			hasCosmWasm = true
		}
	}
	if !hasNative {
		t.Error("VmTypes should advertise native")
	}
	if hasCosmWasm {
		t.Error("VmTypes should not advertise the cosmwasm legacy alias")
	}
}

func TestIsVMType(t *testing.T) {
	for _, v := range []string{"native", "evm", "svm", "custom", "cosmwasm"} {
		if !IsVMType(v) {
			t.Errorf("IsVMType(%q) = false, want true", v)
		}
	}
	if IsVMType("wasm2") {
		t.Error(`IsVMType("wasm2") = true, want false`)
	}
}

func TestVMTypeWireValue(t *testing.T) {
	cases := map[string]string{
		"native":   "cosmwasm",
		"cosmwasm": "cosmwasm",
		"evm":      "evm",
		"svm":      "svm",
		"custom":   "custom",
	}
	for in, want := range cases {
		if got := VMTypeWireValue(in); got != want {
			t.Errorf("VMTypeWireValue(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestVMTypeLabel(t *testing.T) {
	cases := map[string]string{
		"native":   "QoreChain Native",
		"cosmwasm": "QoreChain Native",
		"evm":      "EVM",
		"svm":      "SVM",
		"custom":   "Custom",
	}
	for in, want := range cases {
		if got := VMTypeLabel(in); got != want {
			t.Errorf("VMTypeLabel(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestCreateRollupMsgWireValue: a create-rollup message built with vm_type
// "native" encodes "cosmwasm" on the wire.
func TestCreateRollupMsgWireValue(t *testing.T) {
	msg := CreateRollupMsg(CreateRollupInput{
		Creator:     "qor1creator",
		RollupID:    "r",
		Profile:     "nft",
		VmType:      "native",
		StakeAmount: 1,
	})
	if msg.VmType != "cosmwasm" {
		t.Errorf("create-rollup msg vmType = %q, want cosmwasm", msg.VmType)
	}
}

// TestNFTPresetUsesNative: the nft preset advertises native and validates.
func TestNFTPresetUsesNative(t *testing.T) {
	cfg := PresetNFT().SetRollupID("r").Get()
	if cfg.VmType != VmNative {
		t.Errorf("nft preset vmType = %q, want native", cfg.VmType)
	}
	if r := ValidateRollupConfig(cfg); !r.Valid {
		t.Errorf("nft preset should validate, got errors: %v", r.Errors)
	}
}
