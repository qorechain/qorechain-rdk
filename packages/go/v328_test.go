package rdk

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// v328Fixture mirrors testdata/v328.json: vectors for chain v3.2.8 features,
// produced from the chain's own definitions.
type v328Fixture struct {
	Inbox struct {
		ChainID  string `json:"chainId"`
		RollupID string `json:"rollupId"`
		Posts    []struct {
			Sequence uint64 `json:"sequence"`
			Height   uint64 `json:"height"`
			Poster   string `json:"poster"`
			DataHex  string `json:"dataHex"`
			DataHash string `json:"dataHash"`
			Acc      string `json:"acc"`
		} `json:"posts"`
		Range03 string `json:"range_0_3"`
		Range13 string `json:"range_1_3"`
	} `json:"inbox"`
	Privpost struct {
		ChainID  string `json:"chainId"`
		RollupID string `json:"rollupId"`
		Epoch    uint64 `json:"epoch"`
		Members  []struct {
			Member   string `json:"member"`
			Seed     string `json:"seed"`
			EkSha256 string `json:"ekSha256"`
		} `json:"members"`
		PlaintextHex   string `json:"plaintextHex"`
		Envelope       string `json:"envelope"`
		EnvelopeSha256 string `json:"envelopeSha256"`
	} `json:"privpost"`
	MsgProtoHex map[string]string `json:"msgProtoHex"`
	Zk          struct {
		Modulus string `json:"modulus"`
		Cases   []struct {
			Value     string `json:"value"`
			Canonical bool   `json:"canonical"`
			Reduced   string `json:"reduced"`
		} `json:"cases"`
	} `json:"zk"`
}

func loadV328(t *testing.T) v328Fixture {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "v328.json"))
	if err != nil {
		t.Fatalf("read v328 fixture: %v", err)
	}
	var f v328Fixture
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatalf("parse v328 fixture: %v", err)
	}
	return f
}

