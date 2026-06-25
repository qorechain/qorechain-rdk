package rdk

import "testing"

func TestDeriveNativeAccountGolden(t *testing.T) {
	g := loadGolden(t)
	acc, err := DeriveNativeAccount(g.Mnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}
	if acc.Address != g.NativeAddress {
		t.Errorf("address: got %s want %s", acc.Address, g.NativeAddress)
	}
	if BytesToHex(acc.PrivateKey) != g.PrivateKeyHex {
		t.Errorf("privateKey: got %s want %s", BytesToHex(acc.PrivateKey), g.PrivateKeyHex)
	}
	if len(acc.PublicKey) != 33 {
		t.Errorf("expected 33-byte compressed pubkey, got %d", len(acc.PublicKey))
	}
}

func TestAccountFromPrivateKeyMatchesDerivation(t *testing.T) {
	g := loadGolden(t)
	priv, err := HexToBytes(g.PrivateKeyHex)
	if err != nil {
		t.Fatal(err)
	}
	acc, err := AccountFromPrivateKey(priv, "qor")
	if err != nil {
		t.Fatal(err)
	}
	if acc.Address != g.NativeAddress {
		t.Errorf("address: got %s want %s", acc.Address, g.NativeAddress)
	}
}

func TestMnemonicValidation(t *testing.T) {
	if !ValidateMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about") {
		t.Error("valid mnemonic rejected")
	}
	if ValidateMnemonic("not a real mnemonic phrase at all") {
		t.Error("invalid mnemonic accepted")
	}
	m, err := GenerateMnemonic(128)
	if err != nil {
		t.Fatal(err)
	}
	if !ValidateMnemonic(m) {
		t.Error("generated mnemonic should validate")
	}
}
