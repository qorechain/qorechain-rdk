package rdk

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// Building qledger-v1 batches by the chain's admission rules (chain v3.2.8).
//
// A qledger-v1 batch with InboxEnd = end is admitted when:
//
//  1. the submitter holds at least min_submitter_bond on the rollup and has
//     fewer than 1,024 of its batches waiting for finality;
//  2. consumed < end <= head (at least one entry);
//  3. end - consumed <= 64;
//  4. end is the head, or the commitment of post end is retained;
//  5. a batch of fewer than 64 entries that stops before the head stops just
//     before a post made in the last 20 blocks, or at a checkpoint (end a
//     multiple of 64) whose next post is no longer retained;
//  6. DataHash is the inbox range commitment from consumed to end, the first
//     batch starts from the empty ledger root, and StateRoot is 32 bytes.

const (
	// QledgerFreshPostBlocks is the age in blocks under which a post may be
	// left for the next batch.
	QledgerFreshPostBlocks = 20
	// QledgerMaxPendingBatchesPerSubmitter is the most batches one submitter
	// may have waiting for finality on a rollup.
	QledgerMaxPendingBatchesPerSubmitter = 1024
	// QledgerCheckpointInterval: every post whose sequence is a multiple of it
	// keeps its commitment until a finalized batch covers it.
	QledgerCheckpointInterval = 64
	// QledgerSlashBurnPercent is the share of a slashed submitter bond that is
	// burned (the challenger receives the rest).
	QledgerSlashBurnPercent = 50
)

// IsQledgerCheckpoint reports whether sequence is a qledger-v1 checkpoint (a
// non-zero multiple of 64).
func IsQledgerCheckpoint(sequence uint64) bool {
	return sequence != 0 && sequence%QledgerCheckpointInterval == 0
}

// QledgerBatchFacts is what the admission rules need to know about the inbox
// and the submitter.
type QledgerBatchFacts struct {
	Consumed uint64
	Head     uint64
	End      uint64
	// Bond and MinBond are in uqor.
	Bond    uint64
	MinBond uint64
	Pending uint64
	// EndRetained reports whether the commitment of post End is retained
	// (ignored when End is the head).
	EndRetained bool
	// NextRetained reports whether the commitment of post End+1 is retained;
	// nil when unknown. Needed when End is before the head.
	NextRetained *bool
	// NextHeight is the height of post End+1, when retained.
	NextHeight *uint64
	// InclusionHeight is the height the batch is expected to be included at.
	// The chain judges the 20-block rule at inclusion, so pass the current
	// height plus a margin for the time the transaction takes to land.
	InclusionHeight *uint64
}

// QledgerBatchErrors lists every rule the batch range would break; nil when
// the chain admits it.
func QledgerBatchErrors(f QledgerBatchFacts) []string {
	var errs []string
	if f.Bond < f.MinBond {
		errs = append(errs, fmt.Sprintf("the submitter holds %d uqor of bond, at least %d is needed", f.Bond, f.MinBond))
	}
	if f.Pending >= QledgerMaxPendingBatchesPerSubmitter {
		errs = append(errs, fmt.Sprintf("the submitter already has %d batches waiting for finality, at most %d",
			f.Pending, QledgerMaxPendingBatchesPerSubmitter))
	}
	if f.End <= f.Consumed {
		return append(errs, fmt.Sprintf("a batch consumes at least one inbox entry (consumed %d, inbox_end %d)", f.Consumed, f.End))
	}
	if f.End > f.Head {
		errs = append(errs, fmt.Sprintf("inbox_end %d is past the head %d", f.End, f.Head))
	}
	n := f.End - f.Consumed
	if n > QledgerMaxBatchEntries {
		errs = append(errs, fmt.Sprintf("a batch consumes at most %d inbox entries, this one %d", QledgerMaxBatchEntries, n))
	}
	if f.End < f.Head && !f.EndRetained {
		errs = append(errs, fmt.Sprintf("the commitment of post %d is no longer retained: end the batch at the head or at a retained post", f.End))
	}
	if n < QledgerMaxBatchEntries && f.End < f.Head {
		nextGone := f.NextRetained != nil && !*f.NextRetained
		checkpointStop := IsQledgerCheckpoint(f.End) && nextGone
		freshStop := !nextGone && f.NextHeight != nil && f.InclusionHeight != nil &&
			*f.NextHeight+QledgerFreshPostBlocks > *f.InclusionHeight
		if !checkpointStop && !freshStop {
			errs = append(errs, fmt.Sprintf("a batch of fewer than %d entries consumes every post older than %d blocks: post %d must be in it",
				QledgerMaxBatchEntries, QledgerFreshPostBlocks, f.End+1))
		}
	}
	return errs
}

