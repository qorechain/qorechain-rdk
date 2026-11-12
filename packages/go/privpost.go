package rdk

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"errors"
	"fmt"
	"io"

	"github.com/cloudflare/circl/kem/mlkem/mlkem1024"
)

// Private-rollup envelopes (chain v3.2.8+, rdk-private-rollups).
//
// Every post on a private (Privacy "encapsulated") rollup is an envelope: the
// data encrypted once with AES-256-GCM under a fresh content key, and that key
// encapsulated with ML-KEM-1024 to every member's key from the chain's KEM
// registry, with a key commitment so all members open the same content. The
// chain checks the envelope's structure and that every entry names a current
// member's current key; it never decrypts.
//
// Posts, poster, timing, sizes, members, roots and withdrawals stay public.
//
// Layout (all integers big-endian):
//
//	"QPRV" | 0x01 | be64(epoch) | key_commit(32) | be16(n)
//	n x ( be16(len) | member | fingerprint(32) | kem_ciphertext(1568) | wrapped_key(48) )
//	ciphertext (AES-256-GCM, zero nonce, AAD = everything before it)
//
// Every AES key here encrypts exactly one message, which is what makes the
// zero nonce safe.

const (
	// KemCiphertextSize is the ML-KEM-1024 ciphertext size.
	KemCiphertextSize = mlkem1024.CiphertextSize
	// EncapsulationKeySize is the ML-KEM-1024 encapsulation (public) key size.
	EncapsulationKeySize = mlkem1024.PublicKeySize
	// KemSeedSize is the size of an ML-KEM-1024 key seed (d || z).
	KemSeedSize = mlkem1024.KeySeedSize
	// KemSecretKeySize is the size of an expanded ML-KEM-1024 decapsulation key.
	KemSecretKeySize = mlkem1024.PrivateKeySize
	// MaxEnvelopeMembers is the most entries an envelope can carry.
	MaxEnvelopeMembers = 32

	envelopeMagic       = "QPRV"
	envelopeVersion     = 1
	envelopeWrappedSize = 48 // 32-byte content key + 16-byte GCM tag
	envelopeMinPayload  = 16 // the GCM tag
	envelopeMaxAddress  = 128
	envelopeFixedHeader = 4 + 1 + 8 + 32 + 2
	envelopeWrapDomain  = "qorechain/rdk/private/v1/wrap"
	envelopeKeyDomain   = "qorechain/rdk/private/v1/key"
)

var (
	// ErrEnvelopeMalformed is returned for bytes that are not a well-formed
	// envelope.
	ErrEnvelopeMalformed = errors.New("privpost: malformed envelope")
	// ErrEnvelopeNotMember is returned when the envelope has no entry for the
	// member opening it.
	ErrEnvelopeNotMember = errors.New("privpost: the envelope has no entry for this member")
	// ErrEnvelopeOpen is returned when the key, chain id, rollup id or payload
	// does not match.
	ErrEnvelopeOpen = errors.New("privpost: the envelope does not open with this key")
)

// EnvelopeEntry is one member's entry in an envelope.
type EnvelopeEntry struct {
	Member string
	// Fingerprint is SHA-256 of the member's ML-KEM-1024 encapsulation key.
	Fingerprint   []byte
	KemCiphertext []byte
	WrappedKey    []byte
}

// Envelope is a parsed envelope.
type Envelope struct {
	Epoch      uint64
	KeyCommit  []byte
	Entries    []EnvelopeEntry
	Ciphertext []byte
	// Header is everything before Ciphertext: the payload's additional data.
	Header []byte
}

// EnvelopeRecipient is a member address and its ML-KEM-1024 encapsulation key.
type EnvelopeRecipient struct {
	Member           string
	EncapsulationKey []byte
}

// KemKeypair is an ML-KEM-1024 key pair. Treat SecretKey (and the seed it came
// from) as a secret.
type KemKeypair struct {
	// PublicKey is the 1568-byte encapsulation key to register on chain.
	PublicKey []byte
	// SecretKey is the 3168-byte expanded decapsulation key.
	SecretKey []byte
}

