package rdk

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"sort"
)

// The qledger-v1 state tree: a sparse Merkle tree of depth 256 over account
// ids (SHA-256), one level per bit, most significant bit first.
//
//	empty leaf = SHA-256(0x00 | "qledger/v1/empty")
//	leaf       = SHA-256(0x00 | id[32] | be64(balance) | be64(nonce))   (the empty leaf when both are 0)
//	node       = SHA-256(0x01 | left | right)

// QledgerDepth is the depth of the state tree: one level per bit of an account
// id.
const QledgerDepth = 256

var (
	// ErrQledgerIncompleteWitness is returned when execution touches an
	// account a partial tree does not hold. A fraud proof that hits it is
	// refused and says nothing about the batch.
	ErrQledgerIncompleteWitness = errors.New("qledger: the witness does not open an account the batch touches")
	// ErrQledgerBadWitness is returned when a witness does not verify against
	// the state root, or two witnesses disagree about a node.
	ErrQledgerBadWitness = errors.New("qledger: witness does not match the state root")
)

// qledgerEmpty[h] is the root of an empty subtree of height h; [0] is the
// empty leaf.
var qledgerEmpty = func() [QledgerDepth + 1][32]byte {
	var e [QledgerDepth + 1][32]byte
	e[0] = sha256.Sum256(append([]byte{0x00}, "qledger/v1/empty"...))
	for h := 1; h <= QledgerDepth; h++ {
		e[h] = qledgerNode(e[h-1], e[h-1])
	}
	return e
}()

func qledgerNode(l, r [32]byte) [32]byte {
	var b [65]byte
	b[0] = 0x01
	copy(b[1:33], l[:])
	copy(b[33:], r[:])
	return sha256.Sum256(b[:])
}

// QledgerEmptyHash is the root of an empty subtree of height h (0 is the empty
// leaf).
func QledgerEmptyHash(h int) []byte {
	if h < 0 || h > QledgerDepth {
		return nil
	}
	e := qledgerEmpty[h]
	return e[:]
}

// QledgerEmptyRoot is the state root of a ledger with no account: the parent
// root of a qledger-v1 rollup's first batch.
func QledgerEmptyRoot() []byte { return QledgerEmptyHash(QledgerDepth) }

// QledgerLeafHash is the leaf of an account (the empty leaf for a zero
// account).
func QledgerLeafHash(id [32]byte, balance, nonce uint64) []byte {
	h := qledgerLeaf(id, balance, nonce)
	return h[:]
}

func qledgerLeaf(id [32]byte, balance, nonce uint64) [32]byte {
	if balance == 0 && nonce == 0 {
		return qledgerEmpty[0]
	}
	var b [49]byte
	copy(b[1:33], id[:])
	binary.BigEndian.PutUint64(b[33:41], balance)
	binary.BigEndian.PutUint64(b[41:49], nonce)
	return sha256.Sum256(b[:])
}

// qledgerBit is bit i of id, most significant first.
func qledgerBit(id [32]byte, i int) byte { return (id[i/8] >> (7 - uint(i%8))) & 1 }

type qledgerNodeKey struct {
	depth  uint16
	prefix [32]byte
}

// qledgerKeyOf names the node at depth d on id's path: id's first d bits.
func qledgerKeyOf(id [32]byte, d int) qledgerNodeKey {
	k := qledgerNodeKey{depth: uint16(d)}
	copy(k.prefix[:d/8], id[:d/8])
	if r := d % 8; r != 0 {
		k.prefix[d/8] = id[d/8] & byte(0xff<<(8-uint(r)))
	}
	return k
}

// qledgerSibKey names the sibling of the node at depth d (d >= 1) on id's
// path.
func qledgerSibKey(id [32]byte, d int) qledgerNodeKey {
	id[(d-1)/8] ^= 1 << (7 - uint((d-1)%8))
	return qledgerKeyOf(id, d)
}

// QledgerWitness opens one account against a state root. Siblings run from the
// leaf up (depth 256 to depth 1), only the non-empty ones: bit d-1 of Bitmap
// (most significant bit first) is set when the sibling at depth d is given.
type QledgerWitness struct {
	ID       [32]byte
	Balance  uint64
	Nonce    uint64
	Bitmap   [32]byte
	Siblings [][32]byte
}

