package rdk

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math/bits"
)

// qledger-v1 fraud proofs: the challenger's side (build) and the chain's
// decision (check), so a watcher can decide a batch locally before paying.
//
//	"QLFP" | 0x01 | acc_from[32] | be16(n) | n x (be64(height) | be16(len) poster | be32(len) payload)
//	| be16(m) | m x (id[32] | be64(balance) | be64(nonce) | bitmap[32] | popcount(bitmap) x sibling[32])

const (
	// QledgerMaxBatchEntries is the most inbox entries one qledger-v1 batch may
	// consume.
	QledgerMaxBatchEntries = 64
	// QledgerMaxPostBytes is the largest post a qledger-v1 rollup accepts.
	QledgerMaxPostBytes = 6 * 1024

	qledgerMaxWitnesses = 2 * QledgerMaxBatchEntries
	qledgerMaxPosterLen = 256
	qledgerFraudMagic   = "QLFP"
)

var (
	// ErrQledgerMalformedProof is returned for a fraud proof that does not
	// parse or is over the bounds.
	ErrQledgerMalformedProof = errors.New("qledger: malformed fraud proof")
	// ErrQledgerProofNotApplicable is returned when a fraud proof is not about
	// the batch (wrong entries, or a batch without a 32-byte parent root).
	// Nothing is decided.
	ErrQledgerProofNotApplicable = errors.New("qledger: the fraud proof does not apply")
)

// QledgerFraudProof is what a challenger sends against a qledger-v1 batch: the
// inbox accumulator at the batch's start, every entry it consumed, and a
// witness for every account those entries touch, against the batch's parent
// state root.
type QledgerFraudProof struct {
	AccFrom   [32]byte
	Entries   []QledgerEntry
	Witnesses []QledgerWitness
}

// Encode is the proof's wire form.
func (p QledgerFraudProof) Encode() []byte {
	b := append([]byte(qledgerFraudMagic), 1)
	b = append(b, p.AccFrom[:]...)
	b = binary.BigEndian.AppendUint16(b, uint16(len(p.Entries)))
	for _, e := range p.Entries {
		b = binary.BigEndian.AppendUint64(b, e.Height)
		b = binary.BigEndian.AppendUint16(b, uint16(len(e.Poster)))
		b = append(b, e.Poster...)
		b = binary.BigEndian.AppendUint32(b, uint32(len(e.Payload)))
		b = append(b, e.Payload...)
	}
	b = binary.BigEndian.AppendUint16(b, uint16(len(p.Witnesses)))
	for _, w := range p.Witnesses {
		b = append(b, w.ID[:]...)
		b = binary.BigEndian.AppendUint64(b, w.Balance)
		b = binary.BigEndian.AppendUint64(b, w.Nonce)
		b = append(b, w.Bitmap[:]...)
		for _, s := range w.Siblings {
			b = append(b, s[:]...)
		}
	}
	return b
}

// DecodeQledgerFraudProof parses a proof, refusing anything over the bounds or
// with trailing bytes.
func DecodeQledgerFraudProof(b []byte) (QledgerFraudProof, error) {
	var p QledgerFraudProof
	r := bytes.NewReader(b)
	take := func(n int) ([]byte, bool) {
		if n < 0 || r.Len() < n {
			return nil, false
		}
		out := make([]byte, n)
		_, _ = r.Read(out)
		return out, true
	}
	head, ok := take(5)
	if !ok || string(head[:4]) != qledgerFraudMagic || head[4] != 1 {
		return p, ErrQledgerMalformedProof
	}
	acc, ok := take(32)
	if !ok {
		return p, ErrQledgerMalformedProof
	}
	copy(p.AccFrom[:], acc)
	nb, ok := take(2)
	if !ok {
		return p, ErrQledgerMalformedProof
	}
	n := int(binary.BigEndian.Uint16(nb))
	if n > QledgerMaxBatchEntries {
		return p, fmt.Errorf("%w: %d entries, at most %d", ErrQledgerMalformedProof, n, QledgerMaxBatchEntries)
	}
	for i := 0; i < n; i++ {
		hb, ok1 := take(8)
		lb, ok2 := take(2)
		if !ok1 || !ok2 {
			return p, ErrQledgerMalformedProof
		}
		pl := int(binary.BigEndian.Uint16(lb))
		if pl > qledgerMaxPosterLen {
			return p, ErrQledgerMalformedProof
		}
		poster, ok3 := take(pl)
		plb, ok4 := take(4)
		if !ok3 || !ok4 {
			return p, ErrQledgerMalformedProof
		}
		ln := binary.BigEndian.Uint32(plb)
		if ln > QledgerMaxPostBytes {
			return p, ErrQledgerMalformedProof
		}
		payload, ok5 := take(int(ln))
		if !ok5 {
			return p, ErrQledgerMalformedProof
		}
		p.Entries = append(p.Entries, QledgerEntry{Height: binary.BigEndian.Uint64(hb), Poster: string(poster), Payload: payload})
	}
	mb, ok := take(2)
	if !ok {
		return p, ErrQledgerMalformedProof
	}
	m := int(binary.BigEndian.Uint16(mb))
	if m > qledgerMaxWitnesses {
		return p, ErrQledgerMalformedProof
	}
	for i := 0; i < m; i++ {
		fixed, ok := take(32 + 8 + 8 + 32)
		if !ok {
			return p, ErrQledgerMalformedProof
		}
		var w QledgerWitness
		copy(w.ID[:], fixed[:32])
		w.Balance = binary.BigEndian.Uint64(fixed[32:40])
		w.Nonce = binary.BigEndian.Uint64(fixed[40:48])
		copy(w.Bitmap[:], fixed[48:80])
		cnt := 0
		for _, x := range w.Bitmap {
			cnt += bits.OnesCount8(x)
		}
		for j := 0; j < cnt; j++ {
			s, ok := take(32)
			if !ok {
				return p, ErrQledgerMalformedProof
			}
			var sib [32]byte
			copy(sib[:], s)
			w.Siblings = append(w.Siblings, sib)
		}
		p.Witnesses = append(p.Witnesses, w)
	}
	if r.Len() != 0 {
		return p, ErrQledgerMalformedProof
	}
	return p, nil
}

