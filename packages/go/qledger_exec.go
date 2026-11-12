package rdk

import (
	"crypto/sha256"
	"errors"
	"math"
	"strings"
)

// qledger-v1 execution: what a batch's state root and withdrawals root must be
// for the inbox entries it consumes. The chain re-runs exactly this in a fraud
// proof, so a submitter that publishes anything else loses its bond.
//
// Entries that do not parse, carry a bad signature, the wrong nonce, a zero
// amount, more than the balance, or a non-canonical recipient are no-ops: an
// open inbox must accept anything without making a batch invalid.

// QledgerWithdrawalDenom is the denom every qledger-v1 withdrawal pays.
const QledgerWithdrawalDenom = "uqor"

var qledgerCounterID = sha256.Sum256([]byte("qledger/v1/withdrawal-counter"))

// QledgerWithdrawalCounterID is the reserved state slot holding the rollup's
// next withdrawal index (in its balance). Withdrawal indices are global to the
// rollup; transfers and deposits to this slot are no-ops.
func QledgerWithdrawalCounterID() [32]byte { return qledgerCounterID }

// QledgerEnv names the chain and the rollup an execution is bound to.
type QledgerEnv struct {
	ChainID  string
	RollupID string
}

// QledgerEntry is one inbox entry a batch consumes.
type QledgerEntry struct {
	// Height is the height of the block that included the post.
	Height uint64
	// Poster is the poster address, or "deposit:" + depositor for a deposit.
	Poster  string
	Payload []byte
}

// QledgerWithdrawal is one withdrawal a batch commits, at its global index.
type QledgerWithdrawal struct {
	Index     uint64
	Recipient string
	Amount    uint64
}

// QledgerResult is what a batch must publish.
type QledgerResult struct {
	StateRoot   []byte
	Withdrawals []QledgerWithdrawal
	// WithdrawalsRoot is empty when the batch has no withdrawal.
	WithdrawalsRoot []byte
}

// IsCanonicalQorAddress reports whether s is a qor1 account address in
// canonical form (lowercase, and exactly what re-encoding its bytes gives).
func IsCanonicalQorAddress(s string) bool {
	hrp, data, err := bech32Decode(s)
	if err != nil || hrp != AccountPrefix || len(data) == 0 || len(data) > 255 {
		return false
	}
	again, err := bech32Encode(AccountPrefix, data)
	return err == nil && again == s
}

// ExecuteQledger applies entries to state in order and returns the roots the
// batch must publish. It fails only when state cannot serve an account (a
// partial tree missing a witness: ErrQledgerIncompleteWitness).
func ExecuteQledger(env QledgerEnv, state QledgerState, entries []QledgerEntry) (QledgerResult, error) {
	var res QledgerResult
	for _, e := range entries {
		if strings.HasPrefix(e.Poster, QledgerDepositPosterPrefix) {
			id, amount, ok := DecodeQledgerDeposit(e.Payload)
			if !ok || id == qledgerCounterID {
				continue
			}
			bal, nonce, err := state.Get(id)
			if err != nil {
				return res, err
			}
			if bal > math.MaxUint64-amount {
				continue
			}
			if err := state.Set(id, bal+amount, nonce); err != nil {
				return res, err
			}
			continue
		}
		tx, ok := DecodeQledgerTx(e.Payload)
		if !ok || !tx.Verify(env.ChainID, env.RollupID) {
			continue
		}
		from := tx.From()
		bal, nonce, err := state.Get(from)
		if err != nil {
			return res, err
		}
		if tx.Nonce != nonce || tx.Amount == 0 || bal < tx.Amount || nonce == math.MaxUint64 {
			continue
		}
		switch tx.Kind {
		case QledgerKindTransfer:
			if tx.To == qledgerCounterID {
				continue
			}
			if tx.To == from {
				if err := state.Set(from, bal, nonce+1); err != nil {
					return res, err
				}
				continue
			}
			toBal, toNonce, err := state.Get(tx.To)
			if err != nil {
				return res, err
			}
			if toBal > math.MaxUint64-tx.Amount {
				continue
			}
			if err := state.Set(from, bal-tx.Amount, nonce+1); err != nil {
				return res, err
			}
			if err := state.Set(tx.To, toBal+tx.Amount, toNonce); err != nil {
				return res, err
			}
		case QledgerKindWithdraw:
			if tx.Amount > math.MaxInt64 || !IsCanonicalQorAddress(tx.Recipient) {
				continue
			}
			next, _, err := state.Get(qledgerCounterID)
			if err != nil {
				return res, err
			}
			if next == math.MaxUint64 {
				continue
			}
			if err := state.Set(from, bal-tx.Amount, nonce+1); err != nil {
				return res, err
			}
			if err := state.Set(qledgerCounterID, next+1, 0); err != nil {
				return res, err
			}
			res.Withdrawals = append(res.Withdrawals, QledgerWithdrawal{Index: next, Recipient: tx.Recipient, Amount: tx.Amount})
		}
	}
	res.StateRoot = state.Root()
	res.WithdrawalsRoot = QledgerWithdrawalsRoot(env.ChainID, env.RollupID, res.Withdrawals)
	return res, nil
}