func TestV328MessageBytes(t *testing.T) {
	f := loadV328(t)
	account := make([]byte, 32)
	account[31] = 1
	cases := map[string]Msg{
		"MsgCreateRollupV328": CreateRollupMsg(CreateRollupInput{
			Creator: "qor1creator", RollupID: "my-rollup", Profile: "nft", VmType: "native",
			StakeAmount: 10_000_000_000, VerificationKey: []byte{9, 8, 7},
			Sequencing: "based", ExecutionVm: "qledger-v1", Privacy: "encapsulated",
		}),
		"MsgSubmitBatchV328": SubmitBatchMsg(SubmitBatchInput{
			Sequencer: "qor1seq", RollupID: "r1", BatchIndex: 7, StateRoot: []byte{1, 2, 3},
			TxCount: 42, DataHash: []byte{9, 9}, InboxEnd: 300,
		}),
		"MsgSetVerificationKey": SetVerificationKeyMsg(SetVerificationKeyInput{
			Creator: "qor1creator", RollupID: "r1", VerificationKey: []byte{1, 2, 3, 4}, ProofSystem: "snark",
		}),
		"MsgUpdateVerificationKey": UpdateVerificationKeyMsg(UpdateVerificationKeyInput{
			Authority: "qor1gov", RollupID: "r1", VerificationKey: []byte{5, 6}, ProofSystem: "snark",
		}),
		"MsgPostRollupData":      PostRollupDataMsg(PostRollupDataInput{Poster: "qor1poster", RollupID: "r1", Data: []byte("hello")}),
		"MsgSetRollupSequencing": SetRollupSequencingMsg(SetRollupSequencingInput{Authority: "qor1gov", RollupID: "r1", Sequencing: "based"}),
		"MsgDepositToRollup": DepositToRollupMsg(DepositToRollupInput{
			Depositor: "qor1dep", RollupID: "r1", Account: account, Amount: 1_000_000,
		}),
		"MsgBondRollupSubmitter":   BondRollupSubmitterMsg(BondRollupSubmitterInput{Submitter: "qor1sub", RollupID: "r1", Amount: 1_000_000_000}),
		"MsgUnbondRollupSubmitter": UnbondRollupSubmitterMsg(UnbondRollupSubmitterInput{Submitter: "qor1sub", RollupID: "r1"}),
		"MsgSetRollupMembers": SetRollupMembersMsg(SetRollupMembersInput{
			Creator: "qor1creator", RollupID: "r1", Members: []string{"qor1a", "qor1b"},
		}),
		"MsgPostRollupDataResponse": MsgPostRollupDataResponse{Sequence: 5, DataHash: []byte{0xaa, 0xbb}},
		"MsgRegisterKEMKey":         RegisterKEMKeyMsg(RegisterKEMKeyInput{Sender: "qor1member", PublicKey: []byte{1, 2, 3, 4}}),
	}
	for name, want := range f.MsgProtoHex {
		msg, ok := cases[name]
		if !ok {
			t.Errorf("fixture entry %s has no Go case", name)
			continue
		}
		if got := BytesToHex(msg.Marshal()); got != want {
			t.Errorf("%s:\n got %s\nwant %s", name, got, want)
		}
	}
	if len(cases) != len(f.MsgProtoHex) {
		t.Errorf("%d Go cases for %d fixture entries", len(cases), len(f.MsgProtoHex))
	}

	var r MsgPostRollupDataResponse
	if err := r.Unmarshal(mustHex(t, f.MsgProtoHex["MsgPostRollupDataResponse"])); err != nil {
		t.Fatal(err)
	}
	if r.Sequence != 5 || BytesToHex(r.DataHash) != "aabb" {
		t.Errorf("decoded response %+v", r)
	}
	for _, m := range []interface {
		Marshal() []byte
	}{MsgDepositToRollupResponse{Sequence: 9}, MsgBondRollupSubmitterResponse{Bond: 7}, MsgUnbondRollupSubmitterResponse{Returned: 3}, MsgSetRollupMembersResponse{Epoch: 2}} {
		b := m.Marshal()
		var v uint64
		switch m.(type) {
		case MsgDepositToRollupResponse:
			var d MsgDepositToRollupResponse
			_ = d.Unmarshal(b)
			v = d.Sequence
		case MsgBondRollupSubmitterResponse:
			var d MsgBondRollupSubmitterResponse
			_ = d.Unmarshal(b)
			v = d.Bond
		case MsgUnbondRollupSubmitterResponse:
			var d MsgUnbondRollupSubmitterResponse
			_ = d.Unmarshal(b)
			v = d.Returned
		case MsgSetRollupMembersResponse:
			var d MsgSetRollupMembersResponse
			_ = d.Unmarshal(b)
			v = d.Epoch
		}
		if v == 0 {
			t.Errorf("%T did not round-trip", m)
		}
	}

	urls := map[string]string{
		MsgSetVerificationKey{}.TypeURL():    "/qorechain.rdk.v1.MsgSetVerificationKey",
		MsgUpdateVerificationKey{}.TypeURL(): "/qorechain.rdk.v1.MsgUpdateVerificationKey",
		MsgPostRollupData{}.TypeURL():        "/qorechain.rdk.v1.MsgPostRollupData",
		MsgSetRollupSequencing{}.TypeURL():   "/qorechain.rdk.v1.MsgSetRollupSequencing",
		MsgDepositToRollup{}.TypeURL():       "/qorechain.rdk.v1.MsgDepositToRollup",
		MsgBondRollupSubmitter{}.TypeURL():   "/qorechain.rdk.v1.MsgBondRollupSubmitter",
		MsgUnbondRollupSubmitter{}.TypeURL(): "/qorechain.rdk.v1.MsgUnbondRollupSubmitter",
		MsgSetRollupMembers{}.TypeURL():      "/qorechain.rdk.v1.MsgSetRollupMembers",
		MsgRegisterKEMKey{}.TypeURL():        "/qorechain.pqc.v1.MsgRegisterKEMKey",
	}
	for got, want := range urls {
		if got != want {
			t.Errorf("type url %s want %s", got, want)
		}
	}
}