// ChooseQledgerBatchEnd is the end a submitter should choose (the chain's
// recommended logic): a full batch of 64 or the head when that position is
// retained, otherwise the next checkpoint (after a long idle period, when only
// checkpoints kept their commitments). ok is false when nothing is waiting.
// retained(x) reports whether the commitment of post x is retained
// (RestClient.GetInbox(ctx, rollup, x).RangeDataHash != "").
func ChooseQledgerBatchEnd(consumed, head uint64, retained func(x uint64) (bool, error)) (end uint64, ok bool, err error) {
	if head <= consumed {
		return 0, false, nil
	}
	want := consumed + QledgerMaxBatchEntries
	if head < want {
		want = head
	}
	if want == head {
		return want, true, nil
	}
	kept, err := retained(want)
	if err != nil {
		return 0, false, err
	}
	if kept {
		return want, true, nil
	}
	return (consumed/QledgerCheckpointInterval + 1) * QledgerCheckpointInterval, true, nil
}

// QledgerAccumulate is the inbox accumulator after entries, starting from
// accFrom (empty for the empty inbox) at sequence from.
func QledgerAccumulate(chainID, rollupID string, from uint64, accFrom []byte, entries []QledgerEntry) []byte {
	acc := clone(accFrom)
	if len(acc) == 0 {
		acc = EmptyInboxAcc()
	}
	for i, e := range entries {
		acc = InboxAccumulate(InboxAccumulateInput{
			ChainID: chainID, RollupID: rollupID, PrevAcc: acc,
			Sequence: from + uint64(i) + 1, Height: e.Height, Poster: e.Poster,
			DataHash: PostedDataHash(e.Payload),
		})
	}
	return acc
}

// FetchQledgerEntriesInput names the inbox entries From+1 .. To of a rollup.
type FetchQledgerEntriesInput struct {
	ChainID  string
	RollupID string
	From     uint64
	To       uint64
	// AccFrom is the inbox accumulator at From (empty for the empty inbox).
	AccFrom []byte
}

func eventAttrs(ev map[string]any) map[string]string {
	out := map[string]string{}
	for _, a := range asArray(ev["attributes"]) {
		out[asStr(a["key"], "")] = asStr(a["value"], "")
	}
	return out
}

func isNotFound(err error) bool {
	return err != nil && strings.Contains(err.Error(), " failed: 404")
}