// KemKeyFingerprint is the fingerprint the chain matches against a member's
// registered key: SHA-256 of the encapsulation key.
func KemKeyFingerprint(encapsulationKey []byte) []byte {
	h := sha256.Sum256(encapsulationKey)
	return h[:]
}

// KemKeypairFromSeed derives an ML-KEM-1024 key pair from a 64-byte seed
// (d || z), the form the chain's tooling stores. The seed or the SecretKey
// both open envelopes.
func KemKeypairFromSeed(seed []byte) (KemKeypair, error) {
	if len(seed) != KemSeedSize {
		return KemKeypair{}, fmt.Errorf("privpost: an ML-KEM-1024 seed is %d bytes, got %d", KemSeedSize, len(seed))
	}
	pk, sk := mlkem1024.NewKeyFromSeed(seed)
	out := KemKeypair{PublicKey: make([]byte, EncapsulationKeySize), SecretKey: make([]byte, KemSecretKeySize)}
	pk.Pack(out.PublicKey)
	sk.Pack(out.SecretKey)
	return out, nil
}

// ParseEnvelope parses an envelope and checks every size. It does not check
// membership (the chain does that; see EnvelopeMembershipError). The returned
// slices are copies.
func ParseEnvelope(b []byte) (*Envelope, error) {
	malformed := func(why string) error { return fmt.Errorf("%w: %s", ErrEnvelopeMalformed, why) }
	if len(b) < envelopeFixedHeader || string(b[:4]) != envelopeMagic || b[4] != envelopeVersion {
		return nil, malformed("bad header")
	}
	e := &Envelope{Epoch: binary.BigEndian.Uint64(b[5:13]), KeyCommit: clone(b[13:45])}
	n := int(binary.BigEndian.Uint16(b[45:47]))
	if n == 0 || n > MaxEnvelopeMembers {
		return nil, malformed(fmt.Sprintf("%d entries", n))
	}
	rest := b[envelopeFixedHeader:]
	for i := 0; i < n; i++ {
		if len(rest) < 2 {
			return nil, malformed("truncated entry")
		}
		al := int(binary.BigEndian.Uint16(rest))
		rest = rest[2:]
		if al == 0 || al > envelopeMaxAddress || len(rest) < al+32+KemCiphertextSize+envelopeWrappedSize {
			return nil, malformed("truncated entry")
		}
		var en EnvelopeEntry
		en.Member, rest = string(rest[:al]), rest[al:]
		en.Fingerprint, rest = clone(rest[:32]), rest[32:]
		en.KemCiphertext, rest = clone(rest[:KemCiphertextSize]), rest[KemCiphertextSize:]
		en.WrappedKey, rest = clone(rest[:envelopeWrappedSize]), rest[envelopeWrappedSize:]
		e.Entries = append(e.Entries, en)
	}
	if len(rest) < envelopeMinPayload {
		return nil, malformed("payload shorter than its tag")
	}
	headerLen := len(b) - len(rest)
	e.Header = clone(b[:headerLen])
	e.Ciphertext = clone(rest)
	return e, nil
}

// SealEnvelopeInput is what SealEnvelope encrypts, and to whom.
type SealEnvelopeInput struct {
	ChainID  string
	RollupID string
	// Epoch is the rollup's current membership epoch.
	Epoch uint64
	// Recipients are the rollup's members, in the rollup's member order.
	Recipients []EnvelopeRecipient
	Plaintext  []byte
	// Rand is the source of randomness; nil uses crypto/rand. Pass a
	// deterministic one only in tests.
	Rand io.Reader
}

