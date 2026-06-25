package rdk

import (
	"math/big"
	"testing"
)

func TestDenomGolden(t *testing.T) {
	g := loadGolden(t)
	if got, err := QorToUqor("1.5", 0); err != nil || got != g.Denom.QorToUqor15 {
		t.Errorf("QorToUqor(1.5)=%q,%v want %q", got, err, g.Denom.QorToUqor15)
	}
	if got, err := UqorToQor("10000000000", 0); err != nil || got != g.Denom.UqorToQor1e10 {
		t.Errorf("UqorToQor(1e10)=%q,%v want %q", got, err, g.Denom.UqorToQor1e10)
	}
	if got, err := QorToUqor("0.000001", 0); err != nil || got != g.Denom.QorToUqor000 {
		t.Errorf("QorToUqor(0.000001)=%q,%v want %q", got, err, g.Denom.QorToUqor000)
	}
}

func TestDenomRoundTripAndEdges(t *testing.T) {
	if got, _ := QorToUqor("0", 0); got != "0" {
		t.Errorf("QorToUqor(0)=%q", got)
	}
	if got, _ := UqorToQor("0", 0); got != "0" {
		t.Errorf("UqorToQor(0)=%q", got)
	}
	if got, _ := UqorToQor("1500000", 0); got != "1.5" {
		t.Errorf("UqorToQor(1500000)=%q want 1.5", got)
	}
	if _, err := QorToUqor("1.0000001", 0); err == nil {
		t.Error("expected error for too many fractional digits")
	}
	if _, err := QorToUqor("-1", 0); err == nil {
		t.Error("expected error for negative")
	}
	if _, err := UqorToQor("1.5", 0); err == nil {
		t.Error("expected error for non-integer uqor")
	}
}

func TestEconomicsGolden(t *testing.T) {
	g := loadGolden(t)
	cost, err := EstimateCreationCost(g.Economics.StakeUqor, "")
	if err != nil {
		t.Fatal(err)
	}
	if cost.StakeUqor != g.Economics.StakeUqor {
		t.Errorf("stake: got %s want %s", cost.StakeUqor, g.Economics.StakeUqor)
	}
	if cost.BurnUqor != g.Economics.BurnUqor {
		t.Errorf("burn: got %s want %s", cost.BurnUqor, g.Economics.BurnUqor)
	}
	if cost.NetStakeUqor != g.Economics.NetStakeUqor {
		t.Errorf("netStake: got %s want %s", cost.NetStakeUqor, g.Economics.NetStakeUqor)
	}
	if cost.TotalRequiredUqor != g.Economics.TotalRequiredUqor {
		t.Errorf("total: got %s want %s", cost.TotalRequiredUqor, g.Economics.TotalRequiredUqor)
	}
	if cost.BurnRate != g.Economics.BurnRate {
		t.Errorf("burnRate: got %s want %s", cost.BurnRate, g.Economics.BurnRate)
	}
}

func TestMulDecimalFloor(t *testing.T) {
	got, err := MulDecimalFloor(big.NewInt(10000000000), "0.01")
	if err != nil {
		t.Fatal(err)
	}
	if got.String() != "100000000" {
		t.Errorf("got %s want 100000000", got.String())
	}
	// flooring
	got2, _ := MulDecimalFloor(big.NewInt(7), "0.5")
	if got2.String() != "3" {
		t.Errorf("7*0.5 floored = %s want 3", got2.String())
	}
}

func TestBech32RoundTrip(t *testing.T) {
	g := loadGolden(t)
	hex, err := Bech32ToHex(g.NativeAddress)
	if err != nil {
		t.Fatal(err)
	}
	back, err := HexToBech32(hex, "qor")
	if err != nil {
		t.Fatal(err)
	}
	if back != g.NativeAddress {
		t.Errorf("round-trip: got %s want %s", back, g.NativeAddress)
	}
	prefix, err := Bech32Prefix(g.NativeAddress)
	if err != nil || prefix != "qor" {
		t.Errorf("prefix=%q,%v want qor", prefix, err)
	}
}

func TestHexBytesHelpers(t *testing.T) {
	b, err := HexToBytes("0x0a0b")
	if err != nil || len(b) != 2 || b[0] != 0x0a || b[1] != 0x0b {
		t.Errorf("HexToBytes failed: %v %v", b, err)
	}
	if BytesToHex([]byte{0xff, 0x00}) != "ff00" {
		t.Error("BytesToHex failed")
	}
	if _, err := HexToBytes("0xZZ"); err == nil {
		t.Error("expected error for invalid hex")
	}
}