// FetchQledgerEntries reads the inbox entries From+1 .. To of a qledger-v1
// rollup back from the transactions that made them (the chain keeps only
// commitments; the bytes stay in block history): posts from MsgPostRollupData,
// deposits from the rdk_rollup_deposit event. The entries are checked against
// the chain's inbox accumulator: every post event's inbox_acc, and the inbox
// range commitment up to To. Entries that cannot be verified are refused.
// Needs a node with transaction indexing on.
func FetchQledgerEntries(ctx context.Context, rest *RestClient, in FetchQledgerEntriesInput) ([]QledgerEntry, error) {
	if in.To < in.From {
		return nil, fmt.Errorf("qledger: inbox range %d..%d is reversed", in.From, in.To)
	}
	if in.To == in.From {
		return nil, nil
	}
	type found struct {
		entry QledgerEntry
		acc   string
	}
	bySeq := map[uint64]found{}
	query := func(event string) string { return event + ".rollup_id='" + in.RollupID + "'" }

	posts, err := rest.SearchTxs(ctx, query("rdk_data_posted"))
	if err != nil {
		return nil, err
	}
	for _, tx := range posts {
		height := asU64(tx["height"], 0)
		var msgs []map[string]any
		for _, m := range asArray(asRecord(asRecord(tx["tx"])["body"])["messages"]) {
			if asStr(m["@type"], "") == TypeURLMsgPostRollupData {
				msgs = append(msgs, m)
			}
		}
		for _, ev := range asArray(tx["events"]) {
			if asStr(ev["type"], "") != "rdk_data_posted" {
				continue
			}
			a := eventAttrs(ev)
			if a["rollup_id"] != in.RollupID {
				continue
			}
			seq, err := strconv.ParseUint(a["sequence"], 10, 64)
			if err != nil || seq <= in.From || seq > in.To {
				continue
			}
			var payload []byte
			matched := false
			for _, m := range msgs {
				d, err := base64.StdEncoding.DecodeString(asStr(m["data"], ""))
				if err != nil {
					continue
				}
				if BytesToHex(PostedDataHash(d)) == strings.ToLower(a["data_hash"]) && asStr(m["poster"], "") == a["poster"] {
					payload, matched = d, true
					break
				}
			}
			if !matched {
				return nil, fmt.Errorf("qledger: post %d is in transaction %s but its payload could not be matched", seq, asStr(tx["txhash"], ""))
			}
			bySeq[seq] = found{QledgerEntry{Height: height, Poster: a["poster"], Payload: payload}, strings.ToLower(a["inbox_acc"])}
		}
	}

	deposits, err := rest.SearchTxs(ctx, query("rdk_rollup_deposit"))
	if err != nil {
		return nil, err
	}
	for _, tx := range deposits {
		height := asU64(tx["height"], 0)
		for _, ev := range asArray(tx["events"]) {
			if asStr(ev["type"], "") != "rdk_rollup_deposit" {
				continue
			}
			a := eventAttrs(ev)
			if a["rollup_id"] != in.RollupID {
				continue
			}
			seq, err := strconv.ParseUint(a["sequence"], 10, 64)
			if err != nil || seq <= in.From || seq > in.To {
				continue
			}
			amount, err := strconv.ParseUint(strings.TrimSuffix(a["amount"], BaseDenom), 10, 64)
			if err != nil {
				return nil, fmt.Errorf("qledger: deposit %d has an unreadable amount %q", seq, a["amount"])
			}
			id, err := HexToBytes(a["account"])
			if err != nil || len(id) != 32 {
				return nil, fmt.Errorf("qledger: deposit %d has an unreadable account %q", seq, a["account"])
			}
			var account [32]byte
			copy(account[:], id)
			bySeq[seq] = found{entry: QledgerEntry{
				Height:  height,
				Poster:  QledgerDepositPosterPrefix + a["depositor"],
				Payload: EncodeQledgerDeposit(account, amount),
			}}
		}
	}

	entries := make([]QledgerEntry, 0, in.To-in.From)
	acc := clone(in.AccFrom)
	verifiedTo := in.From
	for s := in.From + 1; s <= in.To; s++ {
		f, ok := bySeq[s]
		if !ok {
			return nil, fmt.Errorf("qledger: inbox entry %d of rollup %s was not found in the node's transaction index", s, in.RollupID)
		}
		entries = append(entries, f.entry)
		acc = QledgerAccumulate(in.ChainID, in.RollupID, s-1, acc, []QledgerEntry{f.entry})
		if f.acc != "" {
			if BytesToHex(acc) != f.acc {
				return nil, fmt.Errorf("qledger: inbox entry %d of rollup %s does not match the chain's inbox accumulator", s, in.RollupID)
			}
			verifiedTo = s
		}
	}
	if verifiedTo < in.To {
		ib, err := rest.GetInbox(ctx, in.RollupID, in.To)
		if err != nil {
			return nil, err
		}
		if ib.RangeDataHash == "" || ib.RangeEnd != in.To {
			return nil, fmt.Errorf("qledger: entries %d..%d of rollup %s cannot be verified: the chain no longer serves the inbox range commitment",
				verifiedTo+1, in.To, in.RollupID)
		}
		want := InboxRangeHash(InboxRangeInput{
			ChainID: in.ChainID, RollupID: in.RollupID, From: in.From, To: in.To, AccFrom: in.AccFrom, AccTo: acc,
		})
		if BytesToHex(want) != strings.ToLower(strings.TrimPrefix(ib.RangeDataHash, "0x")) {
			return nil, errors.New("qledger: the fetched entries do not hash to the chain's inbox range commitment")
		}
	}
	return entries, nil
}

