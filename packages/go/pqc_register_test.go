package rdk

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	sdkmessages "github.com/qorechain/qorechain-sdk/packages/go/qorechain/messages"
	pqcv1 "github.com/qorechain/qorechain-sdk/packages/go/qorechain/proto/qorechain/pqc/v1"
)

// decodedTx is the part of a TxRaw the registration tests look at.
type decodedTx struct {
	typeURLs     []string
	firstValue   []byte
	embeddedKey  []byte
	sequence     uint64
	gasLimit     uint64
	feeAmount    string
	feeDenom     string
	hasExtension bool
}

func mustFields(t *testing.T, b []byte) []protoField {
	t.Helper()
	fields, err := readProtoFields(b)
	if err != nil {
		t.Fatal(err)
	}
	return fields
}

func fieldBytes(fields []protoField, num int) [][]byte {
	out := [][]byte{}
	for _, f := range fields {
		if f.num == num && f.wire == wireBytes {
			out = append(out, f.bytes)
		}
	}
	return out
}

func fieldVarint(fields []protoField, num int) uint64 {
	for _, f := range fields {
		if f.num == num && f.wire == wireVarint {
			return f.varint
		}
	}
	return 0
}

func decodeTestTx(t *testing.T, raw []byte) decodedTx {
	t.Helper()
	var d decodedTx
	txRaw := mustFields(t, raw)
	body := mustFields(t, fieldBytes(txRaw, 1)[0])
	for i, anyBytes := range fieldBytes(body, 1) {
		a := mustFields(t, anyBytes)
		d.typeURLs = append(d.typeURLs, string(fieldBytes(a, 1)[0]))
		if i == 0 {
			d.firstValue = fieldBytes(a, 2)[0]
		}
	}
	if ext := fieldBytes(body, 1023); len(ext) > 0 {
		d.hasExtension = true
		value := mustFields(t, fieldBytes(mustFields(t, ext[0]), 2)[0])
		if keys := fieldBytes(value, 3); len(keys) > 0 {
			d.embeddedKey = keys[0]
		}
	}
	authInfo := mustFields(t, fieldBytes(txRaw, 2)[0])
	signerInfo := mustFields(t, fieldBytes(authInfo, 1)[0])
	d.sequence = fieldVarint(signerInfo, 3)
	fee := mustFields(t, fieldBytes(authInfo, 2)[0])
	d.gasLimit = fieldVarint(fee, 2)
	if coins := fieldBytes(fee, 1); len(coins) > 0 {
		coin := mustFields(t, coins[0])
		d.feeDenom = string(fieldBytes(coin, 1)[0])
		d.feeAmount = string(fieldBytes(coin, 2)[0])
	}
	return d
}

// fastRegistrationPolling shortens the commit wait for a test.
func fastRegistrationPolling(t *testing.T) {
	t.Helper()
	interval, timeout := pqcRegistrationPollInterval, pqcRegistrationTimeout
	pqcRegistrationPollInterval, pqcRegistrationTimeout = time.Millisecond, 2*time.Second
	t.Cleanup(func() { pqcRegistrationPollInterval, pqcRegistrationTimeout = interval, timeout })
}

// keylessTxClient is a hybrid client whose key is not registered yet.
func keylessTxClient(t *testing.T, m *mockRest) (*RdkTxClient, []Msg, TxParams, PqcKeypair, string) {
	t.Helper()
	acc, kp, msgs, params, h := goldenHybridInput(t)
	client := mockRdkClient(m)
	client.Network.ChainID = h.ChainID
	tx := client.ConnectTx(acc, &HybridOptions{PqcKeypair: kp, IncludePqcPublicKey: true, SignBytesVersion: SignBytesV2})
	return tx, msgs, params, kp, h.ChainID
}

// expectedTx is the transaction a registered client signs for msgs at seq.
func expectedTx(t *testing.T, tx *RdkTxClient, msgs []Msg, p TxParams, seq uint64) []byte {
	t.Helper()
	plain := NewRdkTxClient(tx.Account, tx.ChainID, nil).WithHybrid(HybridOptions{PqcKeypair: tx.Hybrid.PqcKeypair, SignBytesVersion: SignBytesV2})
	p.Sequence = seq
	built, err := plain.BuildTx(context.Background(), msgs, p)
	if err != nil {
		t.Fatal(err)
	}
	return built.TxRaw
}

