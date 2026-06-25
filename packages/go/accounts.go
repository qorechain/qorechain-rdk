package rdk

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"

	"github.com/cosmos/go-bip39"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/tyler-smith/go-bip32"
	"golang.org/x/crypto/ripemd160" //nolint:staticcheck // ripemd160 is required for Cosmos address derivation
)

// Account is a derived QoreChain native account. The private key material is
// returned explicitly and is never logged.
type Account struct {
	// Address is the bech32 (qor) account address.
	Address string
	// PublicKey is the 33-byte compressed secp256k1 public key.
	PublicKey []byte
	// PrivateKey is the 32-byte secp256k1 private key.
	PrivateKey []byte
}

// GenerateMnemonic generates a fresh BIP-39 English mnemonic. strengthBits of
// 128 yields 12 words (default), 256 yields 24 words.
func GenerateMnemonic(strengthBits int) (string, error) {
	if strengthBits == 0 {
		strengthBits = 128
	}
	entropy, err := bip39.NewEntropy(strengthBits)
	if err != nil {
		return "", err
	}
	return bip39.NewMnemonic(entropy)
}

// ValidateMnemonic validates a BIP-39 mnemonic against its checksum. It never
// errors; it returns false for invalid input.
func ValidateMnemonic(mnemonic string) bool {
	return bip39.IsMnemonicValid(mnemonic)
}

// hardened returns the hardened child index for BIP-32 derivation.
func hardened(i uint32) uint32 { return bip32.FirstHardenedChild + i }

// DeriveNativeAccount derives a native QoreChain account (Cosmos-style
// secp256k1) from a mnemonic at BIP-44 path m/44'/118'/0'/0/index. The address
// is the bech32 (qor) encoding of ripemd160(sha256(compressedPublicKey)).
func DeriveNativeAccount(mnemonic string, index uint32) (Account, error) {
	if !ValidateMnemonic(mnemonic) {
		return Account{}, errors.New("invalid mnemonic")
	}
	seed := bip39.NewSeed(mnemonic, "")
	master, err := bip32.NewMasterKey(seed)
	if err != nil {
		return Account{}, err
	}
	// m/44'/118'/0'/0/index
	path := []uint32{hardened(44), hardened(118), hardened(0), 0, index}
	key := master
	for _, p := range path {
		key, err = key.NewChildKey(p)
		if err != nil {
			return Account{}, fmt.Errorf("failed to derive secp256k1 key: %w", err)
		}
	}
	priv := key.Key // 32-byte private key
	privKey := secp256k1.PrivKeyFromBytes(priv)
	compressed := privKey.PubKey().SerializeCompressed() // 33 bytes

	sha := sha256.Sum256(compressed)
	rip := ripemd160.New()
	rip.Write(sha[:])
	digest := rip.Sum(nil) // 20 bytes

	address, err := bech32Encode(AccountPrefix, digest)
	if err != nil {
		return Account{}, err
	}
	return Account{
		Address:    address,
		PublicKey:  compressed,
		PrivateKey: append([]byte(nil), priv...),
	}, nil
}

// SignerFromEnv builds an operator Account from the environment, preferring a
// hex private key (QORE_OPERATOR_PRIVATE_KEY_HEX) over a mnemonic
// (QORE_MNEMONIC). The prefix selects the bech32 address prefix (empty defaults
// to the account prefix).
//
// It returns (Account{}, nil, false) when neither variable is set, so callers
// can give a friendly message; it returns a non-nil error when a variable is set
// but malformed.
func SignerFromEnv(env map[string]string, prefix string) (Account, error, bool) {
	hex := strings.TrimSpace(env["QORE_OPERATOR_PRIVATE_KEY_HEX"])
	mnemonic := strings.TrimSpace(env["QORE_MNEMONIC"])
	if prefix == "" {
		prefix = AccountPrefix
	}
	if hex != "" {
		priv, err := HexToBytes(hex)
		if err != nil {
			return Account{}, err, true
		}
		acc, err := AccountFromPrivateKey(priv, prefix)
		if err != nil {
			return Account{}, err, true
		}
		return acc, nil, true
	}
	if mnemonic != "" {
		acc, err := DeriveNativeAccount(mnemonic, 0)
		if err != nil {
			return Account{}, err, true
		}
		if prefix != AccountPrefix {
			acc, err = AccountFromPrivateKey(acc.PrivateKey, prefix)
			if err != nil {
				return Account{}, err, true
			}
		}
		return acc, nil, true
	}
	return Account{}, nil, false
}

// AccountFromPrivateKey builds an Account from a 32-byte secp256k1 private key
// and the given bech32 prefix (empty means the account prefix).
func AccountFromPrivateKey(priv []byte, prefix string) (Account, error) {
	if len(priv) != 32 {
		return Account{}, fmt.Errorf("private key must be 32 bytes, got %d", len(priv))
	}
	if prefix == "" {
		prefix = AccountPrefix
	}
	privKey := secp256k1.PrivKeyFromBytes(priv)
	compressed := privKey.PubKey().SerializeCompressed()
	sha := sha256.Sum256(compressed)
	rip := ripemd160.New()
	rip.Write(sha[:])
	digest := rip.Sum(nil)
	address, err := bech32Encode(prefix, digest)
	if err != nil {
		return Account{}, err
	}
	return Account{Address: address, PublicKey: compressed, PrivateKey: append([]byte(nil), priv...)}, nil
}