// SealEnvelope encrypts in.Plaintext to in.Recipients for a rollup at its
// current membership epoch. Post the result with MsgPostRollupData.
func SealEnvelope(in SealEnvelopeInput) ([]byte, error) {
	if len(in.Recipients) == 0 || len(in.Recipients) > MaxEnvelopeMembers {
		return nil, fmt.Errorf("privpost: %d recipients (1 to %d)", len(in.Recipients), MaxEnvelopeMembers)
	}
	random := in.Rand
	if random == nil {
		random = rand.Reader
	}
	contentKey := make([]byte, 32)
	if _, err := io.ReadFull(random, contentKey); err != nil {
		return nil, err
	}
	out := append([]byte(envelopeMagic), envelopeVersion)
	out = binary.BigEndian.AppendUint64(out, in.Epoch)
	out = append(out, contentKeyCommit(contentKey)...)
	out = binary.BigEndian.AppendUint16(out, uint16(len(in.Recipients)))
	for _, r := range in.Recipients {
		if len(r.Member) == 0 || len(r.Member) > envelopeMaxAddress {
			return nil, fmt.Errorf("privpost: member %q", r.Member)
		}
		if len(r.EncapsulationKey) != EncapsulationKeySize {
			return nil, fmt.Errorf("privpost: key of %s is %d bytes, want %d", r.Member, len(r.EncapsulationKey), EncapsulationKeySize)
		}
		var pk mlkem1024.PublicKey
		if err := pk.Unpack(r.EncapsulationKey); err != nil {
			return nil, fmt.Errorf("privpost: key of %s: %w", r.Member, err)
		}
		seed := make([]byte, mlkem1024.EncapsulationSeedSize)
		if _, err := io.ReadFull(random, seed); err != nil {
			return nil, err
		}
		kemCt := make([]byte, KemCiphertextSize)
		shared := make([]byte, mlkem1024.SharedKeySize)
		pk.EncapsulateTo(kemCt, shared, seed)
		wrapAEAD, err := envelopeWrapAEAD(shared, in.ChainID, in.RollupID, in.Epoch, r.Member)
		if err != nil {
			return nil, err
		}
		out = binary.BigEndian.AppendUint16(out, uint16(len(r.Member)))
		out = append(out, r.Member...)
		out = append(out, KemKeyFingerprint(r.EncapsulationKey)...)
		out = append(out, kemCt...)
		out = wrapAEAD.Seal(out, zeroNonce(wrapAEAD), contentKey, nil)
	}
	payloadAEAD, err := singleUseGCM(contentKey)
	if err != nil {
		return nil, err
	}
	header := clone(out)
	return payloadAEAD.Seal(out, zeroNonce(payloadAEAD), in.Plaintext, header), nil
}

// OpenEnvelopeInput is what OpenEnvelope needs to decrypt as one member.
type OpenEnvelopeInput struct {
	Envelope []byte
	ChainID  string
	RollupID string
	Member   string
	// DecapsulationKey is the member's 64-byte seed or the 3168-byte expanded
	// secret key.
	DecapsulationKey []byte
}

// OpenEnvelope decrypts an envelope as in.Member. It fails with
// ErrEnvelopeNotMember when the member has no entry and ErrEnvelopeOpen when
// the key, chain id or rollup id does not open it, the content key does not
// match the envelope's commitment, or the payload was altered.
func OpenEnvelope(in OpenEnvelopeInput) ([]byte, error) {
	e, err := ParseEnvelope(in.Envelope)
	if err != nil {
		return nil, err
	}
	sk, err := kemDecapsulationKey(in.DecapsulationKey)
	if err != nil {
		return nil, err
	}
	var entry *EnvelopeEntry
	for i := range e.Entries {
		if e.Entries[i].Member == in.Member {
			entry = &e.Entries[i]
			break
		}
	}
	if entry == nil {
		return nil, ErrEnvelopeNotMember
	}
	shared := make([]byte, mlkem1024.SharedKeySize)
	sk.DecapsulateTo(shared, entry.KemCiphertext)
	wrapAEAD, err := envelopeWrapAEAD(shared, in.ChainID, in.RollupID, e.Epoch, in.Member)
	if err != nil {
		return nil, err
	}
	contentKey, err := wrapAEAD.Open(nil, zeroNonce(wrapAEAD), entry.WrappedKey, nil)
	if err != nil {
		return nil, ErrEnvelopeOpen
	}
	if subtle.ConstantTimeCompare(contentKeyCommit(contentKey), e.KeyCommit) != 1 {
		return nil, fmt.Errorf("%w: the content key does not match the envelope's commitment", ErrEnvelopeOpen)
	}
	payloadAEAD, err := singleUseGCM(contentKey)
	if err != nil {
		return nil, err
	}
	plaintext, err := payloadAEAD.Open(nil, zeroNonce(payloadAEAD), e.Ciphertext, e.Header)
	if err != nil {
		return nil, ErrEnvelopeOpen
	}
	return plaintext, nil
}

