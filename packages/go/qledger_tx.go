package rdk

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"

	"github.com/cloudflare/circl/sign/mldsa/mldsa44"
)

// qledger-v1 transactions and deposits (chain v3.2.8+, rdk-optimistic-reexec).
//
// A qledger-v1 rollup is a uqor account ledger. Its inputs are the rollup's
// inbox entries: user posts carrying one signed transaction each, and deposit
// entries the chain appends for MsgDepositToRollup.
//
//	tx       = 0x01 | scheme | public_key | kind | be64(nonce) | body | be64(amount) | signature
//	transfer = to[32]
//	withdraw = u8(len) | recipient (bech32)
//
// The only scheme is ML-DSA-44 (scheme 1), signed deterministically with the
// FIPS 204 context "qledger/v1" over
// SHA-256("qledger/v1/tx" | lp(chain_id) | lp(rollup_id) | unsigned).

const (
	// QledgerSchemeMLDSA44 is ML-DSA-44, the only qledger-v1 account scheme.
	QledgerSchemeMLDSA44 byte = 1
	// QledgerKindTransfer is a transfer to another account.
	QledgerKindTransfer byte = 1
	// QledgerKindWithdraw is a withdrawal to a qor1 address on the chain.
	QledgerKindWithdraw byte = 2
	// QledgerMaxRecipientLen is the longest withdrawal recipient (a bech32
	// address).
	QledgerMaxRecipientLen = 90
	// QledgerDepositPosterPrefix is the poster prefix of the inbox entries the
	// chain writes for deposits.
	QledgerDepositPosterPrefix = "deposit:"
	// QledgerSeedSize is the size of an ML-DSA-44 key seed.
	QledgerSeedSize = mldsa44.SeedSize
)

const (
	qledgerTxVersion    = 1
	qledgerContext      = "qledger/v1"
	qledgerDepositMagic = "QLDP"
	qledgerDepositLen   = 4 + 32 + 8
)

// QledgerTx is one qledger-v1 transaction. To is the destination of a
// transfer, Recipient the qor1 address of a withdrawal.
type QledgerTx struct {
	Scheme    byte
	PublicKey []byte
	Kind      byte
	Nonce     uint64
	To        [32]byte
	Recipient string
	Amount    uint64
	Signature []byte
}

// QledgerAccountID is the account id an ML-DSA-44 public key controls:
// SHA-256("qledger/v1/account" | scheme | public_key).
func QledgerAccountID(publicKey []byte) [32]byte {
	return qledgerAccountID(QledgerSchemeMLDSA44, publicKey)
}

func qledgerAccountID(scheme byte, publicKey []byte) [32]byte {
	h := sha256.New()
	h.Write([]byte("qledger/v1/account"))
	h.Write([]byte{scheme})
	h.Write(publicKey)
	var id [32]byte
	copy(id[:], h.Sum(nil))
	return id
}

// QledgerKeypair is an ML-DSA-44 account key pair and its account id. Treat
// SecretKey (and the seed it came from) as a secret.
type QledgerKeypair struct {
	// PublicKey is the 1312-byte verification key carried in every
	// transaction.
	PublicKey []byte
	// SecretKey is the 2560-byte expanded signing key.
	SecretKey []byte
	AccountID [32]byte
}

// QledgerKeypairFromSeed derives an ML-DSA-44 account key pair from a 32-byte
// seed (FIPS 204 key generation).
func QledgerKeypairFromSeed(seed []byte) (QledgerKeypair, error) {
	if len(seed) != QledgerSeedSize {
		return QledgerKeypair{}, fmt.Errorf("qledger: an ML-DSA-44 seed is %d bytes, got %d", QledgerSeedSize, len(seed))
	}
	var s [mldsa44.SeedSize]byte
	copy(s[:], seed)
	pk, sk := mldsa44.NewKeyFromSeed(&s)
	out := QledgerKeypair{PublicKey: pk.Bytes(), SecretKey: sk.Bytes()}
	out.AccountID = QledgerAccountID(out.PublicKey)
	return out, nil
}

