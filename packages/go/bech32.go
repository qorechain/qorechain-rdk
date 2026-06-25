package rdk

import (
	"errors"
	"strings"
)

// Minimal BIP-173 bech32 implementation, sufficient for QoreChain account
// addresses. It encodes/decodes the data part as 5-bit groups with the standard
// checksum. This avoids pulling a heavier dependency for a small, well-specified
// codec.

const bech32Charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

var bech32CharsetRev = func() [128]int8 {
	var rev [128]int8
	for i := range rev {
		rev[i] = -1
	}
	for i := 0; i < len(bech32Charset); i++ {
		rev[bech32Charset[i]] = int8(i)
	}
	return rev
}()

func bech32Polymod(values []byte) uint32 {
	gen := []uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	chk := uint32(1)
	for _, v := range values {
		b := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ uint32(v)
		for i := 0; i < 5; i++ {
			if (b>>uint(i))&1 == 1 {
				chk ^= gen[i]
			}
		}
	}
	return chk
}

func bech32HrpExpand(hrp string) []byte {
	out := make([]byte, 0, len(hrp)*2+1)
	for i := 0; i < len(hrp); i++ {
		out = append(out, hrp[i]>>5)
	}
	out = append(out, 0)
	for i := 0; i < len(hrp); i++ {
		out = append(out, hrp[i]&31)
	}
	return out
}

func bech32CreateChecksum(hrp string, data []byte) []byte {
	values := append(bech32HrpExpand(hrp), data...)
	values = append(values, 0, 0, 0, 0, 0, 0)
	polymod := bech32Polymod(values) ^ 1
	out := make([]byte, 6)
	for i := 0; i < 6; i++ {
		out[i] = byte((polymod >> uint(5*(5-i))) & 31)
	}
	return out
}

func bech32VerifyChecksum(hrp string, data []byte) bool {
	return bech32Polymod(append(bech32HrpExpand(hrp), data...)) == 1
}

// convertBits regroups bytes from `from` bits per group to `to` bits per group.
func convertBits(data []byte, from, to uint, pad bool) ([]byte, error) {
	acc := uint32(0)
	bits := uint(0)
	out := []byte{}
	maxv := uint32((1 << to) - 1)
	maxAcc := uint32((1 << (from + to - 1)) - 1)
	for _, value := range data {
		if uint32(value)>>from != 0 {
			return nil, errors.New("invalid data range in bit conversion")
		}
		acc = ((acc << from) | uint32(value)) & maxAcc
		bits += from
		for bits >= to {
			bits -= to
			out = append(out, byte((acc>>bits)&maxv))
		}
	}
	if pad {
		if bits > 0 {
			out = append(out, byte((acc<<(to-bits))&maxv))
		}
	} else if bits >= from || ((acc<<(to-bits))&maxv) != 0 {
		return nil, errors.New("invalid padding in bit conversion")
	}
	return out, nil
}

// bech32Encode encodes the human-readable part and 8-bit data bytes into a
// bech32 string.
func bech32Encode(hrp string, data8 []byte) (string, error) {
	data5, err := convertBits(data8, 8, 5, true)
	if err != nil {
		return "", err
	}
	checksum := bech32CreateChecksum(hrp, data5)
	var sb strings.Builder
	sb.WriteString(hrp)
	sb.WriteByte('1')
	for _, b := range data5 {
		sb.WriteByte(bech32Charset[b])
	}
	for _, b := range checksum {
		sb.WriteByte(bech32Charset[b])
	}
	return sb.String(), nil
}

// bech32Decode decodes a bech32 string into its human-readable part and 8-bit
// data bytes.
func bech32Decode(addr string) (string, []byte, error) {
	lower := strings.ToLower(addr)
	upper := strings.ToUpper(addr)
	if addr != lower && addr != upper {
		return "", nil, errors.New("bech32 string is mixed case")
	}
	addr = lower
	pos := strings.LastIndexByte(addr, '1')
	if pos < 1 || pos+7 > len(addr) {
		return "", nil, errors.New("invalid bech32 separator position")
	}
	hrp := addr[:pos]
	dataPart := addr[pos+1:]
	data5 := make([]byte, 0, len(dataPart))
	for i := 0; i < len(dataPart); i++ {
		c := dataPart[i]
		if c >= 128 || bech32CharsetRev[c] == -1 {
			return "", nil, errors.New("invalid bech32 character")
		}
		data5 = append(data5, byte(bech32CharsetRev[c]))
	}
	if !bech32VerifyChecksum(hrp, data5) {
		return "", nil, errors.New("invalid bech32 checksum")
	}
	data8, err := convertBits(data5[:len(data5)-6], 5, 8, false)
	if err != nil {
		return "", nil, err
	}
	return hrp, data8, nil
}