func TestKeylessClientRegistersTheKeyFirst(t *testing.T) {
	fastRegistrationPolling(t)
	m := &mockRest{
		responses: []string{`{"tx_response":{"code":0,"txhash":"REGHASH"}}`},
		// Not in a block yet, then committed.
		txLookups: []string{"", `{"tx_response":{"code":0,"txhash":"REGHASH","height":"10"}}`},
	}
	tx, msgs, params, kp, chainID := keylessTxClient(t, m)
	if _, err := tx.Broadcast(context.Background(), msgs, params); err != nil {
		t.Fatal(err)
	}
	if len(m.broadcast) != 2 {
		t.Fatalf("expected the registration then the transaction, got %d broadcasts", len(m.broadcast))
	}

	reg := decodeTestTx(t, m.broadcast[0])
	if len(reg.typeURLs) != 1 || reg.typeURLs[0] != TypeURLMsgRegisterPQCKeyV2 {
		t.Fatalf("the first transaction must carry only MsgRegisterPQCKeyV2, got %v", reg.typeURLs)
	}
	if reg.sequence != params.Sequence || reg.gasLimit != 600000 || reg.feeAmount != "90000" || reg.feeDenom != "uqor" {
		t.Errorf("registration: sequence %d gas %d fee %s%s", reg.sequence, reg.gasLimit, reg.feeAmount, reg.feeDenom)
	}
	if !bytes.Equal(reg.embeddedKey, kp.PublicKey) {
		t.Error("the registration must embed the public key in the extension")
	}
	f := mustFields(t, reg.firstValue)
	if string(fieldBytes(f, 1)[0]) != tx.Account.Address || !bytes.Equal(fieldBytes(f, 2)[0], kp.PublicKey) ||
		fieldVarint(f, 3) != 1 || string(fieldBytes(f, 5)[0]) != "hybrid" || len(fieldBytes(f, 4)) != 0 {
		t.Error("MsgRegisterPQCKeyV2 fields differ")
	}
	pop := fieldBytes(f, 6)[0]
	if !sdkmessages.VerifyProofOfPossession(chainID, tx.Account.Address, kp.PublicKey, pop) {
		t.Error("the proof of possession does not verify")
	}

	sent := decodeTestTx(t, m.broadcast[1])
	if sent.embeddedKey != nil || sent.sequence != params.Sequence+1 {
		t.Errorf("the transaction must follow at the next sequence without the key: sequence %d key %v", sent.sequence, sent.embeddedKey != nil)
	}
	if !bytes.Equal(m.broadcast[1], expectedTx(t, tx, msgs, params, params.Sequence+1)) {
		t.Error("the transaction differs from a registered client's")
	}
	if tx.Hybrid.IncludePqcPublicKey {
		t.Error("IncludePqcPublicKey must be cleared once the key is registered")
	}

	// The key is registered now: the next transaction goes alone.
	params.Sequence += 2
	if _, err := tx.Broadcast(context.Background(), msgs, params); err != nil {
		t.Fatal(err)
	}
	if len(m.broadcast) != 3 {
		t.Errorf("a registered client must not register again, got %d broadcasts", len(m.broadcast))
	}
}

func TestKeylessClientAcceptsAlreadyRegistered(t *testing.T) {
	fastRegistrationPolling(t)
	t.Run("refused at admission", func(t *testing.T) {
		m := &mockRest{responses: []string{`{"tx_response":{"code":7,"codespace":"pqc","raw_log":"PQC key already registered","txhash":"REGHASH"}}`}}
		tx, msgs, params, _, _ := keylessTxClient(t, m)
		if _, err := tx.Broadcast(context.Background(), msgs, params); err != nil {
			t.Fatal(err)
		}
		if len(m.broadcast) != 2 {
			t.Fatalf("expected the registration then the transaction, got %d broadcasts", len(m.broadcast))
		}
		// Nothing was committed, so the transaction keeps the sequence.
		if !bytes.Equal(m.broadcast[1], expectedTx(t, tx, msgs, params, params.Sequence)) {
			t.Error("the transaction must be sent at the unused sequence, without the key")
		}
		for _, p := range m.paths {
			if strings.HasPrefix(p, "/cosmos/tx/v1beta1/txs/") {
				t.Error("a refused registration must not be waited for")
			}
		}
	})
	t.Run("refused in the block", func(t *testing.T) {
		m := &mockRest{
			responses: []string{`{"tx_response":{"code":0,"txhash":"REGHASH"}}`},
			txLookups: []string{`{"tx_response":{"code":7,"codespace":"pqc","raw_log":"PQC key already registered","txhash":"REGHASH"}}`},
		}
		tx, msgs, params, _, _ := keylessTxClient(t, m)
		if _, err := tx.Broadcast(context.Background(), msgs, params); err != nil {
			t.Fatal(err)
		}
		if len(m.broadcast) != 2 || !bytes.Equal(m.broadcast[1], expectedTx(t, tx, msgs, params, params.Sequence+1)) {
			t.Error("the transaction must follow at the next sequence, without the key")
		}
	})
}