// qledgerRecorder notes every account an execution touches, in first-touch
// order.
type qledgerRecorder struct {
	QledgerState
	seen  map[[32]byte]bool
	order [][32]byte
}

func (r *qledgerRecorder) note(id [32]byte) {
	if !r.seen[id] {
		r.seen[id] = true
		r.order = append(r.order, id)
	}
}

func (r *qledgerRecorder) Get(id [32]byte) (uint64, uint64, error) {
	r.note(id)
	return r.QledgerState.Get(id)
}

func (r *qledgerRecorder) Set(id [32]byte, balance, nonce uint64) error {
	r.note(id)
	return r.QledgerState.Set(id, balance, nonce)
}

// BuildQledgerFraudProof is the challenger's side: from the batch's parent
// state, the inbox accumulator at the batch's start (empty for the empty
// inbox) and the entries it consumed, the encoded proof to send with
// MsgChallengeBatch, and the result an honest batch would have published.
func BuildQledgerFraudProof(env QledgerEnv, parent *QledgerLedger, accFrom []byte, entries []QledgerEntry) ([]byte, QledgerResult, error) {
	if len(accFrom) != 0 && len(accFrom) != 32 {
		return nil, QledgerResult{}, fmt.Errorf("qledger: an inbox accumulator is 32 bytes, got %d", len(accFrom))
	}
	rec := &qledgerRecorder{QledgerState: parent.Clone(), seen: map[[32]byte]bool{}}
	honest, err := ExecuteQledger(env, rec, entries)
	if err != nil {
		return nil, honest, err
	}
	p := QledgerFraudProof{Entries: entries}
	copy(p.AccFrom[:], accFrom)
	for _, id := range rec.order {
		p.Witnesses = append(p.Witnesses, parent.Witness(id))
	}
	return p.Encode(), honest, nil
}

// QledgerClaim is what a qledger-v1 batch published.
type QledgerClaim struct {
	InboxStart      uint64
	InboxEnd        uint64
	DataHash        []byte
	PrevStateRoot   []byte
	StateRoot       []byte
	WithdrawalsRoot []byte
}

// CheckQledgerFraud decides a fraud proof as the chain does: true when
// re-executing the batch's inputs from its parent state gives a different
// state or withdrawals root than the batch published, false when the batch is
// right. It errors when the proof cannot decide (malformed, not about this
// batch, incomplete witness): the chain refuses such a challenge.
func CheckQledgerFraud(env QledgerEnv, claim QledgerClaim, proof []byte) (bool, error) {
	p, err := DecodeQledgerFraudProof(proof)
	if err != nil {
		return false, err
	}
	if claim.InboxEnd < claim.InboxStart || uint64(len(p.Entries)) != claim.InboxEnd-claim.InboxStart {
		return false, fmt.Errorf("%w: %d entries for inbox range %d..%d", ErrQledgerProofNotApplicable,
			len(p.Entries), claim.InboxStart, claim.InboxEnd)
	}
	acc := QledgerAccumulate(env.ChainID, env.RollupID, claim.InboxStart, p.AccFrom[:], p.Entries)
	want := InboxRangeHash(InboxRangeInput{
		ChainID: env.ChainID, RollupID: env.RollupID,
		From: claim.InboxStart, To: claim.InboxEnd, AccFrom: p.AccFrom[:], AccTo: acc,
	})
	if !bytes.Equal(want, claim.DataHash) {
		return false, fmt.Errorf("%w: the entries do not hash to the batch's inbox range", ErrQledgerProofNotApplicable)
	}
	if len(claim.PrevStateRoot) != 32 {
		return false, fmt.Errorf("%w: the batch has no 32-byte parent root", ErrQledgerProofNotApplicable)
	}
	tree, err := NewQledgerPartialTree(claim.PrevStateRoot, p.Witnesses)
	if err != nil {
		return false, err
	}
	res, err := ExecuteQledger(env, tree, p.Entries)
	if err != nil {
		return false, err
	}
	return !bytes.Equal(res.StateRoot, claim.StateRoot) || !bytes.Equal(res.WithdrawalsRoot, claim.WithdrawalsRoot), nil
}