// From is the sending account.
func (tx QledgerTx) From() [32]byte { return qledgerAccountID(tx.Scheme, tx.PublicKey) }

// Unsigned is the encoding without the signature.
func (tx QledgerTx) Unsigned() []byte {
	b := []byte{qledgerTxVersion, tx.Scheme}
	b = append(b, tx.PublicKey...)
	b = append(b, tx.Kind)
	b = binary.BigEndian.AppendUint64(b, tx.Nonce)
	switch tx.Kind {
	case QledgerKindTransfer:
		b = append(b, tx.To[:]...)
	case QledgerKindWithdraw:
		b = append(b, byte(len(tx.Recipient)))
		b = append(b, tx.Recipient...)
	}
	return binary.BigEndian.AppendUint64(b, tx.Amount)
}

// Encode is the transaction as posted.
func (tx QledgerTx) Encode() []byte { return append(tx.Unsigned(), tx.Signature...) }

// QledgerSigningMessage is what an account signs: the transaction bound to one
// chain and one rollup.
func QledgerSigningMessage(chainID, rollupID string, unsigned []byte) []byte {
	h := sha256.New()
	h.Write([]byte("qledger/v1/tx"))
	h.Write(lenPrefixed([]byte(chainID)))
	h.Write(lenPrefixed([]byte(rollupID)))
	h.Write(unsigned)
	return h.Sum(nil)
}

// SignQledgerTxInput is a transfer (To set) or a withdrawal (Recipient set).
type SignQledgerTxInput struct {
	ChainID  string
	RollupID string
	// SecretKey is the 2560-byte signing key or the 32-byte seed.
	SecretKey []byte
	// PublicKey is optional: it is derived from SecretKey when empty, and must
	// match it otherwise.
	PublicKey []byte
	Nonce     uint64
	Amount    uint64
	// To is a 32-byte account id: a transfer.
	To []byte
	// Recipient is a canonical qor1 address: a withdrawal.
	Recipient string
}

// SignQledgerTx builds and signs (deterministically) a transfer or a
// withdrawal. Post the result's Encode() with MsgPostRollupData, one
// transaction per post.
func SignQledgerTx(in SignQledgerTxInput) (QledgerTx, error) {
	if (len(in.To) == 0) == (in.Recipient == "") {
		return QledgerTx{}, errors.New("qledger: give exactly one of To (transfer) or Recipient (withdrawal)")
	}
	sk, err := qledgerSigningKey(in.SecretKey)
	if err != nil {
		return QledgerTx{}, err
	}
	pub := sk.Public().(*mldsa44.PublicKey).Bytes()
	if len(in.PublicKey) > 0 && string(in.PublicKey) != string(pub) {
		return QledgerTx{}, errors.New("qledger: the public key does not belong to the secret key")
	}
	tx := QledgerTx{Scheme: QledgerSchemeMLDSA44, PublicKey: pub, Nonce: in.Nonce, Amount: in.Amount}
	if len(in.To) > 0 {
		if len(in.To) != 32 {
			return QledgerTx{}, errors.New("qledger: a transfer's To is a 32-byte account id")
		}
		tx.Kind = QledgerKindTransfer
		copy(tx.To[:], in.To)
	} else {
		if len(in.Recipient) > QledgerMaxRecipientLen {
			return QledgerTx{}, fmt.Errorf("qledger: a recipient is at most %d bytes", QledgerMaxRecipientLen)
		}
		tx.Kind = QledgerKindWithdraw
		tx.Recipient = in.Recipient
	}
	sig := make([]byte, mldsa44.SignatureSize)
	msg := QledgerSigningMessage(in.ChainID, in.RollupID, tx.Unsigned())
	if err := mldsa44.SignTo(sk, msg, []byte(qledgerContext), false, sig); err != nil {
		return QledgerTx{}, fmt.Errorf("qledger: %w", err)
	}
	tx.Signature = sig
	return tx, nil
}