func TestV328Inbox(t *testing.T) {
	f := loadV328(t).Inbox
	var acc []byte
	var accs [][]byte
	for _, p := range f.Posts {
		if got := BytesToHex(PostedDataHash(mustHex(t, p.DataHex))); got != p.DataHash {
			t.Errorf("post %d data hash %s want %s", p.Sequence, got, p.DataHash)
		}
		acc = InboxAccumulate(InboxAccumulateInput{
			ChainID: f.ChainID, RollupID: f.RollupID, PrevAcc: acc, Sequence: p.Sequence,
			Height: p.Height, Poster: p.Poster, DataHash: mustHex(t, p.DataHash),
		})
		if BytesToHex(acc) != p.Acc {
			t.Errorf("post %d acc %s want %s", p.Sequence, BytesToHex(acc), p.Acc)
		}
		accs = append(accs, acc)
	}
	r03 := InboxRangeHash(InboxRangeInput{ChainID: f.ChainID, RollupID: f.RollupID, From: 0, To: 3, AccTo: accs[2]})
	if BytesToHex(r03) != f.Range03 {
		t.Errorf("range 0..3 %s want %s", BytesToHex(r03), f.Range03)
	}
	r13 := InboxRangeHash(InboxRangeInput{ChainID: f.ChainID, RollupID: f.RollupID, From: 1, To: 3, AccFrom: accs[0], AccTo: accs[2]})
	if BytesToHex(r13) != f.Range13 {
		t.Errorf("range 1..3 %s want %s", BytesToHex(r13), f.Range13)
	}
}

func TestV328CanonicalZkInputs(t *testing.T) {
	f := loadV328(t).Zk
	if got := BytesToHex(BLS12381ScalarModulus().FillBytes(make([]byte, 32))); got != f.Modulus {
		t.Errorf("modulus %s want %s", got, f.Modulus)
	}
	for _, c := range f.Cases {
		v := mustHex(t, c.Value)
		if IsCanonicalScalar(v) != c.Canonical {
			t.Errorf("IsCanonicalScalar(%s) = %v", c.Value, !c.Canonical)
		}
		if got := BytesToHex(ToCanonicalScalar(v)); got != c.Reduced {
			t.Errorf("ToCanonicalScalar(%s) = %s want %s", c.Value, got, c.Reduced)
		}
	}

	high := mustHex(t, strings.Repeat("ff", 32))
	ok := mustHex(t, strings.Repeat("00", 31)+"01")
	if e := ZkPublicInputErrors(ZkBatchInputs{PrevStateRoot: ok, StateRoot: ok, DataHash: ok}); len(e) != 0 {
		t.Errorf("canonical inputs refused: %v", e)
	}
	if e := ZkPublicInputErrors(ZkBatchInputs{StateRoot: high, DataHash: high, WithdrawalsRoot: high}); len(e) != 2 {
		t.Errorf("want 2 errors (withdrawals_root may be any 32 bytes), got %v", e)
	}
	if e := ZkPublicInputErrors(ZkBatchInputs{StateRoot: ok, DataHash: high}, ZkInputOptions{DataHashBound: true}); len(e) != 0 {
		t.Errorf("a bound data hash was checked: %v", e)
	}
	if e := ZkPublicInputErrors(ZkBatchInputs{StateRoot: ok, WithdrawalsRoot: []byte{}}); len(e) != 0 {
		t.Errorf("an empty withdrawals root was refused: %v", e)
	}
	if !IsDataHashChainBound(RollupView{DABackend: "celestia", Sequencing: "based"}, nil) {
		t.Error("a based rollup's data hash is bound")
	}
	if !IsDataHashChainBound(RollupView{DABackend: "native"}, high) {
		t.Error("a native non-empty data hash is bound")
	}
	if IsDataHashChainBound(RollupView{DABackend: "native"}, nil) {
		t.Error("an empty data hash is not bound")
	}
	if IsDataHashChainBound(RollupView{DABackend: "celestia"}, high) {
		t.Error("a celestia data hash is not bound")
	}
}

// testRand is the fixture's deterministic stream: byte i is byte i mod 32 of
// SHA-256("qorechain-rdk-test-rand" || be64(i / 32)).
type testRand struct{ n uint64 }

func (r *testRand) Read(p []byte) (int, error) {
	for i := range p {
		var c [8]byte
		binary.BigEndian.PutUint64(c[:], r.n/32)
		blk := sha256.Sum256(append([]byte("qorechain-rdk-test-rand"), c[:]...))
		p[i] = blk[r.n%32]
		r.n++
	}
	return len(p), nil
}

func v328Recipients(t *testing.T) ([]EnvelopeRecipient, v328Fixture) {
	t.Helper()
	f := loadV328(t)
	var out []EnvelopeRecipient
	for _, m := range f.Privpost.Members {
		kp, err := KemKeypairFromSeed(mustHex(t, m.Seed))
		if err != nil {
			t.Fatal(err)
		}
		if got := BytesToHex(KemKeyFingerprint(kp.PublicKey)); got != m.EkSha256 {
			t.Errorf("%s key fingerprint %s want %s", m.Member, got, m.EkSha256)
		}
		out = append(out, EnvelopeRecipient{Member: m.Member, EncapsulationKey: kp.PublicKey})
	}
	return out, f
}