// QledgerState is what execution reads and writes: a QledgerLedger, or a
// QledgerPartialTree built from witnesses.
type QledgerState interface {
	Get(id [32]byte) (balance, nonce uint64, err error)
	Set(id [32]byte, balance, nonce uint64) error
	Root() []byte
}

// QledgerAccount is one account of a ledger.
type QledgerAccount struct {
	ID      [32]byte
	Balance uint64
	Nonce   uint64
}

// QledgerLedger is a whole qledger-v1 state in memory: what a submitter or a
// challenger keeps, and what builds witnesses. Zero accounts are not stored,
// so the root of a state is unique. The zero value is an empty ledger.
type QledgerLedger struct {
	accts map[[32]byte][2]uint64
}

// NewQledgerLedger returns an empty ledger (root QledgerEmptyRoot()).
func NewQledgerLedger() *QledgerLedger { return &QledgerLedger{} }

// Get returns an account (zero when absent). The error is always nil.
func (l *QledgerLedger) Get(id [32]byte) (uint64, uint64, error) {
	a := l.accts[id]
	return a[0], a[1], nil
}

// Set writes an account; a zero account is removed. The error is always nil.
func (l *QledgerLedger) Set(id [32]byte, balance, nonce uint64) error {
	if balance == 0 && nonce == 0 {
		delete(l.accts, id)
		return nil
	}
	if l.accts == nil {
		l.accts = map[[32]byte][2]uint64{}
	}
	l.accts[id] = [2]uint64{balance, nonce}
	return nil
}

// Clone returns an independent copy.
func (l *QledgerLedger) Clone() *QledgerLedger {
	c := &QledgerLedger{accts: make(map[[32]byte][2]uint64, len(l.accts))}
	for k, v := range l.accts {
		c.accts[k] = v
	}
	return c
}

// Accounts returns every non-zero account, sorted by id.
func (l *QledgerLedger) Accounts() []QledgerAccount {
	ids := l.sortedIDs()
	out := make([]QledgerAccount, len(ids))
	for i, id := range ids {
		a := l.accts[id]
		out[i] = QledgerAccount{ID: id, Balance: a[0], Nonce: a[1]}
	}
	return out
}

func (l *QledgerLedger) sortedIDs() [][32]byte {
	ids := make([][32]byte, 0, len(l.accts))
	for id := range l.accts {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return bytes.Compare(ids[i][:], ids[j][:]) < 0 })
	return ids
}

// subtree is the root of the subtree at depth d holding ids, which share their
// first d bits and are sorted.
func (l *QledgerLedger) subtree(d int, ids [][32]byte) [32]byte {
	switch len(ids) {
	case 0:
		return qledgerEmpty[QledgerDepth-d]
	case 1:
		id := ids[0]
		a := l.accts[id]
		cur := qledgerLeaf(id, a[0], a[1])
		for dd := QledgerDepth; dd > d; dd-- {
			if qledgerBit(id, dd-1) == 0 {
				cur = qledgerNode(cur, qledgerEmpty[QledgerDepth-dd])
			} else {
				cur = qledgerNode(qledgerEmpty[QledgerDepth-dd], cur)
			}
		}
		return cur
	}
	split := sort.Search(len(ids), func(i int) bool { return qledgerBit(ids[i], d) == 1 })
	return qledgerNode(l.subtree(d+1, ids[:split]), l.subtree(d+1, ids[split:]))
}

// Root computes the state root.
func (l *QledgerLedger) Root() []byte {
	r := l.subtree(0, l.sortedIDs())
	return r[:]
}

// Witness opens id (present or not) against Root().
func (l *QledgerLedger) Witness(id [32]byte) QledgerWitness {
	a := l.accts[id]
	w := QledgerWitness{ID: id, Balance: a[0], Nonce: a[1]}
	type sib struct {
		d int
		h [32]byte
	}
	var topDown []sib
	ids := l.sortedIDs()
	// From the root down: at depth d the sibling of id's node is the subtree
	// on the other side of bit d-1.
	for d := 1; d <= QledgerDepth && len(ids) > 0; d++ {
		var same, other [][32]byte
		for _, x := range ids {
			if qledgerBit(x, d-1) == qledgerBit(id, d-1) {
				same = append(same, x)
			} else {
				other = append(other, x)
			}
		}
		if len(other) > 0 {
			topDown = append(topDown, sib{d, l.subtree(d, other)})
		}
		ids = same
	}
	for i := len(topDown) - 1; i >= 0; i-- {
		d := topDown[i].d
		w.Bitmap[(d-1)/8] |= 1 << (7 - uint((d-1)%8))
		w.Siblings = append(w.Siblings, topDown[i].h)
	}
	return w
}