// EnvelopeMembershipError says why the chain would refuse envelope as a post on
// a private rollup, or returns "" if it would accept its structure. It mirrors
// the chain's check: the envelope's epoch is the rollup's membership epoch,
// there is one entry per member in the rollup's order, and each entry names
// that member's registered ML-KEM-1024 key. It does not decrypt.
func EnvelopeMembershipError(envelope []byte, membersEpoch uint64, members []EnvelopeRecipient) string {
	if len(members) == 0 {
		return "the rollup has no members yet"
	}
	e, err := ParseEnvelope(envelope)
	if err != nil {
		return err.Error()
	}
	if e.Epoch != membersEpoch {
		return fmt.Sprintf("envelope epoch %d, the rollup's membership epoch is %d", e.Epoch, membersEpoch)
	}
	if len(e.Entries) != len(members) {
		return fmt.Sprintf("%d entries for %d members", len(e.Entries), len(members))
	}
	for i, want := range members {
		got := e.Entries[i]
		if got.Member != want.Member {
			return fmt.Sprintf("entry %d is for %s, member %d is %s", i, got.Member, i, want.Member)
		}
		if subtle.ConstantTimeCompare(got.Fingerprint, KemKeyFingerprint(want.EncapsulationKey)) != 1 {
			return fmt.Sprintf("entry %d does not name %s's registered KEM key", i, want.Member)
		}
	}
	return ""
}

// kemDecapsulationKey reads a seed or an expanded decapsulation key.
func kemDecapsulationKey(b []byte) (*mlkem1024.PrivateKey, error) {
	switch len(b) {
	case KemSeedSize:
		_, sk := mlkem1024.NewKeyFromSeed(b)
		return sk, nil
	case KemSecretKeySize:
		sk := new(mlkem1024.PrivateKey)
		if err := sk.Unpack(b); err != nil {
			return nil, fmt.Errorf("privpost: %w", err)
		}
		return sk, nil
	}
	return nil, fmt.Errorf("privpost: an ML-KEM-1024 key is %d (seed) or %d bytes, got %d", KemSeedSize, KemSecretKeySize, len(b))
}

// envelopeWrapAEAD is the AEAD that wraps the content key for one member: its
// key is HKDF-SHA-256 of the KEM shared secret, bound to the chain, rollup,
// epoch and member.
func envelopeWrapAEAD(shared []byte, chainID, rollupID string, epoch uint64, member string) (cipher.AEAD, error) {
	info := []byte(envelopeWrapDomain)
	info = append(info, lenPrefixed([]byte(chainID))...)
	info = append(info, lenPrefixed([]byte(rollupID))...)
	info = binary.BigEndian.AppendUint64(info, epoch)
	info = append(info, lenPrefixed([]byte(member))...)
	key, err := hkdf.Key(sha256.New, shared, nil, string(info), 32)
	if err != nil {
		return nil, err
	}
	return singleUseGCM(key)
}

// contentKeyCommit binds an envelope to its content key.
func contentKeyCommit(contentKey []byte) []byte {
	h := sha256.New()
	h.Write([]byte(envelopeKeyDomain))
	h.Write(contentKey)
	return h.Sum(nil)
}

// singleUseGCM is AES-256-GCM for a key that encrypts exactly one message.
func singleUseGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func zeroNonce(a cipher.AEAD) []byte { return make([]byte, a.NonceSize()) }

func clone(b []byte) []byte { return append([]byte(nil), b...) }