func TestKeylessClientRegistrationFailureStops(t *testing.T) {
	fastRegistrationPolling(t)
	m := &mockRest{responses: []string{`{"tx_response":{"code":5,"codespace":"sdk","raw_log":"insufficient funds","txhash":"REGHASH"}}`}}
	tx, msgs, params, _, _ := keylessTxClient(t, m)
	_, err := tx.Broadcast(context.Background(), msgs, params)
	if err == nil || !strings.Contains(err.Error(), "code 5") {
		t.Fatalf("expected the registration failure, got %v", err)
	}
	if len(m.broadcast) != 1 {
		t.Errorf("nothing may follow a failed registration, got %d broadcasts", len(m.broadcast))
	}
	if !tx.Hybrid.IncludePqcPublicKey {
		t.Error("IncludePqcPublicKey must stay set when the registration failed")
	}
}

func TestKeylessClientSendsRegistrationOnlyAsIs(t *testing.T) {
	m := &mockRest{}
	tx, _, params, kp, chainID := keylessTxClient(t, m)
	reg, err := PqcRegistrationMsg(chainID, tx.Account.Address, kp)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Broadcast(context.Background(), []Msg{reg}, params); err != nil {
		t.Fatal(err)
	}
	if len(m.broadcast) != 1 {
		t.Fatalf("a registration needs no registration first, got %d broadcasts", len(m.broadcast))
	}
	if sent := decodeTestTx(t, m.broadcast[0]); !bytes.Equal(sent.embeddedKey, kp.PublicKey) || sent.sequence != params.Sequence {
		t.Error("the registration must go at the given sequence with the key embedded")
	}
}

func TestPqcRegistrationOnly(t *testing.T) {
	reg := MsgRegisterPQCKeyV2{}
	pause := PauseRollupMsg(PauseRollupInput{Creator: "qor1x", RollupID: "r", Reason: "x"})
	if !isPqcRegistrationOnly([]Msg{reg, reg}) {
		t.Error("registrations only")
	}
	if isPqcRegistrationOnly([]Msg{reg, pause}) || isPqcRegistrationOnly(nil) {
		t.Error("a mixed or empty list is not registration-only")
	}
}

func TestPqcRegistrationMsgRefusesDegenerateKey(t *testing.T) {
	kp := PqcKeypair{PublicKey: make([]byte, 2592)}
	if _, err := PqcRegistrationMsg("qorechain-diana", "qor1x", kp); err == nil {
		t.Error("a degenerate key must be refused")
	}
}

func TestMsgRegisterPQCKeyV2MatchesTheChainEncoding(t *testing.T) {
	m := MsgRegisterPQCKeyV2{
		Sender:            "qor1sender",
		PublicKey:         bytes.Repeat([]byte{0xab}, 2592),
		AlgorithmID:       1,
		ECDSAPubkey:       bytes.Repeat([]byte{0x02}, 33),
		KeyType:           "hybrid",
		ProofOfPossession: bytes.Repeat([]byte{0xcd}, 4627),
	}
	want, err := (&pqcv1.MsgRegisterPQCKeyV2{
		Sender:            m.Sender,
		PublicKey:         m.PublicKey,
		AlgorithmID:       pqcv1.AlgorithmID(m.AlgorithmID),
		ECDSAPubkey:       m.ECDSAPubkey,
		KeyType:           m.KeyType,
		ProofOfPossession: m.ProofOfPossession,
	}).Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(m.Marshal(), want) {
		t.Error("MsgRegisterPQCKeyV2 encoding differs from the chain's")
	}
	if m.TypeURL() != "/qorechain.pqc.v1.MsgRegisterPQCKeyV2" {
		t.Error("type url")
	}
}