// QledgerPartialTree is the part of a state tree a set of witnesses opens,
// checked against a root (what the chain builds from a fraud proof). Reading
// or writing an account outside it fails with ErrQledgerIncompleteWitness.
type QledgerPartialTree struct {
	nodes map[qledgerNodeKey][32]byte
	accts map[[32]byte][2]uint64
	root  [32]byte
}

// NewQledgerPartialTree checks every witness against root and joins them into
// one tree. A witness that does not reach root, or that disagrees with another
// about any node, refuses the whole set (ErrQledgerBadWitness).
func NewQledgerPartialTree(root []byte, witnesses []QledgerWitness) (*QledgerPartialTree, error) {
	if len(root) != 32 {
		return nil, ErrQledgerBadWitness
	}
	t := &QledgerPartialTree{nodes: map[qledgerNodeKey][32]byte{}, accts: map[[32]byte][2]uint64{}}
	copy(t.root[:], root)
	put := func(k qledgerNodeKey, v [32]byte) error {
		if old, ok := t.nodes[k]; ok && old != v {
			return ErrQledgerBadWitness
		}
		t.nodes[k] = v
		return nil
	}
	for _, w := range witnesses {
		cur := qledgerLeaf(w.ID, w.Balance, w.Nonce)
		if err := put(qledgerKeyOf(w.ID, QledgerDepth), cur); err != nil {
			return nil, err
		}
		si := 0
		for d := QledgerDepth; d >= 1; d-- {
			s := qledgerEmpty[QledgerDepth-d]
			if (w.Bitmap[(d-1)/8]>>(7-uint((d-1)%8)))&1 == 1 {
				if si >= len(w.Siblings) {
					return nil, ErrQledgerBadWitness
				}
				s = w.Siblings[si]
				si++
			}
			if err := put(qledgerSibKey(w.ID, d), s); err != nil {
				return nil, err
			}
			if qledgerBit(w.ID, d-1) == 0 {
				cur = qledgerNode(cur, s)
			} else {
				cur = qledgerNode(s, cur)
			}
			if err := put(qledgerKeyOf(w.ID, d-1), cur); err != nil {
				return nil, err
			}
		}
		if si != len(w.Siblings) || cur != t.root {
			return nil, ErrQledgerBadWitness
		}
		t.accts[w.ID] = [2]uint64{w.Balance, w.Nonce}
	}
	return t, nil
}

// Get returns an opened account.
func (t *QledgerPartialTree) Get(id [32]byte) (uint64, uint64, error) {
	a, ok := t.accts[id]
	if !ok {
		return 0, 0, ErrQledgerIncompleteWitness
	}
	return a[0], a[1], nil
}

// Set updates an opened account and recomputes the root.
func (t *QledgerPartialTree) Set(id [32]byte, balance, nonce uint64) error {
	if _, ok := t.accts[id]; !ok {
		return ErrQledgerIncompleteWitness
	}
	t.accts[id] = [2]uint64{balance, nonce}
	cur := qledgerLeaf(id, balance, nonce)
	t.nodes[qledgerKeyOf(id, QledgerDepth)] = cur
	for d := QledgerDepth; d >= 1; d-- {
		s, ok := t.nodes[qledgerSibKey(id, d)]
		if !ok {
			return ErrQledgerIncompleteWitness
		}
		if qledgerBit(id, d-1) == 0 {
			cur = qledgerNode(cur, s)
		} else {
			cur = qledgerNode(s, cur)
		}
		t.nodes[qledgerKeyOf(id, d-1)] = cur
	}
	t.root = cur
	return nil
}

// Root is the current root.
func (t *QledgerPartialTree) Root() []byte {
	r := t.root
	return r[:]
}
