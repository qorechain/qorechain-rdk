package rdk

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
)

// Watching qledger-v1 rollups.
//
// The chain decides a challenge against a qledger-v1 batch by re-executing the
// inbox entries the batch consumed from its parent state and comparing the
// state and withdrawals roots it published (CheckQledgerFraud). A qledger-v1
// state root is the root of the account tree, not the canonical transition
// root other optimistic rollups publish (BatchTransitionRoot), so judging a
// qledger-v1 batch by that root reports every honest batch as invalid, and a
// FraudProof built from it is one the chain dismisses.
//
// QledgerValidator applies the chain's own qledger-v1 rule: it rebuilds the
// parent state by replaying the rollup's earlier batches, reads the entries the
// batch consumed, builds the fraud proof a challenger would send, and decides
// it with CheckQledgerFraud, the same decision the chain makes. A batch it
// rejects is one the proof from QledgerFraudProofForBatch wins.

// ErrQledgerNoHonestReplay is returned when a batch builds on a state root that
// no honest replay of the rollup's earlier batches reaches. The batch is left
// undecided: the earlier batch that published that root is the one a challenge
// wins against.
var ErrQledgerNoHonestReplay = errors.New("qledger: no honest replay reaches the state root")

// QledgerEntryRange names the inbox entries a batch consumed: sequences From+1
// through To.
type QledgerEntryRange struct {
	From uint64
	To   uint64
	// AccFrom is the inbox accumulator after entry From (the batch's start).
	AccFrom []byte
}

// QledgerEntryReader reads the inbox entries a batch consumed, in sequence
// order.
type QledgerEntryReader func(ctx context.Context, r QledgerEntryRange) ([]QledgerEntry, error)

// QledgerValidatorOptions configures a QledgerJudge.
type QledgerValidatorOptions struct {
	// ReadEntries is where the entries come from. Nil uses
	// FetchQledgerEntries, which reads them back from the node's transaction
	// index and checks them against the chain's inbox accumulator. Supply your
	// own to read from an archive of posts you keep, for example once the node
	// has pruned old transactions.
	ReadEntries QledgerEntryReader
	// MaxCachedStates is how many parent states to keep in memory (0 means 32;
	// at least 2 are kept). Older ones are rebuilt by replay.
	MaxCachedStates int
}

// QledgerJudgement is how a qledger-v1 batch fares under the chain's fraud
// rule.
type QledgerJudgement struct {
	// Valid is true when a challenge against the batch would be dismissed.
	Valid bool
	// Honest is what an honest batch over the same entries publishes: its
	// StateRoot and WithdrawalsRoot (empty when there is no withdrawal), and
	// the withdrawals behind that root.
	Honest QledgerResult
	// Proof is, for an invalid batch, the encoded proof that wins
	// MsgChallengeBatch; nil for a valid one.
	Proof []byte
}

const qledgerDefaultCachedStates = 32

// QledgerJudge judges the batches of one qledger-v1 rollup, keeping the honest
// ledger after each batch it accepts so the next batch is judged without a
// full replay. It is safe for concurrent use; judgements are serialized, so use
// one judge per rollup.
type QledgerJudge struct {
	client    *RdkClient
	env       QledgerEnv
	read      QledgerEntryReader
	maxStates int
	emptyRoot string

	// turn holds a token while a judgement runs.
	turn chan struct{}
	// states holds honest ledgers by state root (hex); order lists their
	// roots, oldest first.
	states map[string]*QledgerLedger
	order  []string
}

// NewQledgerJudge returns a judge for the qledger-v1 rollup rollupID on
// client's network.
func NewQledgerJudge(client *RdkClient, rollupID string, opts QledgerValidatorOptions) *QledgerJudge {
	env := QledgerEnv{ChainID: client.Network.ChainID, RollupID: rollupID}
	maxStates := opts.MaxCachedStates
	if maxStates == 0 {
		maxStates = qledgerDefaultCachedStates
	}
	read := opts.ReadEntries
	if read == nil {
		read = func(ctx context.Context, r QledgerEntryRange) ([]QledgerEntry, error) {
			return FetchQledgerEntries(ctx, client.Rest, FetchQledgerEntriesInput{
				ChainID: env.ChainID, RollupID: env.RollupID, From: r.From, To: r.To, AccFrom: r.AccFrom,
			})
		}
	}
	empty := NewQledgerLedger()
	j := &QledgerJudge{
		client:    client,
		env:       env,
		read:      read,
		maxStates: max(2, maxStates),
		emptyRoot: BytesToHex(empty.Root()),
		turn:      make(chan struct{}, 1),
		states:    map[string]*QledgerLedger{},
	}
	j.remember(j.emptyRoot, empty)
	return j
}

