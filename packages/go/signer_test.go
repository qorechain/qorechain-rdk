package rdk

import "testing"

func TestSignerFromEnvMnemonic(t *testing.T) {
	g := loadGolden(t)
	acc, err, ok := SignerFromEnv(map[string]string{"QORE_MNEMONIC": g.Mnemonic}, "")
	if !ok {
		t.Fatal("expected a signer from QORE_MNEMONIC")
	}
	if err != nil {
		t.Fatal(err)
	}
	if acc.Address != g.NativeAddress {
		t.Errorf("address: got %s want %s", acc.Address, g.NativeAddress)
	}
}

func TestSignerFromEnvPrivateKeyHexPreferred(t *testing.T) {
	g := loadGolden(t)
	// When both are set, the hex private key wins; here it derives the same
	// golden account as the mnemonic.
	acc, err, ok := SignerFromEnv(map[string]string{
		"QORE_OPERATOR_PRIVATE_KEY_HEX": g.PrivateKeyHex,
		"QORE_MNEMONIC":                 "this would be ignored",
	}, "qor")
	if !ok || err != nil {
		t.Fatalf("expected signer, ok=%v err=%v", ok, err)
	}
	if acc.Address != g.NativeAddress {
		t.Errorf("address: got %s want %s", acc.Address, g.NativeAddress)
	}
}

func TestSignerFromEnvUnset(t *testing.T) {
	acc, err, ok := SignerFromEnv(map[string]string{}, "")
	if ok {
		t.Error("expected no signer when neither variable is set")
	}
	if err != nil {
		t.Errorf("expected nil error when unset, got %v", err)
	}
	if acc.Address != "" {
		t.Errorf("expected zero account, got %+v", acc)
	}
}

func TestSignerFromEnvInvalidHex(t *testing.T) {
	_, err, ok := SignerFromEnv(map[string]string{"QORE_OPERATOR_PRIVATE_KEY_HEX": "zzzz"}, "")
	if !ok {
		t.Error("a set-but-invalid key should still report ok=true")
	}
	if err == nil {
		t.Error("expected an error for invalid hex")
	}
}
