package rdk

import (
	"crypto/sha256"

	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	ecdsa "github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

// Type URLs for the Cosmos envelope protos used when building a transaction.
const (
	typeURLAny             = "/google.protobuf.Any"
	typeURLSecp256k1PubKey = "/cosmos.crypto.secp256k1.PubKey"
)

// signModeDirect is SignMode SIGN_MODE_DIRECT (= 1).
const signModeDirect = 1

// Coin is a Cosmos coin (denom + amount).
type Coin struct {
	Denom  string
	Amount string
}

// Fee is a transaction fee: the coin amounts and a gas limit.
type Fee struct {
	Amount   []Coin
	GasLimit uint64
}

// encodeAny encodes a google.protobuf.Any{1:type_url, 2:value}.
func encodeAny(typeURL string, value []byte) []byte {
	w := &protoWriter{}
	w.writeRawString(1, typeURL)
	w.writeRawBytes(2, value)
	return w.bytes()
}

// encodeTxBody encodes TxBody{1:repeated Any messages, 2:string memo}.
func encodeTxBody(messages []Msg, memo string) []byte {
	w := &protoWriter{}
	for _, m := range messages {
		any := encodeAny(m.TypeURL(), m.Marshal())
		w.writeMessage(1, any)
	}
	w.writeString(2, memo)
	return w.bytes()
}

// encodePubKey encodes a secp256k1 PubKey{1:bytes compressed-33}.
func encodePubKey(compressed []byte) []byte {
	w := &protoWriter{}
	w.writeRawBytes(1, compressed)
	return w.bytes()
}

// encodeModeInfoSingle encodes ModeInfo{1:Single{1:enum sign_mode}}.
func encodeModeInfoSingle(signMode uint64) []byte {
	single := &protoWriter{}
	single.writeEnum(1, signMode)
	w := &protoWriter{}
	w.writeMessage(1, single.bytes())
	return w.bytes()
}

// encodeSignerInfo encodes SignerInfo{1:Any public_key, 2:ModeInfo mode_info,
// 3:uint64 sequence}.
func encodeSignerInfo(compressedPubKey []byte, sequence uint64) []byte {
	pubAny := encodeAny(typeURLSecp256k1PubKey, encodePubKey(compressedPubKey))
	w := &protoWriter{}
	w.writeMessage(1, pubAny)
	w.writeMessage(2, encodeModeInfoSingle(signModeDirect))
	w.writeUint64(3, sequence)
	return w.bytes()
}

// encodeCoin encodes Coin{1:string denom, 2:string amount}.
func encodeCoin(c Coin) []byte {
	w := &protoWriter{}
	w.writeString(1, c.Denom)
	w.writeString(2, c.Amount)
	return w.bytes()
}

// encodeFee encodes Fee{1:repeated Coin amount, 2:uint64 gas_limit}.
func encodeFee(fee Fee) []byte {
	w := &protoWriter{}
	for _, c := range fee.Amount {
		w.writeMessage(1, encodeCoin(c))
	}
	w.writeUint64(2, fee.GasLimit)
	return w.bytes()
}

// encodeAuthInfo encodes AuthInfo{1:repeated SignerInfo, 2:Fee}.
func encodeAuthInfo(compressedPubKey []byte, sequence uint64, fee Fee) []byte {
	w := &protoWriter{}
	w.writeMessage(1, encodeSignerInfo(compressedPubKey, sequence))
	w.writeMessage(2, encodeFee(fee))
	return w.bytes()
}

// encodeSignDoc encodes SignDoc{1:bytes body_bytes, 2:bytes auth_info_bytes,
// 3:string chain_id, 4:uint64 account_number}.
func encodeSignDoc(bodyBytes, authInfoBytes []byte, chainID string, accountNumber uint64) []byte {
	w := &protoWriter{}
	w.writeRawBytes(1, bodyBytes)
	w.writeRawBytes(2, authInfoBytes)
	w.writeString(3, chainID)
	w.writeUint64(4, accountNumber)
	return w.bytes()
}

// encodeTxRaw encodes TxRaw{1:bytes body_bytes, 2:bytes auth_info_bytes,
// 3:repeated bytes signatures}.
func encodeTxRaw(bodyBytes, authInfoBytes []byte, signatures [][]byte) []byte {
	w := &protoWriter{}
	w.writeRawBytes(1, bodyBytes)
	w.writeRawBytes(2, authInfoBytes)
	w.writeRepeatedBytes(3, signatures)
	return w.bytes()
}

// SignDocBytes builds the canonical SignDoc bytes for a transaction.
func SignDocBytes(messages []Msg, memo string, fee Fee, compressedPubKey []byte, sequence uint64, chainID string, accountNumber uint64) []byte {
	body := encodeTxBody(messages, memo)
	authInfo := encodeAuthInfo(compressedPubKey, sequence, fee)
	return encodeSignDoc(body, authInfo, chainID, accountNumber)
}

// SignSignDoc signs the sha256 digest of the SignDoc bytes with a secp256k1
// private key and returns the 64-byte compact signature (r||s) with low-S
// enforced (the form Cosmos expects).
func SignSignDoc(signDocBytes []byte, priv []byte) []byte {
	digest := sha256.Sum256(signDocBytes)
	privKey := secp256k1.PrivKeyFromBytes(priv)
	sig := ecdsa.Sign(privKey, digest[:]) // dcrd enforces low-S
	r := sig.R()
	s := sig.S()
	out := make([]byte, 64)
	r.PutBytesUnchecked(out[0:32])
	s.PutBytesUnchecked(out[32:64])
	return out
}

// VerifySignature verifies a 64-byte compact (r||s) signature over the sha256
// digest of the message against a compressed secp256k1 public key.
func VerifySignature(message []byte, signature []byte, compressedPubKey []byte) bool {
	if len(signature) != 64 {
		return false
	}
	pub, err := secp256k1.ParsePubKey(compressedPubKey)
	if err != nil {
		return false
	}
	var r, s secp256k1.ModNScalar
	if overflow := r.SetByteSlice(signature[0:32]); overflow {
		return false
	}
	if overflow := s.SetByteSlice(signature[32:64]); overflow {
		return false
	}
	sig := ecdsa.NewSignature(&r, &s)
	digest := sha256.Sum256(message)
	return sig.Verify(digest[:], pub)
}

// SignTx builds, signs, and serializes a transaction into TxRaw bytes ready to
// broadcast.
func SignTx(account Account, messages []Msg, memo string, fee Fee, sequence uint64, chainID string, accountNumber uint64) []byte {
	body := encodeTxBody(messages, memo)
	authInfo := encodeAuthInfo(account.PublicKey, sequence, fee)
	signDoc := encodeSignDoc(body, authInfo, chainID, accountNumber)
	signature := SignSignDoc(signDoc, account.PrivateKey)
	return encodeTxRaw(body, authInfo, [][]byte{signature})
}