// qledgerLiveFacts reads what QledgerBatchErrors needs from the chain for a
// batch of rollupID ending at end.
func qledgerLiveFacts(ctx context.Context, rest *RestClient, rollupID, submitter string, inbox InboxView, end, margin uint64) (QledgerBatchFacts, error) {
	params, err := rest.GetParams(ctx)
	if err != nil {
		return QledgerBatchFacts{}, err
	}
	bond, err := rest.GetSubmitterBond(ctx, rollupID, submitter)
	if err != nil {
		return QledgerBatchFacts{}, err
	}
	f := QledgerBatchFacts{Consumed: inbox.ConsumedSequence, Head: inbox.HeadSequence, End: end, Pending: bond.Pending, MinBond: DefaultMinSubmitterBondUqor}
	if params.MinSubmitterBond != "" {
		if f.MinBond, err = strconv.ParseUint(params.MinSubmitterBond, 10, 64); err != nil {
			return QledgerBatchFacts{}, fmt.Errorf("qledger: unreadable min_submitter_bond %q", params.MinSubmitterBond)
		}
	}
	if f.Bond, err = strconv.ParseUint(bond.Amount, 10, 64); err != nil {
		return QledgerBatchFacts{}, fmt.Errorf("qledger: unreadable submitter bond %q", bond.Amount)
	}
	if end == f.Head {
		f.EndRetained = true
	} else if end < f.Head {
		ib, err := rest.GetInbox(ctx, rollupID, end)
		if err != nil {
			return QledgerBatchFacts{}, err
		}
		f.EndRetained = ib.RangeDataHash != ""
		next, err := rest.GetPostedData(ctx, rollupID, end+1)
		switch {
		case err == nil:
			kept, h := true, next.Height
			f.NextRetained, f.NextHeight = &kept, &h
		case isNotFound(err):
			gone := false
			f.NextRetained = &gone
		default:
			return QledgerBatchFacts{}, err
		}
	}
	height, err := rest.GetLatestHeight(ctx)
	if err != nil {
		return QledgerBatchFacts{}, err
	}
	inclusion := height + margin
	f.InclusionHeight = &inclusion
	return f, nil
}

// PlanQledgerBatchInput configures PlanQledgerBatch.
type PlanQledgerBatchInput struct {
	ChainID  string
	RollupID string
	// Submitter is the address that will sign the batch (its Sequencer).
	Submitter string
	// Ledger is the state after the rollup's latest batch, or an empty ledger
	// before the first. It is not modified.
	Ledger *QledgerLedger
	// InclusionMargin is added to the current height for the 20-block rule
	// (0 means 5).
	InclusionMargin uint64
}

// QledgerBatchPlan is a qledger-v1 batch ready to sign, with what it settles.
type QledgerBatchPlan struct {
	// Msg is the batch to submit, signed by the submitter.
	Msg MsgSubmitBatch
	// Entries are the inbox entries consumed, Result the execution result
	// (the withdrawals to pay later).
	Entries []QledgerEntry
	Result  QledgerResult
	// Ledger is the state after the batch: the parent state of the next one
	// once this batch settles.
	Ledger *QledgerLedger
}

