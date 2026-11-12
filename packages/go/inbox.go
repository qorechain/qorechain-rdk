package rdk

import "crypto/sha256"

// Posted rollup data and the rollup inbox (chain v3.2.8+).
//
// MsgPostRollupData gives each post the next inbox sequence (from 1) and
// extends the rollup's inbox accumulator:
//
//	acc_n = SHA-256("qorechain/rdk/inbox/v1" | lp(chain_id) | lp(rollup_id) | acc_{n-1}
//	                | be64(n) | be64(height) | lp(poster) | SHA-256(data))
//
// with acc_0 32 zero bytes and lp a 4-byte big-endian length prefix. A batch of
// a based rollup sets InboxEnd and carries as DataHash the range commitment
// from the consumed position to InboxEnd:
//
//	range = SHA-256("qorechain/rdk/inbox-range/v1" | lp(chain_id) | lp(rollup_id)
//	                | be64(from) | be64(to) | acc_from | acc_to)
//
// The chain returns it too (RestClient.GetInbox). A native-DA batch of a rollup
// that is not based may carry SHA-256(data) of a retained post as its
// DataHash.

const (
	inboxAccDomain   = "qorechain/rdk/inbox/v1"
	inboxRangeDomain = "qorechain/rdk/inbox-range/v1"
)

// EmptyInboxAcc is the accumulator of an inbox with no post: 32 zero bytes (a
// fresh slice on every call).
func EmptyInboxAcc() []byte { return make([]byte, 32) }

// PostedDataHash is SHA-256 of a post's payload: the hash a batch references.
func PostedDataHash(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}

// InboxAccumulateInput is one post as the accumulator covers it.
type InboxAccumulateInput struct {
	ChainID  string
	RollupID string
	// PrevAcc is the accumulator before this post (empty for the first).
	PrevAcc  []byte
	Sequence uint64
	// Height is the height of the block that included the post.
	Height uint64
	Poster string
	// DataHash is SHA-256 of the payload (PostedDataHash).
	DataHash []byte
}

// InboxAccumulate is one step of the inbox accumulator: what the chain stores
// after post in.Sequence.
func InboxAccumulate(in InboxAccumulateInput) []byte {
	prev := in.PrevAcc
	if len(prev) == 0 {
		prev = EmptyInboxAcc()
	}
	h := sha256.New()
	h.Write([]byte(inboxAccDomain))
	h.Write(lenPrefixed([]byte(in.ChainID)))
	h.Write(lenPrefixed([]byte(in.RollupID)))
	h.Write(prev)
	h.Write(u64Bytes(in.Sequence))
	h.Write(u64Bytes(in.Height))
	h.Write(lenPrefixed([]byte(in.Poster)))
	h.Write(in.DataHash)
	return h.Sum(nil)
}

// InboxRangeInput names a range of the inbox: the posts after From (the
// consumed position) up to To (the batch's InboxEnd).
type InboxRangeInput struct {
	ChainID  string
	RollupID string
	From     uint64
	To       uint64
	// AccFrom and AccTo are the accumulators at From and To (empty reads as
	// the empty inbox).
	AccFrom []byte
	AccTo   []byte
}

// InboxRangeHash is the inbox range commitment a based batch carries as its
// DataHash.
func InboxRangeHash(in InboxRangeInput) []byte {
	accFrom, accTo := in.AccFrom, in.AccTo
	if len(accFrom) == 0 {
		accFrom = EmptyInboxAcc()
	}
	if len(accTo) == 0 {
		accTo = EmptyInboxAcc()
	}
	h := sha256.New()
	h.Write([]byte(inboxRangeDomain))
	h.Write(lenPrefixed([]byte(in.ChainID)))
	h.Write(lenPrefixed([]byte(in.RollupID)))
	h.Write(u64Bytes(in.From))
	h.Write(u64Bytes(in.To))
	h.Write(accFrom)
	h.Write(accTo)
	return h.Sum(nil)
}