// Judge decides batch as the chain would decide a challenge against it. It
// errors when it cannot decide: the batch builds on a state root no honest
// replay reaches (ErrQledgerNoHonestReplay), its entries cannot be read, or
// they do not belong to the batch (ErrQledgerProofNotApplicable). An error
// never means the batch is invalid. A call waiting for another to finish
// returns early when ctx is done.
func (j *QledgerJudge) Judge(ctx context.Context, batch BatchView) (QledgerJudgement, error) {
	select {
	case j.turn <- struct{}{}:
	case <-ctx.Done():
		return QledgerJudgement{}, ctx.Err()
	}
	defer func() { <-j.turn }()

	prev, err := qledgerRootKey(batch.PrevStateRoot)
	if err != nil {
		return QledgerJudgement{}, err
	}
	parent, err := j.ledgerAt(ctx, prev)
	if err != nil {
		return QledgerJudgement{}, err
	}
	return j.judgeOn(ctx, parent, batch)
}

func (j *QledgerJudge) remember(root string, ledger *QledgerLedger) {
	if _, ok := j.states[root]; ok {
		j.order = slices.DeleteFunc(j.order, func(k string) bool { return k == root })
	}
	j.states[root] = ledger
	j.order = append(j.order, root)
	for len(j.order) > j.maxStates {
		i := slices.IndexFunc(j.order, func(k string) bool { return k != j.emptyRoot })
		if i < 0 {
			break
		}
		delete(j.states, j.order[i])
		j.order = slices.Delete(j.order, i, i+1)
	}
}

// accAfter is the inbox accumulator after entry seq (posted data is numbered
// from 1).
func (j *QledgerJudge) accAfter(ctx context.Context, seq uint64) ([]byte, error) {
	if seq == 0 {
		return EmptyInboxAcc(), nil
	}
	posted, err := j.client.Rest.GetPostedData(ctx, j.env.RollupID, seq)
	if err != nil {
		return nil, err
	}
	acc, err := DecodeWireBytes(posted.InboxAcc)
	if err != nil {
		return nil, fmt.Errorf("qledger: post %d of %s has an unreadable inbox accumulator: %w", seq, j.env.RollupID, err)
	}
	return acc, nil
}

func (j *QledgerJudge) judgeOn(ctx context.Context, parent *QledgerLedger, batch BatchView) (QledgerJudgement, error) {
	accFrom, err := j.accAfter(ctx, batch.InboxStart)
	if err != nil {
		return QledgerJudgement{}, err
	}
	entries, err := j.read(ctx, QledgerEntryRange{From: batch.InboxStart, To: batch.InboxEnd, AccFrom: accFrom})
	if err != nil {
		return QledgerJudgement{}, err
	}
	proof, honest, err := BuildQledgerFraudProof(j.env, parent, accFrom, entries)
	if err != nil {
		return QledgerJudgement{}, err
	}
	claim, err := qledgerClaimOf(batch)
	if err != nil {
		return QledgerJudgement{}, err
	}
	// The chain's own decision on that proof. It errors when the entries do
	// not belong to this batch, which leaves the batch undecided rather than
	// invalid.
	fraud, err := CheckQledgerFraud(j.env, claim, proof)
	if err != nil {
		return QledgerJudgement{}, err
	}
	if fraud {
		return QledgerJudgement{Valid: false, Honest: honest, Proof: proof}, nil
	}
	next := parent.Clone()
	if _, err := ExecuteQledger(j.env, next, entries); err != nil {
		return QledgerJudgement{}, err
	}
	j.remember(BytesToHex(next.Root()), next)
	return QledgerJudgement{Valid: true, Honest: honest}, nil
}

