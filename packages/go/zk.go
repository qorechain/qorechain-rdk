package rdk

import (
	"bytes"
	"math/big"
)

// ZK public inputs as the chain checks them (chain v3.2.8+,
// rdk-zk-canonical-inputs).
//
// A Groth16 batch is verified with four public inputs, in order:
// prev_state_root, state_root, data_hash, withdrawals_root, each read as a
// 32-byte big-endian integer. From v3.2.8 the chain no longer reduces a
// submitter-chosen input into the BLS12-381 scalar field: it refuses the batch
// unless the value is already below the scalar modulus r. A raw SHA-256 or
// SHAKE-256 output is at or above r about 55% of the time.
//
//   - prev_state_root and state_root are always checked. Commit to state with
//     a field-friendly hash, or reduce with ToCanonicalScalar and prove the
//     reduced value.
//   - data_hash is not checked when the chain fixed it itself: a based
//     rollup's inbox range commitment, or a native-DA batch whose hash names a
//     posted or stored blob (IsDataHashChainBound). Otherwise it must be
//     canonical.
//   - withdrawals_root may be any 32 bytes: the chain stores it reduced
//     modulo r and checks withdrawals against it modulo r
//     (WithdrawalsRootMatches). The circuit's fourth input is
//     int(withdrawals_root) mod r (ZkPublicInputs).

// BLS12381ScalarModulus returns the BLS12-381 scalar field modulus r (a fresh
// copy on every call).
func BLS12381ScalarModulus() *big.Int {
	return new(big.Int).Set(bls12381ScalarModulus)
}

var bls12381ScalarModulus, _ = new(big.Int).SetString(
	"73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001", 16)

// IsCanonicalScalar reports whether a big-endian value is a canonical
// BLS12-381 scalar (strictly below r). Empty reads as zero.
func IsCanonicalScalar(value []byte) bool {
	return new(big.Int).SetBytes(value).Cmp(bls12381ScalarModulus) < 0
}

// ToCanonicalScalar reduces a big-endian value modulo r and returns it as 32
// big-endian bytes. Use it for values the rollup chooses (state roots, an
// unbound data hash), and prove the reduced value in the circuit.
func ToCanonicalScalar(value []byte) []byte {
	x := new(big.Int).SetBytes(value)
	x.Mod(x, bls12381ScalarModulus)
	return x.FillBytes(make([]byte, 32))
}

// ZkBatchInputs are the public inputs of a zk batch, as they go into
// MsgSubmitBatch.
type ZkBatchInputs struct {
	PrevStateRoot   []byte
	StateRoot       []byte
	DataHash        []byte
	WithdrawalsRoot []byte
}

// ZkInputOptions configures ZkPublicInputErrors.
type ZkInputOptions struct {
	// DataHashBound means the chain fixed data_hash itself (see
	// IsDataHashChainBound), so it is not checked.
	DataHashBound bool
}

// ZkPublicInputErrors says why the chain would refuse a zk (snark) batch's
// public inputs as not canonical, one message per input; nil when they are all
// accepted. An empty input reads as zero, which is canonical.
func ZkPublicInputErrors(in ZkBatchInputs, opts ...ZkInputOptions) []string {
	var o ZkInputOptions
	if len(opts) > 0 {
		o = opts[0]
	}
	type check struct {
		name  string
		value []byte
	}
	checks := []check{{"prev_state_root", in.PrevStateRoot}, {"state_root", in.StateRoot}}
	if !o.DataHashBound {
		checks = append(checks, check{"data_hash", in.DataHash})
	}
	var errs []string
	for _, c := range checks {
		if IsCanonicalScalar(c.value) {
			continue
		}
		errs = append(errs, c.name+" is not a canonical BLS12-381 scalar (it must be below r): "+
			"reduce it with ToCanonicalScalar and prove the reduced value")
	}
	return errs
}

// ZkPublicInputs are the four public inputs of a Groth16 rollup circuit, in
// the chain's order (prev_state_root, state_root, data_hash,
// withdrawals_root), each the 32-byte big-endian value reduced modulo r. An
// empty value is 0. Use them as the circuit's public witness.
func ZkPublicInputs(in ZkBatchInputs) [][]byte {
	return [][]byte{
		ToCanonicalScalar(in.PrevStateRoot),
		ToCanonicalScalar(in.StateRoot),
		ToCanonicalScalar(in.DataHash),
		ToCanonicalScalar(in.WithdrawalsRoot),
	}
}

// WithdrawalsRootMatches reports whether a withdrawals tree root matches a
// batch's stored root, as the chain checks a withdrawal: modulo r when the
// batch's WithdrawalsRootReduced is set (chain v3.2.8+ Groth16 batches), byte
// for byte otherwise.
func WithdrawalsRootMatches(storedRoot, treeRoot []byte, withdrawalsRootReduced bool) bool {
	if withdrawalsRootReduced {
		return bytes.Equal(ToCanonicalScalar(storedRoot), ToCanonicalScalar(treeRoot))
	}
	return bytes.Equal(storedRoot, treeRoot)
}

// IsDataHashChainBound reports whether the chain fixes a batch's data_hash
// itself, so it is exempt from the canonical check: always on a based rollup
// (the inbox range commitment), and on a native or both DA rollup when the hash
// is non-empty (the chain then requires a posted or stored blob with exactly
// that hash). Only rollup.Sequencing and rollup.DABackend are read.
func IsDataHashChainBound(rollup RollupView, dataHash []byte) bool {
	if rollup.Sequencing == string(SequencingBased) {
		return true
	}
	return len(dataHash) > 0 && (rollup.DABackend == string(DANative) || rollup.DABackend == string(DABoth))
}