func qledgerSigningKey(b []byte) (*mldsa44.PrivateKey, error) {
	switch len(b) {
	case mldsa44.SeedSize:
		var s [mldsa44.SeedSize]byte
		copy(s[:], b)
		_, sk := mldsa44.NewKeyFromSeed(&s)
		return sk, nil
	case mldsa44.PrivateKeySize:
		sk := new(mldsa44.PrivateKey)
		if err := sk.UnmarshalBinary(b); err != nil {
			return nil, fmt.Errorf("qledger: %w", err)
		}
		return sk, nil
	}
	return nil, fmt.Errorf("qledger: an ML-DSA-44 key is %d (seed) or %d bytes, got %d",
		mldsa44.SeedSize, mldsa44.PrivateKeySize, len(b))
}

// DecodeQledgerTx parses a posted payload. ok is false for anything that is
// not exactly one well-formed transaction.
func DecodeQledgerTx(b []byte) (tx QledgerTx, ok bool) {
	if len(b) < 2 || b[0] != qledgerTxVersion || b[1] != QledgerSchemeMLDSA44 {
		return QledgerTx{}, false
	}
	tx.Scheme = b[1]
	p := 2
	if len(b) < p+mldsa44.PublicKeySize+1+8 {
		return QledgerTx{}, false
	}
	tx.PublicKey = clone(b[p : p+mldsa44.PublicKeySize])
	p += mldsa44.PublicKeySize
	tx.Kind = b[p]
	p++
	tx.Nonce = binary.BigEndian.Uint64(b[p : p+8])
	p += 8
	switch tx.Kind {
	case QledgerKindTransfer:
		if len(b) < p+32 {
			return QledgerTx{}, false
		}
		copy(tx.To[:], b[p:p+32])
		p += 32
	case QledgerKindWithdraw:
		if len(b) < p+1 {
			return QledgerTx{}, false
		}
		n := int(b[p])
		p++
		if n == 0 || n > QledgerMaxRecipientLen || len(b) < p+n {
			return QledgerTx{}, false
		}
		tx.Recipient = string(b[p : p+n])
		p += n
	default:
		return QledgerTx{}, false
	}
	if len(b) != p+8+mldsa44.SignatureSize {
		return QledgerTx{}, false
	}
	tx.Amount = binary.BigEndian.Uint64(b[p : p+8])
	p += 8
	tx.Signature = clone(b[p:])
	return tx, true
}

// Verify reports whether tx carries a valid signature for chainID and
// rollupID.
func (tx QledgerTx) Verify(chainID, rollupID string) bool {
	if tx.Scheme != QledgerSchemeMLDSA44 || len(tx.PublicKey) != mldsa44.PublicKeySize ||
		len(tx.Signature) != mldsa44.SignatureSize {
		return false
	}
	var buf [mldsa44.PublicKeySize]byte
	copy(buf[:], tx.PublicKey)
	var pk mldsa44.PublicKey
	pk.Unpack(&buf)
	msg := QledgerSigningMessage(chainID, rollupID, tx.Unsigned())
	return mldsa44.Verify(&pk, msg, []byte(qledgerContext), tx.Signature)
}

// EncodeQledgerDeposit is the payload of a deposit entry:
// "QLDP" | account[32] | be64(amount).
func EncodeQledgerDeposit(account [32]byte, amount uint64) []byte {
	b := append([]byte(qledgerDepositMagic), account[:]...)
	return binary.BigEndian.AppendUint64(b, amount)
}

// DecodeQledgerDeposit parses a deposit payload.
func DecodeQledgerDeposit(b []byte) (account [32]byte, amount uint64, ok bool) {
	if len(b) != qledgerDepositLen || string(b[:4]) != qledgerDepositMagic {
		return account, 0, false
	}
	copy(account[:], b[4:36])
	return account, binary.BigEndian.Uint64(b[36:]), true
}