// PlanQledgerBatch plans the next qledger-v1 batch of a rollup from the
// chain: it chooses the end by the admission rules, fetches and verifies the
// entries, executes them on a copy of in.Ledger and returns the batch. It
// errors with the chain's reason when no batch can be admitted now (no bond,
// too many pending, nothing to consume).
func PlanQledgerBatch(ctx context.Context, rest *RestClient, in PlanQledgerBatchInput) (QledgerBatchPlan, error) {
	if in.Ledger == nil {
		return QledgerBatchPlan{}, errors.New("qledger: pass the ledger the batch starts from (NewQledgerLedger before the first batch)")
	}
	rollup, err := rest.GetRollup(ctx, in.RollupID)
	if err != nil {
		return QledgerBatchPlan{}, err
	}
	if rollup.ExecutionVm != string(ExecutionVmQLedgerV1) {
		return QledgerBatchPlan{}, fmt.Errorf("rollup %s is not a qledger-v1 rollup", in.RollupID)
	}
	inbox, err := rest.GetInbox(ctx, in.RollupID, 0)
	if err != nil {
		return QledgerBatchPlan{}, err
	}
	consumed, head := inbox.ConsumedSequence, inbox.HeadSequence
	end, ok, err := ChooseQledgerBatchEnd(consumed, head, func(x uint64) (bool, error) {
		if x == head {
			return true, nil
		}
		ib, err := rest.GetInbox(ctx, in.RollupID, x)
		return ib.RangeDataHash != "", err
	})
	if err != nil {
		return QledgerBatchPlan{}, err
	}
	if !ok {
		return QledgerBatchPlan{}, fmt.Errorf("rollup %s has nothing to settle: its inbox is fully consumed", in.RollupID)
	}
	margin := in.InclusionMargin
	if margin == 0 {
		margin = 5
	}
	facts, err := qledgerLiveFacts(ctx, rest, in.RollupID, in.Submitter, inbox, end, margin)
	if err != nil {
		return QledgerBatchPlan{}, err
	}
	if errs := QledgerBatchErrors(facts); len(errs) > 0 {
		return QledgerBatchPlan{}, fmt.Errorf("no qledger-v1 batch can be admitted now: %s", strings.Join(errs, "; "))
	}

	accFrom, err := HexToBytes(inbox.ConsumedAcc)
	if err != nil {
		return QledgerBatchPlan{}, fmt.Errorf("qledger: unreadable consumed_acc: %w", err)
	}
	entries, err := FetchQledgerEntries(ctx, rest, FetchQledgerEntriesInput{
		ChainID: in.ChainID, RollupID: in.RollupID, From: consumed, To: end, AccFrom: accFrom,
	})
	if err != nil {
		return QledgerBatchPlan{}, err
	}
	accTo := QledgerAccumulate(in.ChainID, in.RollupID, consumed, accFrom, entries)
	dataHash := InboxRangeHash(InboxRangeInput{
		ChainID: in.ChainID, RollupID: in.RollupID, From: consumed, To: end, AccFrom: accFrom, AccTo: accTo,
	})

	var batchIndex uint64
	prevStateRoot := QledgerEmptyRoot()
	latest, err := rest.GetLatestBatch(ctx, in.RollupID)
	switch {
	case isNotFound(err):
	case err != nil:
		return QledgerBatchPlan{}, err
	case latest.StateRoot != "":
		if prevStateRoot, err = HexToBytes(latest.StateRoot); err != nil {
			return QledgerBatchPlan{}, fmt.Errorf("qledger: unreadable state root of the latest batch: %w", err)
		}
		batchIndex = uint64(latest.BatchIndex) + 1
	}
	if root := in.Ledger.Root(); !bytes.Equal(root, prevStateRoot) {
		return QledgerBatchPlan{}, fmt.Errorf("qledger: the ledger you passed has root %s, but the rollup's latest state root is %s",
			BytesToHex(root), BytesToHex(prevStateRoot))
	}
	ledger := in.Ledger.Clone()
	result, err := ExecuteQledger(QledgerEnv{ChainID: in.ChainID, RollupID: in.RollupID}, ledger, entries)
	if err != nil {
		return QledgerBatchPlan{}, err
	}
	return QledgerBatchPlan{
		Msg: MsgSubmitBatch{
			Sequencer:       in.Submitter,
			RollupID:        in.RollupID,
			BatchIndex:      batchIndex,
			StateRoot:       result.StateRoot,
			PrevStateRoot:   prevStateRoot,
			TxCount:         uint64(len(entries)),
			DataHash:        dataHash,
			WithdrawalsRoot: result.WithdrawalsRoot,
			InboxEnd:        end,
		},
		Entries: entries,
		Result:  result,
		Ledger:  ledger,
	}, nil
}