func TestV328EnvelopeOpensAsEachMember(t *testing.T) {
	_, f := v328Recipients(t)
	p := f.Privpost
	envelope := mustHex(t, p.Envelope)
	env, err := ParseEnvelope(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if env.Epoch != p.Epoch || len(env.Entries) != len(p.Members) {
		t.Fatalf("parsed epoch %d with %d entries", env.Epoch, len(env.Entries))
	}
	for i, m := range p.Members {
		if env.Entries[i].Member != m.Member {
			t.Errorf("entry %d is %s", i, env.Entries[i].Member)
		}
		seed := mustHex(t, m.Seed)
		out, err := OpenEnvelope(OpenEnvelopeInput{Envelope: envelope, ChainID: p.ChainID, RollupID: p.RollupID, Member: m.Member, DecapsulationKey: seed})
		if err != nil || BytesToHex(out) != p.PlaintextHex {
			t.Errorf("%s (seed): %v %x", m.Member, err, out)
		}
		kp, _ := KemKeypairFromSeed(seed)
		out, err = OpenEnvelope(OpenEnvelopeInput{Envelope: envelope, ChainID: p.ChainID, RollupID: p.RollupID, Member: m.Member, DecapsulationKey: kp.SecretKey})
		if err != nil || BytesToHex(out) != p.PlaintextHex {
			t.Errorf("%s (expanded key): %v %x", m.Member, err, out)
		}
	}
}

func TestV328SealIsDeterministic(t *testing.T) {
	recipients, f := v328Recipients(t)
	p := f.Privpost
	env, err := SealEnvelope(SealEnvelopeInput{
		ChainID: p.ChainID, RollupID: p.RollupID, Epoch: p.Epoch, Recipients: recipients,
		Plaintext: mustHex(t, p.PlaintextHex), Rand: &testRand{},
	})
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(env)
	if BytesToHex(sum[:]) != p.EnvelopeSha256 {
		t.Errorf("sealed envelope sha256 %x want %s", sum, p.EnvelopeSha256)
	}
	if BytesToHex(env) != p.Envelope {
		t.Error("sealed envelope differs from the chain's")
	}
}

func TestV328EnvelopeRefusals(t *testing.T) {
	recipients, f := v328Recipients(t)
	p := f.Privpost
	m := p.Members[0]
	open := func(envelope []byte, rollupID, member string) error {
		_, err := OpenEnvelope(OpenEnvelopeInput{Envelope: envelope, ChainID: p.ChainID, RollupID: rollupID, Member: member, DecapsulationKey: mustHex(t, m.Seed)})
		return err
	}
	envelope := mustHex(t, p.Envelope)
	if err := open(envelope, p.RollupID, "qor1nobody"); !errors.Is(err, ErrEnvelopeNotMember) || !strings.Contains(err.Error(), "no entry") {
		t.Errorf("unknown member: %v", err)
	}
	if err := open(envelope, "other", m.Member); !errors.Is(err, ErrEnvelopeOpen) || !strings.Contains(err.Error(), "does not open") {
		t.Errorf("wrong rollup: %v", err)
	}
	tampered := append([]byte(nil), envelope...)
	tampered[len(tampered)-1] ^= 1
	if err := open(tampered, p.RollupID, m.Member); !errors.Is(err, ErrEnvelopeOpen) {
		t.Errorf("tampered payload: %v", err)
	}
	if _, err := ParseEnvelope(envelope[:40]); !errors.Is(err, ErrEnvelopeMalformed) {
		t.Errorf("truncated envelope: %v", err)
	}

	fresh, err := SealEnvelope(SealEnvelopeInput{ChainID: p.ChainID, RollupID: p.RollupID, Epoch: 1, Recipients: recipients, Plaintext: mustHex(t, p.PlaintextHex)})
	if err != nil {
		t.Fatal(err)
	}
	if e := EnvelopeMembershipError(fresh, 1, recipients); e != "" {
		t.Errorf("a valid envelope was refused: %s", e)
	}
	if e := EnvelopeMembershipError(fresh, 2, recipients); !strings.Contains(e, "epoch") {
		t.Errorf("wrong epoch: %q", e)
	}
	reversed := []EnvelopeRecipient{recipients[1], recipients[0]}
	if e := EnvelopeMembershipError(fresh, 1, reversed); !strings.Contains(e, "entry 0") {
		t.Errorf("wrong order: %q", e)
	}
	if e := EnvelopeMembershipError(fresh, 1, recipients[:1]); !strings.Contains(e, "2 entries") {
		t.Errorf("wrong count: %q", e)
	}
	swapped := []EnvelopeRecipient{{Member: recipients[0].Member, EncapsulationKey: recipients[1].EncapsulationKey}, recipients[1]}
	if e := EnvelopeMembershipError(fresh, 1, swapped); !strings.Contains(e, "registered KEM key") {
		t.Errorf("wrong key: %q", e)
	}
	if e := EnvelopeMembershipError(fresh, 1, nil); !strings.Contains(e, "no members") {
		t.Errorf("no members: %q", e)
	}
}

func TestV328ConfigurationRules(t *testing.T) {
	for _, name := range []Profile{ProfileNFT, ProfileCustom} {
		d := PresetDefaults[name]
		if d.ExecutionVm != ExecutionVmQLedgerV1 || d.Sequencing != SequencingBased {
			t.Errorf("%s preset: executionVm %q sequencing %q", name, d.ExecutionVm, d.Sequencing)
		}
		cfg := d
		cfg.RollupID = "my-rollup"
		if r := ValidateRollupConfig(cfg); len(r.Errors) != 0 {
			t.Errorf("%s preset refused: %v", name, r.Errors)
		}
		in, err := Preset(name).SetRollupID("my-rollup").ToCreateMsg("qor1c", "1")
		if err != nil {
			t.Fatal(err)
		}
		if in.ExecutionVm != ExecutionVmQLedgerV1 || in.Sequencing != SequencingBased {
			t.Errorf("%s create inputs lost the modes: %+v", name, in)
		}
		ci, err := in.ToCreateRollupInput()
		if err != nil {
			t.Fatal(err)
		}
		msg := CreateRollupMsg(ci)
		if msg.ExecutionVm != "qledger-v1" || msg.Sequencing != "based" || msg.Profile != string(name) {
			t.Errorf("%s message lost the modes: %+v", name, msg)
		}
	}

	custom := PresetDefaults[ProfileCustom]
	custom.RollupID = "my-rollup"
	custom.ExecutionVm, custom.Sequencing = "", ""
	if ValidateRollupConfig(custom).Valid {
		t.Error("an optimistic rollup without an execution VM was accepted")
	}
	if IsProofCompatible(SettlementZK, ProofStark) {
		t.Error("zk/stark must be incompatible")
	}
	stark := PresetDefaults[ProfileDefi]
	stark.RollupID = "my-rollup"
	stark.ProofSystem = ProofStark
	if r := ValidateRollupConfig(stark); !strings.Contains(strings.Join(r.Errors, ","), "paused") {
		t.Errorf("stark not refused as paused: %v", r.Errors)
	}
	if !contains(ProofSystems, ProofStark) {
		t.Error("stark must stay a known proof system")
	}

	mode := func(in RollupModeInput) string { return strings.Join(RollupModeErrors(in), ",") }
	if e := RollupModeErrors(RollupModeInput{Settlement: "zk", ProofSystem: "snark", Sequencing: "based", Privacy: "encapsulated"}); len(e) != 0 {
		t.Errorf("zk/snark based private refused: %v", e)
	}
	if e := RollupModeErrors(RollupModeInput{Settlement: "based", ProofSystem: "none", Sequencing: "based"}); len(e) != 0 {
		t.Errorf("based/based refused: %v", e)
	}
	if e := RollupModeErrors(RollupModeInput{Settlement: "sovereign", ProofSystem: "none", Sequencing: "based"}); len(e) != 1 {
		t.Errorf("sovereign based: %v", e)
	}
	if e := mode(RollupModeInput{Settlement: "zk", ProofSystem: "snark", ExecutionVm: "qledger-v1", Sequencing: "based"}); !strings.Contains(e, "optimistic") {
		t.Errorf("zk qledger: %q", e)
	}
	if e := mode(RollupModeInput{Settlement: "optimistic", ProofSystem: "fraud", ExecutionVm: "qledger-v1"}); !strings.Contains(e, "based") {
		t.Errorf("qledger not based: %q", e)
	}
	if e := RollupModeErrors(RollupModeInput{Settlement: "optimistic", ProofSystem: "fraud", ExecutionVm: "qledger-v1", Sequencing: "based", Privacy: "encapsulated"}); len(e) == 0 {
		t.Error("a private qledger rollup was accepted")
	}
	if e := mode(RollupModeInput{Settlement: "based", ProofSystem: "none", Privacy: "encapsulated"}); !strings.Contains(e, "private rollup") {
		t.Errorf("private based: %q", e)
	}

	if DataHashError("native", []byte{0xab}) == "" {
		t.Error("a native data hash must be refused before posted data")
	}
	if e := DataHashError("native", []byte{0xab}, DataHashOptions{PostedDataEnabled: true}); e != "" {
		t.Errorf("a native data hash must pass once posted data is on: %s", e)
	}
}

func TestV328ErrorKinds(t *testing.T) {
	for code, kind := range map[uint32]string{48: "invalid_rollup_mode", 52: "stark_statement_unsupported", 46: "invalid_inbox_range", 2: "rollup_not_found", 54: "deposit_pool_not_empty"} {
		if d := DecodeRdkTxError(code, "rdk", ""); d == nil || d.Kind != kind {
			t.Errorf("code %d: %+v want %s", code, d, kind)
		}
	}
	for code := uint32(2); code <= 54; code++ {
		if _, ok := RdkErrors[code]; !ok {
			t.Errorf("rdk code %d missing", code)
		}
	}
	if d := DecodeRdkTxError(5, "sdk", ""); d == nil || d.Kind != "" || d.Message == "" {
		t.Errorf("sdk fallback: %+v", d)
	}
	if DecodeRdkTxError(0, "rdk", "") != nil {
		t.Error("code 0 is success")
	}
}

func TestV328ClientChecks(t *testing.T) {
	acc, err := DeriveNativeAccount("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", 0)
	if err != nil {
		t.Fatal(err)
	}
	backend := &recordingBackend{}
	tx := NewRdkTxClient(acc, TestnetChainID, nil).WithBackend(backend)
	ctx := context.Background()

	if _, err := tx.SetVerificationKey(SetVerificationKeyInput{RollupID: "r1", VerificationKey: []byte{1}, ProofSystem: "stark"}); err == nil {
		t.Error("a stark key was accepted")
	}
	if m, err := tx.SetVerificationKey(SetVerificationKeyInput{RollupID: "r1", VerificationKey: []byte{1}, ProofSystem: "snark"}); err != nil || m.Creator != acc.Address {
		t.Errorf("snark key: %v %+v", err, m)
	}
	if _, err := tx.PostRollupData("r1", nil); err == nil {
		t.Error("empty data was accepted")
	}
	good := make([]byte, 32)
	good[0] = 1
	if _, err := tx.DepositToRollup("r1", make([]byte, 32), MinRollupDepositUqor); err == nil {
		t.Error("a zero account was accepted")
	}
	if _, err := tx.DepositToRollup("r1", good[:31], MinRollupDepositUqor); err == nil {
		t.Error("a 31-byte account was accepted")
	}
	if _, err := tx.DepositToRollup("r1", good, MinRollupDepositUqor-1); err == nil {
		t.Error("a deposit below 1 QOR was accepted")
	}
	if m, err := tx.DepositToRollup("r1", good, MinRollupDepositUqor); err != nil || m.Depositor != acc.Address {
		t.Errorf("deposit: %v", err)
	}
	if _, err := tx.BondRollupSubmitter("r1", 0); err == nil {
		t.Error("a zero bond was accepted")
	}
	if _, err := tx.SetRollupMembers("r1", nil); err == nil {
		t.Error("no members was accepted")
	}
	if _, err := tx.SetRollupMembers("r1", []string{"a", "a"}); err == nil {
		t.Error("a duplicate member was accepted")
	}
	if _, err := tx.SetRollupMembers("r1", make([]string, MaxRollupMembers+1)); err == nil {
		t.Error("33 members were accepted")
	}
	if _, err := tx.RegisterKEMKey([]byte{1, 2, 3}); err == nil {
		t.Error("a short KEM key was accepted")
	}
	if m, err := tx.RegisterKEMKey(make([]byte, EncapsulationKeySize)); err != nil || m.AlgorithmID != MlKem1024AlgorithmID || m.Sender != acc.Address {
		t.Errorf("register KEM key: %v %+v", err, m)
	}

	// Broadcast refuses the same messages built by hand, and a create whose
	// modes the preset's settlement does not allow.
	for _, bad := range []Msg{
		MsgDepositToRollup{Depositor: acc.Address, RollupID: "r1", Account: good, Amount: 1},
		MsgSetRollupMembers{Creator: acc.Address, RollupID: "r1"},
		MsgCreateRollup{Creator: acc.Address, RollupID: "my-rollup", Profile: "nft", VmType: "cosmwasm", StakeAmount: 1},
		MsgCreateRollup{Creator: acc.Address, RollupID: "my-rollup", Profile: "defi", VmType: "evm", StakeAmount: 1, ExecutionVm: "qledger-v1"},
	} {
		if _, err := tx.Broadcast(ctx, []Msg{bad}, TxParams{}); err == nil {
			t.Errorf("%T was not refused", bad)
		}
	}
	nft := tx.CreateRollup(CreateRollupInput{RollupID: "my-rollup", Profile: "nft", VmType: "native", StakeAmount: 1, ExecutionVm: "qledger-v1", Sequencing: "based"})
	if _, err := tx.Broadcast(ctx, []Msg{nft}, TxParams{}); err != nil {
		t.Errorf("a qledger nft rollup was refused: %v", err)
	}
	if backend.calls != 1 {
		t.Errorf("%d messages reached signing, want 1", backend.calls)
	}
}

// v328Server serves a rollup, protocol features, an inbox and KEM keys.
func v328Server(t *testing.T, rollup map[string]any, features map[string]bool, kem map[string]any) (*httptest.Server, *[]string) {
	t.Helper()
	var paths []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		var body any
		switch {
		case strings.HasPrefix(r.URL.Path, "/qorechain/rdk/v1/rollup/"):
			body = map[string]any{"rollup": rollup}
		case r.URL.Path == "/qorechain/pqc/v1/protocol_features":
			var list []any
			for name, on := range features {
				list = append(list, map[string]any{"name": name, "enabled": on})
			}
			body = map[string]any{"features": list}
		case strings.HasPrefix(r.URL.Path, "/qorechain/rdk/v1/inbox/"):
			body = map[string]any{"inbox": map[string]any{"rollup_id": "r1", "head_sequence": "4", "range_end": "3", "range_data_hash": "abcd"}}
		case strings.HasPrefix(r.URL.Path, "/qorechain/pqc/v1/kem/"):
			addr := strings.TrimPrefix(r.URL.Path, "/qorechain/pqc/v1/kem/")
			if k, ok := kem[addr]; ok {
				body = map[string]any{"found": true, "key": k}
			} else {
				body = map[string]any{"found": false}
			}
		default:
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(srv.Close)
	return srv, &paths
}

func TestV328RestQueries(t *testing.T) {
	recipients, _ := v328Recipients(t)
	kem := map[string]any{}
	for _, r := range recipients {
		kem[r.Member] = map[string]any{"address": r.Member, "algorithm_id": 2, "algorithm_name": "ML-KEM-1024", "public_key": BytesToHex(r.EncapsulationKey), "registered_height": "10"}
	}
	rollup := map[string]any{
		"rollup_id": "r1", "privacy": "encapsulated", "members_epoch": "3",
		"members": []any{recipients[0].Member, recipients[1].Member}, "deposit_pool": "5",
	}
	srv, paths := v328Server(t, rollup, nil, kem)
	rest := NewRestClient(srv.URL, srv.Client())
	ctx := context.Background()

	if _, err := rest.GetInbox(ctx, "r1", 0); err != nil {
		t.Fatal(err)
	}
	in, err := rest.GetInbox(ctx, "r1", 3)
	if err != nil {
		t.Fatal(err)
	}
	if in.HeadSequence != 4 || in.RangeEnd != 3 || in.RangeDataHash != "abcd" {
		t.Errorf("inbox %+v", in)
	}
	if (*paths)[0] != "/qorechain/rdk/v1/inbox/r1" || (*paths)[1] != "/qorechain/rdk/v1/inbox/r1?inbox_end=3" {
		t.Errorf("inbox paths %v", *paths)
	}
	if k, err := rest.GetKemKey(ctx, "qor1nobody"); err != nil || k != nil {
		t.Errorf("missing key: %v %v", k, err)
	}
	got, err := rest.GetPrivateRollupRecipients(ctx, "r1")
	if err != nil {
		t.Fatal(err)
	}
	if got.Epoch != 3 || len(got.Recipients) != 2 || got.Recipients[1].Member != recipients[1].Member ||
		BytesToHex(got.Recipients[0].EncapsulationKey) != BytesToHex(recipients[0].EncapsulationKey) {
		t.Errorf("recipients %+v", got)
	}

	delete(kem, recipients[1].Member)
	if _, err := rest.GetPrivateRollupRecipients(ctx, "r1"); err == nil || !strings.Contains(err.Error(), "no ML-KEM-1024 key") {
		t.Errorf("a member without a key: %v", err)
	}
	rollup["privacy"] = ""
	if _, err := rest.GetPrivateRollupRecipients(ctx, "r1"); err == nil || !strings.Contains(err.Error(), "not private") {
		t.Errorf("a public rollup: %v", err)
	}
	view := MapRollupView(rollup)
	if len(view.Members) != 2 || view.MembersEpoch != 3 || view.DepositPool != "5" {
		t.Errorf("rollup view %+v", view)
	}
}

func TestV328CheckSubmitBatch(t *testing.T) {
	acc, err := DeriveNativeAccount("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", 0)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	high := mustHex(t, strings.Repeat("ff", 32))
	check := func(rollup map[string]any, features map[string]bool, m MsgSubmitBatch) error {
		srv, _ := v328Server(t, rollup, features, nil)
		tx := NewRdkTxClient(acc, TestnetChainID, NewRestClient(srv.URL, srv.Client()))
		return tx.CheckSubmitBatch(ctx, m)
	}
	based := map[string]any{"sequencing": "based", "da_backend": "native", "settlement_mode": "based"}
	if err := check(based, nil, MsgSubmitBatch{RollupID: "r1", BatchIndex: 1}); err == nil || !strings.Contains(err.Error(), "InboxEnd") {
		t.Errorf("based without InboxEnd: %v", err)
	}
	if err := check(based, nil, MsgSubmitBatch{RollupID: "r1", BatchIndex: 1, InboxEnd: 3, DataHash: high}); err != nil {
		t.Errorf("based with InboxEnd: %v", err)
	}
	plain := map[string]any{"da_backend": "native", "settlement_mode": "optimistic"}
	if err := check(plain, nil, MsgSubmitBatch{RollupID: "r1", BatchIndex: 1, InboxEnd: 3}); err == nil {
		t.Error("InboxEnd on a rollup that is not based was accepted")
	}
	if err := check(plain, nil, MsgSubmitBatch{RollupID: "r1", BatchIndex: 1, DataHash: []byte{1}}); err == nil {
		t.Error("a native data hash was accepted before posted data")
	}
	if err := check(plain, map[string]bool{FeatureRDKPostRollupData: true}, MsgSubmitBatch{RollupID: "r1", BatchIndex: 1, DataHash: []byte{1}}); err != nil {
		t.Errorf("a native data hash with posted data on: %v", err)
	}
	stark := map[string]any{"da_backend": "celestia", "settlement_mode": "zk", "proof_system": "stark"}
	if err := check(stark, map[string]bool{FeatureRDKStarkStatement: true}, MsgSubmitBatch{RollupID: "r1", BatchIndex: 1}); err == nil || !strings.Contains(err.Error(), "paused") {
		t.Errorf("stark batch: %v", err)
	}
	snark := map[string]any{"da_backend": "celestia", "settlement_mode": "zk", "proof_system": "snark"}
	if err := check(snark, map[string]bool{FeatureRDKZkCanonicalInputs: true}, MsgSubmitBatch{RollupID: "r1", BatchIndex: 1, StateRoot: high}); err == nil || !strings.Contains(err.Error(), "state_root") {
		t.Errorf("non-canonical state root: %v", err)
	}
	if err := check(snark, nil, MsgSubmitBatch{RollupID: "r1", BatchIndex: 1, StateRoot: high}); err != nil {
		t.Errorf("canonical inputs are only checked behind the switch: %v", err)
	}
}
