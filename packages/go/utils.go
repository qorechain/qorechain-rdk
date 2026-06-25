package rdk

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// --- byte / hex helpers ---

// BytesToHex converts bytes to a lowercase hex string (no 0x prefix).
func BytesToHex(b []byte) string {
	return hex.EncodeToString(b)
}

var hexRe = regexp.MustCompile(`^[0-9a-fA-F]*$`)

// HexToBytes parses a hex string (with or without a 0x prefix) into bytes.
func HexToBytes(h string) ([]byte, error) {
	if strings.HasPrefix(h, "0x") || strings.HasPrefix(h, "0X") {
		h = h[2:]
	}
	if len(h)%2 != 0 || !hexRe.MatchString(h) {
		return nil, fmt.Errorf("invalid hex string: %q", h)
	}
	return hex.DecodeString(h)
}

// ToBytes coerces a hex string into bytes (it is the string overload of the TS
// toBytes helper).
func ToBytes(input string) ([]byte, error) {
	return HexToBytes(input)
}

// --- bech32 <-> hex helpers ---

// Bech32ToHex decodes a bech32 address to a 0x-prefixed hex string of its data
// bytes.
func Bech32ToHex(address string) (string, error) {
	_, data, err := bech32Decode(address)
	if err != nil {
		return "", err
	}
	return "0x" + BytesToHex(data), nil
}

// HexToBech32 encodes hex data bytes as a bech32 address with the given prefix.
// An empty prefix defaults to the account prefix.
func HexToBech32(h, prefix string) (string, error) {
	if prefix == "" {
		prefix = AccountPrefix
	}
	data, err := HexToBytes(h)
	if err != nil {
		return "", err
	}
	return bech32Encode(prefix, data)
}

// Bech32Prefix returns the human-readable prefix of a bech32 address.
func Bech32Prefix(address string) (string, error) {
	hrp, _, err := bech32Decode(address)
	return hrp, err
}

// --- denom conversion ---

var (
	qorAmountRe   = regexp.MustCompile(`^\d+(\.\d+)?$`)
	uqorIntegerRe = regexp.MustCompile(`^\d+$`)
	decimalRe     = regexp.MustCompile(`^\d+(\.\d+)?$`)
)

// QorToUqor converts a display amount (QOR) to base units (uqor) as an integer
// string. It uses integer/string math only (never floating point) so values are
// exact. The exponent defaults to DenomExponent when <= 0.
//
// It errors if the input is not a non-negative decimal or has more than exponent
// fractional digits.
func QorToUqor(amount string, exponent int) (string, error) {
	if exponent <= 0 {
		exponent = DenomExponent
	}
	s := strings.TrimSpace(amount)
	if !qorAmountRe.MatchString(s) {
		return "", fmt.Errorf("invalid QOR amount: %q", amount)
	}
	whole := s
	frac := ""
	if i := strings.IndexByte(s, '.'); i >= 0 {
		whole = s[:i]
		frac = s[i+1:]
	}
	if len(frac) > exponent {
		return "", fmt.Errorf("QOR amount %q has more than %d fractional digits", amount, exponent)
	}
	combined := whole + frac + strings.Repeat("0", exponent-len(frac))
	combined = strings.TrimLeft(combined, "0")
	if combined == "" {
		return "0", nil
	}
	return combined, nil
}

// UqorToQor converts base units (uqor) to a display amount (QOR), trimming
// trailing zeros. The exponent defaults to DenomExponent when <= 0.
//
// It errors if the input is not a non-negative integer.
func UqorToQor(amount string, exponent int) (string, error) {
	if exponent <= 0 {
		exponent = DenomExponent
	}
	t := strings.TrimSpace(amount)
	if !uqorIntegerRe.MatchString(t) {
		return "", fmt.Errorf("invalid uqor amount: %q", amount)
	}
	value, ok := new(big.Int).SetString(t, 10)
	if !ok {
		return "", fmt.Errorf("invalid uqor amount: %q", amount)
	}
	base := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(exponent)), nil)
	whole := new(big.Int)
	frac := new(big.Int)
	whole.QuoRem(value, base, frac)
	if frac.Sign() == 0 {
		return whole.String(), nil
	}
	fracStr := frac.String()
	fracStr = strings.Repeat("0", exponent-len(fracStr)) + fracStr
	fracStr = strings.TrimRight(fracStr, "0")
	return whole.String() + "." + fracStr, nil
}

// --- economics ---

// MulDecimalFloor multiplies an integer amount by a non-negative decimal (e.g.
// "0.01"), flooring the result. Pure integer math, so the result is exact.
func MulDecimalFloor(amount *big.Int, decimal string) (*big.Int, error) {
	d := strings.TrimSpace(decimal)
	if !decimalRe.MatchString(d) {
		return nil, fmt.Errorf("invalid decimal: %q", decimal)
	}
	whole := d
	frac := ""
	if i := strings.IndexByte(d, '.'); i >= 0 {
		whole = d[:i]
		frac = d[i+1:]
	}
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(len(frac))), nil)
	numStr := whole + frac
	if numStr == "" {
		numStr = "0"
	}
	numerator, ok := new(big.Int).SetString(numStr, 10)
	if !ok {
		return nil, fmt.Errorf("invalid decimal: %q", decimal)
	}
	res := new(big.Int).Mul(amount, numerator)
	res.Quo(res, scale)
	return res, nil
}

// CreationCost is the cost breakdown of creating a rollup. All amounts are uqor
// strings.
type CreationCost struct {
	// StakeUqor is the stake you commit, in uqor.
	StakeUqor string
	// BurnUqor is the amount burned on creation, in uqor.
	BurnUqor string
	// NetStakeUqor is the stake remaining after the burn, in uqor.
	NetStakeUqor string
	// TotalRequiredUqor is the total leaving your wallet (equal to the committed
	// stake), in uqor.
	TotalRequiredUqor string
	// BurnRate is the burn rate applied, as a decimal string.
	BurnRate string
}

// EstimateCreationCost estimates the cost of creating a rollup: the burn taken
// from the committed stake and the net stake remaining. An empty burnRate
// defaults to the documented rate; pass the live rollup_creation_burn_rate from
// the params query for an exact figure.
func EstimateCreationCost(stakeUqor string, burnRate string) (CreationCost, error) {
	t := strings.TrimSpace(stakeUqor)
	if !uqorIntegerRe.MatchString(t) {
		return CreationCost{}, fmt.Errorf("stakeUqor must be a non-negative integer string, got %q", stakeUqor)
	}
	stake, ok := new(big.Int).SetString(t, 10)
	if !ok {
		return CreationCost{}, fmt.Errorf("stakeUqor must be a non-negative integer string, got %q", stakeUqor)
	}
	if burnRate == "" {
		burnRate = DefaultRollupCreationBurnRate
	}
	burn, err := MulDecimalFloor(stake, burnRate)
	if err != nil {
		return CreationCost{}, err
	}
	net := new(big.Int).Sub(stake, burn)
	return CreationCost{
		StakeUqor:         stake.String(),
		BurnUqor:          burn.String(),
		NetStakeUqor:      net.String(),
		TotalRequiredUqor: stake.String(),
		BurnRate:          burnRate,
	}, nil
}
