package rdk

import pqc "github.com/qorechain/qorechain-pqc/go"

// Qorehash is QoreChain's default hash: SHAKE-256 of the concatenation of
// parts, with a 32-byte output (the chain's qorehash.Sum256). Merkle nodes,
// withdrawal leaves, DA blob commitments and transition roots all use it.
func Qorehash(parts ...[]byte) []byte {
	var all []byte
	for _, p := range parts {
		all = append(all, p...)
	}
	return pqc.Shake256(all, 32)
}