// ledgerAt is the honest ledger whose root is root, replaying the rollup's
// batches in order from the empty ledger when it is not already known. Only a
// batch that reproduces from a known state is followed, so a root that no
// honest replay reaches is refused: the batch that introduced it is the one to
// challenge.
func (j *QledgerJudge) ledgerAt(ctx context.Context, root string) (*QledgerLedger, error) {
	if known, ok := j.states[root]; ok {
		return known, nil
	}
	all, err := j.client.Rest.ListBatches(ctx, j.env.RollupID)
	if err != nil {
		return nil, err
	}
	batches := make([]BatchView, 0, len(all))
	for _, b := range all {
		if b.Status != string(BatchRejected) {
			batches = append(batches, b)
		}
	}
	sort.SliceStable(batches, func(a, b int) bool { return batches[a].BatchIndex < batches[b].BatchIndex })
	for _, b := range batches {
		state, err := qledgerRootKey(b.StateRoot)
		if err != nil {
			return nil, err
		}
		if _, ok := j.states[state]; ok {
			continue
		}
		prev, err := qledgerRootKey(b.PrevStateRoot)
		if err != nil {
			return nil, err
		}
		parent, ok := j.states[prev]
		if !ok {
			continue
		}
		if _, err := j.judgeOn(ctx, parent, b); err != nil {
			return nil, err
		}
		if found, ok := j.states[root]; ok {
			return found, nil
		}
	}
	return nil, fmt.Errorf("%w %s of %s; a batch before this one published it, and that batch is the one a challenge wins against",
		ErrQledgerNoHonestReplay, root, j.env.RollupID)
}

// qledgerRootKey is a root as the node serves it (hex or base64), as the
// lowercase hex the judge keeps states by.
func qledgerRootKey(wire string) (string, error) {
	b, err := DecodeWireBytes(wire)
	if err != nil {
		return "", fmt.Errorf("qledger: unreadable state root %q: %w", wire, err)
	}
	return BytesToHex(b), nil
}

// qledgerClaimOf is what batch published, as CheckQledgerFraud reads it.
func qledgerClaimOf(batch BatchView) (QledgerClaim, error) {
	claim := QledgerClaim{InboxStart: batch.InboxStart, InboxEnd: batch.InboxEnd}
	for _, f := range []struct {
		name string
		wire string
		dst  *[]byte
	}{
		{"data_hash", batch.DataHash, &claim.DataHash},
		{"prev_state_root", batch.PrevStateRoot, &claim.PrevStateRoot},
		{"state_root", batch.StateRoot, &claim.StateRoot},
		{"withdrawals_root", batch.WithdrawalsRoot, &claim.WithdrawalsRoot},
	} {
		b, err := DecodeWireBytes(f.wire)
		if err != nil {
			return QledgerClaim{}, fmt.Errorf("qledger: batch %d has an unreadable %s %q: %w", batch.BatchIndex, f.name, f.wire, err)
		}
		*f.dst = b
	}
	return claim, nil
}

// QledgerValidator is a validity predicate for a qledger-v1 rollup: true
// exactly when a challenge against the batch would be dismissed. It errors
// when it cannot decide, for example when the batch builds on a state no
// honest replay reaches; report that instead of flagging the batch. Every call
// goes through one QledgerJudge, so later batches reuse the states earlier
// calls rebuilt.
func QledgerValidator(client *RdkClient, rollupID string, opts QledgerValidatorOptions) func(ctx context.Context, batch BatchView) (bool, error) {
	judge := NewQledgerJudge(client, rollupID, opts)
	return func(ctx context.Context, batch BatchView) (bool, error) {
		j, err := judge.Judge(ctx, batch)
		if err != nil {
			return false, err
		}
		return j.Valid, nil
	}
}

// QledgerFraudProofForBatch is the qledger-v1 fraud proof that wins a
// challenge against batch, or nil when the batch is right (a challenge would
// be dismissed and forfeit its bond). The proof has already been decided with
// CheckQledgerFraud, the rule the chain applies. Send it as the Proof of
// MsgChallengeBatch.
func QledgerFraudProofForBatch(ctx context.Context, client *RdkClient, rollupID string, batch BatchView, opts QledgerValidatorOptions) ([]byte, error) {
	j, err := NewQledgerJudge(client, rollupID, opts).Judge(ctx, batch)
	if err != nil {
		return nil, err
	}
	return j.Proof, nil
}
