package rdk

import "testing"

func TestSignVerifyRoundtrip(t *testing.T) {
	g := loadGolden(t)
	acc, err := DeriveNativeAccount(g.Mnemonic, 0)
	if err != nil {
		t.Fatal(err)
	}

	msgs := []Msg{MsgCreateRollup{
		Creator: acc.Address, RollupID: "r1", Profile: "defi", VmType: "evm", StakeAmount: 10000000000,
	}}
	fee := Fee{Amount: []Coin{{Denom: "uqor", Amount: "2000"}}, GasLimit: 200000}

	signDoc := SignDocBytes(msgs, "", fee, acc.PublicKey, 0, "qorechain-diana", 0)
	sig := SignSignDoc(signDoc, acc.PrivateKey)
	if len(sig) != 64 {
		t.Fatalf("expected 64-byte signature, got %d", len(sig))
	}
	if !VerifySignature(signDoc, sig, acc.PublicKey) {
		t.Error("signature failed to verify against pubkey")
	}

	// A different message must not verify against the same signature.
	otherDoc := SignDocBytes(msgs, "tampered", fee, acc.PublicKey, 0, "qorechain-diana", 0)
	if VerifySignature(otherDoc, sig, acc.PublicKey) {
		t.Error("signature verified against a different sign doc")
	}
}

func TestSignTxProducesTxRaw(t *testing.T) {
	g := loadGolden(t)
	acc, _ := DeriveNativeAccount(g.Mnemonic, 0)
	msgs := []Msg{MsgPauseRollup{Creator: acc.Address, RollupID: "r1", Reason: "maintenance"}}
	fee := Fee{Amount: []Coin{{Denom: "uqor", Amount: "1000"}}, GasLimit: 100000}
	raw := SignTx(acc, msgs, "", fee, 5, "qorechain-vladi", 12)
	if len(raw) == 0 {
		t.Fatal("TxRaw should not be empty")
	}
	// TxRaw begins with field 1 (body_bytes), tag 0x0a.
	if raw[0] != 0x0a {
		t.Errorf("TxRaw should start with body_bytes field tag 0x0a, got %#x", raw[0])
	}
}

func TestEncodeAnyShape(t *testing.T) {
	any := encodeAny("/x.Y", []byte{0x01, 0x02})
	// field1 string "/x.Y": 0a 04 2f782e59 ; field2 bytes 0102: 12 02 0102
	want := "0a042f782e5912020102"
	if BytesToHex(any) != want {
		t.Errorf("encodeAny got %s want %s", BytesToHex(any), want)
	}
}