// QledgerWithdrawalLeaf is the chain's v2 withdrawal leaf (SHAKE-256, every
// variable field length-prefixed) for a qledger-v1 withdrawal.
func QledgerWithdrawalLeaf(chainID, rollupID string, index uint64, recipient string, amount uint64) []byte {
	return Qorehash(
		lenPrefixed([]byte("qorechain-rdk-withdrawal/v2")),
		lenPrefixed([]byte(chainID)),
		lenPrefixed([]byte(rollupID)),
		u64Bytes(index),
		lenPrefixed([]byte(recipient)),
		lenPrefixed([]byte(QledgerWithdrawalDenom)),
		u64Bytes(amount),
	)
}

func qledgerWithdrawalLevels(chainID, rollupID string, ws []QledgerWithdrawal) [][][]byte {
	if len(ws) == 0 {
		return nil
	}
	n := 1
	for n < len(ws) {
		n *= 2
	}
	// A batch's withdrawals have consecutive global indices, so their
	// positions (index mod n) are distinct.
	level := make([][]byte, n)
	for i := range level {
		level[i] = make([]byte, 32)
	}
	for _, w := range ws {
		level[w.Index%uint64(n)] = QledgerWithdrawalLeaf(chainID, rollupID, w.Index, w.Recipient, w.Amount)
	}
	levels := [][][]byte{level}
	for len(level) > 1 {
		next := make([][]byte, len(level)/2)
		for i := range next {
			next[i] = Qorehash(level[2*i], level[2*i+1])
		}
		levels = append(levels, next)
		level = next
	}
	return levels
}

// QledgerWithdrawalsRoot is a qledger-v1 batch's withdrawals root: its
// withdrawals in a tree of the next power of two, each at its global index
// modulo that size, the rest zero; nil when there is none.
func QledgerWithdrawalsRoot(chainID, rollupID string, ws []QledgerWithdrawal) []byte {
	levels := qledgerWithdrawalLevels(chainID, rollupID, ws)
	if levels == nil {
		return nil
	}
	return clone(levels[len(levels)-1][0])
}

// QledgerWithdrawalProof is the sibling path of withdrawal i of a batch, as
// MsgExecuteWithdrawal takes it.
func QledgerWithdrawalProof(chainID, rollupID string, ws []QledgerWithdrawal, i int) ([][]byte, error) {
	if i < 0 || i >= len(ws) {
		return nil, errors.New("qledger: no such withdrawal")
	}
	levels := qledgerWithdrawalLevels(chainID, rollupID, ws)
	idx := int(ws[i].Index % uint64(len(levels[0])))
	path := make([][]byte, 0, len(levels)-1)
	for _, level := range levels[:len(levels)-1] {
		path = append(path, clone(level[idx^1]))
		idx >>= 1
	}
	return path, nil
}
