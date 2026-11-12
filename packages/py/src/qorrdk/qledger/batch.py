"""Building qledger-v1 batches by the chain's admission rules (chain v3.2.8).

A qledger-v1 batch with ``inbox_end = end`` is admitted when:

1. the submitter holds at least ``min_submitter_bond`` on the rollup and has
   fewer than 1,024 of its batches waiting for finality;
2. ``consumed < end <= head`` (at least one entry);
3. ``end - consumed <= 64``;
4. ``end`` is the head, or the commitment of post ``end`` is retained;
5. a batch of fewer than 64 entries that stops before the head stops just
   before a post made in the last 20 blocks, or at a checkpoint (``end`` a
   multiple of 64) whose next post is no longer retained;
6. ``data_hash`` is the inbox range commitment from ``consumed`` to ``end``,
   the first batch starts from the empty ledger root, and ``state_root`` is 32
   bytes.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Optional, Sequence, Union

from ..constants import DEFAULT_MIN_SUBMITTER_BOND_UQOR
from ..inbox import inbox_accumulate, inbox_range_hash, posted_data_hash
from ..utils.bytes import decode_wire_bytes, hex_to_bytes, to_bytes
from .execute import QledgerEntry, QledgerResult, execute_qledger
from .fraud import QLEDGER_MAX_BATCH_ENTRIES
from .smt import QledgerLedger, qledger_empty_root
from .tx import QLEDGER_DEPOSIT_POSTER_PREFIX, encode_qledger_deposit

if TYPE_CHECKING:  # pragma: no cover
    from ..client.rest import RestClient

BytesLike = Union[str, bytes, bytearray]

#: A post younger than this many blocks may be left for the next batch.
QLEDGER_FRESH_POST_BLOCKS = 20
#: Most batches one submitter may have waiting for finality on a rollup.
QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER = 1024
#: Every post whose sequence is a multiple of this keeps its commitment until
#: a finalized batch covers it.
QLEDGER_CHECKPOINT_INTERVAL = 64
#: Share of a slashed submitter bond that is burned (the challenger receives
#: the rest).
QLEDGER_SLASH_BURN_PERCENT = 50

_POST_MSG_TYPE = "/qorechain.rdk.v1.MsgPostRollupData"


def is_qledger_checkpoint(sequence: int) -> bool:
    """Whether ``sequence`` is a qledger-v1 checkpoint (a non-zero multiple of 64)."""
    s = int(sequence)
    return s != 0 and s % QLEDGER_CHECKPOINT_INTERVAL == 0


def qledger_batch_errors(
    *,
    consumed: int,
    head: int,
    end: int,
    bond: Union[int, str],
    min_bond: Union[int, str],
    pending: int,
    end_retained: bool,
    next_retained: Optional[bool] = None,
    next_height: Optional[int] = None,
    inclusion_height: Optional[int] = None,
) -> list[str]:
    """Every rule a qledger-v1 batch range would break; empty when the chain
    admits it.

    ``end_retained``: whether the commitment of post ``end`` is retained
    (ignored when ``end`` is the head). ``next_retained`` / ``next_height``:
    whether the commitment of post ``end + 1`` is retained, and its height
    (needed when ``end`` is before the head). ``inclusion_height``: the height
    the batch is expected to be included at; the chain judges the 20-block
    rule at inclusion, so pass the current height plus a margin for the time
    the transaction takes to land.
    """
    errors: list[str] = []
    consumed, head, end = int(consumed), int(head), int(end)
    if int(bond) < int(min_bond):
        errors.append(f"the submitter holds {bond} uqor of bond, at least {min_bond} is needed")
    if int(pending) >= QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER:
        errors.append(
            f"the submitter already has {pending} batches waiting for finality, at most "
            f"{QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER}"
        )
    if end <= consumed:
        errors.append(
            f"a batch consumes at least one inbox entry (consumed {consumed}, inbox_end {end})"
        )
        return errors
    if end > head:
        errors.append(f"inbox_end {end} is past the head {head}")
    n = end - consumed
    if n > QLEDGER_MAX_BATCH_ENTRIES:
        errors.append(
            f"a batch consumes at most {QLEDGER_MAX_BATCH_ENTRIES} inbox entries, this one {n}"
        )
    if end < head and not end_retained:
        errors.append(
            f"the commitment of post {end} is no longer retained: end the batch at the head "
            "or at a retained post"
        )
    if n < QLEDGER_MAX_BATCH_ENTRIES and end < head:
        checkpoint_stop = is_qledger_checkpoint(end) and next_retained is False
        fresh_stop = (
            next_retained is not False
            and next_height is not None
            and inclusion_height is not None
            and int(next_height) + QLEDGER_FRESH_POST_BLOCKS > int(inclusion_height)
        )
        if not checkpoint_stop and not fresh_stop:
            errors.append(
                f"a batch of fewer than {QLEDGER_MAX_BATCH_ENTRIES} entries consumes every post "
                f"older than {QLEDGER_FRESH_POST_BLOCKS} blocks: post {end + 1} must be in it"
            )
    return errors


def choose_qledger_batch_end(
    *, consumed: int, head: int, retained: Callable[[int], bool]
) -> Optional[int]:
    """The ``end`` a submitter should choose (the chain's recommended logic): a
    full batch of 64 or the head when that position is retained, otherwise the
    next checkpoint (after a long idle period, when only checkpoints kept their
    commitments). ``None`` when nothing is waiting.

    ``retained(x)``: whether the commitment of post ``x`` is retained
    (``RestClient.get_inbox(rollup_id, x).range_data_hash != ""``).
    """
    consumed, head = int(consumed), int(head)
    if head <= consumed:
        return None
    want = min(head, consumed + QLEDGER_MAX_BATCH_ENTRIES)
    if want == head or retained(want):
        return want
    return (consumed // QLEDGER_CHECKPOINT_INTERVAL + 1) * QLEDGER_CHECKPOINT_INTERVAL


def _b64(s: Any) -> bytes:
    return base64.b64decode(str(s or ""), validate=False)


def _attrs(ev: Any) -> dict[str, str]:
    out: dict[str, str] = {}
    lst = ev.get("attributes") if isinstance(ev, dict) else None
    for a in lst if isinstance(lst, list) else []:
        if isinstance(a, dict):
            v = a.get("value")
            out[str(a.get("key"))] = "" if v is None else str(v)
    return out


def is_http_not_found(err: BaseException) -> bool:
    """Whether a read client error is an HTTP 404 (the chain has no such
    record). Only that means "not retained" or "no batch yet"; any other
    error (a network fault, a 5xx) is re-raised so it is never taken for one."""
    return isinstance(err, RuntimeError) and " failed: 404 " in f"{err} "


def _norm_hex(s: str) -> str:
    s = s.strip()
    return (s[2:] if s[:2] in ("0x", "0X") else s).lower()


def _wire(s: str) -> bytes:
    """A hash field as the node serves it (hex, possibly ``0x``, or base64)."""
    s = s.strip()
    if s[:2] in ("0x", "0X"):
        return hex_to_bytes(s)
    return decode_wire_bytes(s)


def qledger_accumulate(
    *,
    chain_id: str,
    rollup_id: str,
    from_sequence: int,
    acc_from: BytesLike,
    entries: Sequence[QledgerEntry],
) -> bytes:
    """The inbox accumulator after ``entries``, starting from ``acc_from`` at
    sequence ``from_sequence``."""
    acc = to_bytes(acc_from)
    for i, e in enumerate(entries):
        acc = inbox_accumulate(
            chain_id=chain_id,
            rollup_id=rollup_id,
            prev_acc=acc,
            sequence=int(from_sequence) + i + 1,
            height=e.height,
            poster=e.poster,
            data_hash=posted_data_hash(e.payload),
        )
    return acc


def _verify_entries(
    rest: "RestClient",
    *,
    chain_id: str,
    rollup_id: str,
    from_sequence: int,
    to_sequence: int,
    acc_from: BytesLike,
    entries: Sequence[QledgerEntry],
) -> None:
    """Check fetched entries against the chain's inbox commitments: the range
    commitment when the range starts at the consumed position, else the head
    accumulator when it ends at the head, else the accumulator stored with
    post ``to_sequence``."""
    acc_to = qledger_accumulate(
        chain_id=chain_id, rollup_id=rollup_id, from_sequence=from_sequence,
        acc_from=acc_from, entries=entries,
    )
    mismatch = ValueError(
        f"qledger: the entries {from_sequence + 1}..{to_sequence} of rollup {rollup_id} read "
        "from the transaction index do not match the chain's inbox accumulator"
    )
    inbox = rest.get_inbox(rollup_id, to_sequence)
    if (
        inbox.range_data_hash
        and inbox.consumed_sequence == from_sequence
        and inbox.range_end == to_sequence
    ):
        want = inbox_range_hash(
            chain_id=chain_id, rollup_id=rollup_id, from_sequence=from_sequence,
            to_sequence=to_sequence, acc_from=acc_from, acc_to=acc_to,
        )
        if _norm_hex(inbox.range_data_hash) != want.hex():
            raise mismatch
        return
    if inbox.head_acc and inbox.head_sequence == to_sequence:
        if _wire(inbox.head_acc) != acc_to:
            raise mismatch
        return
    try:
        posted = rest.get_posted_data(rollup_id, to_sequence)
    except RuntimeError as err:
        if not is_http_not_found(err):
            raise
        raise ValueError(
            f"qledger: entries {from_sequence + 1}..{to_sequence} of rollup {rollup_id} cannot be "
            "checked: the chain no longer holds a commitment for them"
        ) from err
    if not posted.inbox_acc or _wire(posted.inbox_acc) != acc_to:
        raise mismatch


def fetch_qledger_entries(
    rest: "RestClient",
    *,
    chain_id: str,
    rollup_id: str,
    from_sequence: int,
    to_sequence: int,
    acc_from: BytesLike,
) -> list[QledgerEntry]:
    """The inbox entries ``from_sequence + 1 .. to_sequence`` of a qledger-v1
    rollup, read back from the transactions that posted them (the chain keeps
    only commitments; the bytes stay in block history). Posts come from
    ``MsgPostRollupData``, deposits from the ``rdk_rollup_deposit`` event.

    The entries are checked against the chain's inbox accumulator before they
    are returned (``acc_from`` is the accumulator at ``from_sequence``, empty
    or the 32 zero bytes before the first post). Needs a node with
    transaction indexing on.
    """
    lo, hi = int(from_sequence), int(to_sequence)
    if hi <= lo:
        return []
    by_seq: dict[int, QledgerEntry] = {}

    def query(event: str) -> str:
        return f"{event}.rollup_id='{rollup_id}'"

    for tx in rest.search_txs(query("rdk_data_posted")):
        height = int(str(tx.get("height") or "0"))
        tx_obj = tx.get("tx") if isinstance(tx.get("tx"), dict) else {}
        body = tx_obj.get("body") if isinstance(tx_obj.get("body"), dict) else {}
        msgs = [
            m for m in (body.get("messages") or [])
            if isinstance(m, dict) and m.get("@type") == _POST_MSG_TYPE
        ]
        for ev in tx.get("events") or []:
            if not isinstance(ev, dict) or ev.get("type") != "rdk_data_posted":
                continue
            a = _attrs(ev)
            if a.get("rollup_id") != rollup_id:
                continue
            seq = int(a.get("sequence") or "0")
            if seq <= lo or seq > hi:
                continue
            payload: Optional[bytes] = None
            for m in msgs:
                try:
                    d = _b64(m.get("data"))
                except (binascii.Error, ValueError):
                    continue
                if (
                    posted_data_hash(d).hex() == _norm_hex(a.get("data_hash", ""))
                    and str(m.get("poster")) == a.get("poster")
                ):
                    payload = d
                    break
            if payload is None:
                raise ValueError(
                    f"qledger: post {seq} is in transaction {tx.get('txhash')} but its payload "
                    "could not be matched"
                )
            by_seq[seq] = QledgerEntry(height=height, poster=a.get("poster", ""), payload=payload)

    for tx in rest.search_txs(query("rdk_rollup_deposit")):
        height = int(str(tx.get("height") or "0"))
        for ev in tx.get("events") or []:
            if not isinstance(ev, dict) or ev.get("type") != "rdk_rollup_deposit":
                continue
            a = _attrs(ev)
            if a.get("rollup_id") != rollup_id:
                continue
            seq = int(a.get("sequence") or "0")
            if seq <= lo or seq > hi:
                continue
            amount = a.get("amount") or "0"
            if amount.endswith("uqor"):
                amount = amount[: -len("uqor")]
            by_seq[seq] = QledgerEntry(
                height=height,
                poster=QLEDGER_DEPOSIT_POSTER_PREFIX + a.get("depositor", ""),
                payload=encode_qledger_deposit(hex_to_bytes(a.get("account", "")), int(amount)),
            )

    entries: list[QledgerEntry] = []
    for s in range(lo + 1, hi + 1):
        e = by_seq.get(s)
        if e is None:
            raise ValueError(
                f"qledger: inbox entry {s} of rollup {rollup_id} was not found in the node's "
                "transaction index"
            )
        entries.append(e)
    _verify_entries(
        rest, chain_id=chain_id, rollup_id=rollup_id, from_sequence=lo, to_sequence=hi,
        acc_from=acc_from, entries=entries,
    )
    return entries


@dataclass
class QledgerBatchPlan:
    """A qledger-v1 batch ready for ``RdkTxClient.submit_batch``, with what it
    settles."""

    #: Pass to ``submit_batch`` (the client fills in the sequencer).
    input: dict[str, Any]
    #: The entries consumed.
    entries: list[QledgerEntry] = field(default_factory=list)
    #: The execution result (withdrawals to pay later).
    result: Optional[QledgerResult] = None
    #: The ledger after the batch: the parent state of the next one.
    ledger: Optional[QledgerLedger] = None


def _retained_fn(rest: "RestClient", rollup_id: str, head: int) -> Callable[[int], bool]:
    def retained(x: int) -> bool:
        return x == head or rest.get_inbox(rollup_id, x).range_data_hash != ""

    return retained


def _next_post(rest: "RestClient", rollup_id: str, end: int, head: int) -> tuple[Optional[bool], Optional[int]]:
    if end >= head:
        return None, None
    try:
        return True, rest.get_posted_data(rollup_id, end + 1).height
    except RuntimeError as err:
        if not is_http_not_found(err):
            raise
        return False, None


def plan_qledger_batch(
    rest: "RestClient",
    *,
    chain_id: str,
    rollup_id: str,
    submitter: str,
    ledger: QledgerLedger,
    inclusion_margin: int = 5,
) -> QledgerBatchPlan:
    """Plan the next qledger-v1 batch of a rollup from the chain: choose
    ``end`` by the admission rules, fetch and verify the entries, execute them
    on ``ledger`` (the state after the rollup's latest batch, or an empty
    ledger before the first), and return the batch. Raises with the chain's
    reason when no batch can be admitted now (no bond, too many pending,
    nothing to consume).

    ``inclusion_margin``: blocks added to the current height for the 20-block
    rule. The submitter keeps ``plan.ledger`` as the parent state of its next
    batch once this one settles.
    """
    rollup = rest.get_rollup(rollup_id)
    params = rest.get_params()
    bond = rest.get_submitter_bond(rollup_id, submitter)
    inbox = rest.get_inbox(rollup_id)
    if rollup.execution_vm != "qledger-v1":
        raise ValueError(f"rollup {rollup_id} is not a qledger-v1 rollup")
    consumed = int(inbox.consumed_sequence)
    head = int(inbox.head_sequence)
    retained = _retained_fn(rest, rollup_id, head)
    end = choose_qledger_batch_end(consumed=consumed, head=head, retained=retained)
    if end is None:
        raise ValueError(f"rollup {rollup_id} has nothing to settle: its inbox is fully consumed")

    next_retained, next_height = _next_post(rest, rollup_id, end, head)
    inclusion_height = rest.get_latest_height() + int(inclusion_margin)
    errors = qledger_batch_errors(
        consumed=consumed,
        head=head,
        end=end,
        bond=bond.amount,
        min_bond=params.min_submitter_bond or DEFAULT_MIN_SUBMITTER_BOND_UQOR,
        pending=bond.pending,
        end_retained=retained(end),
        next_retained=next_retained,
        next_height=next_height,
        inclusion_height=inclusion_height,
    )
    if errors:
        raise ValueError(f"no qledger-v1 batch can be admitted now: {'; '.join(errors)}")

    acc_from = _wire(inbox.consumed_acc) if inbox.consumed_acc else b""
    rng = rest.get_inbox(rollup_id, end)
    entries = fetch_qledger_entries(
        rest, chain_id=chain_id, rollup_id=rollup_id, from_sequence=consumed, to_sequence=end,
        acc_from=acc_from,
    )
    acc_to = qledger_accumulate(
        chain_id=chain_id, rollup_id=rollup_id, from_sequence=consumed, acc_from=acc_from,
        entries=entries,
    )
    data_hash = inbox_range_hash(
        chain_id=chain_id, rollup_id=rollup_id, from_sequence=consumed, to_sequence=end,
        acc_from=acc_from, acc_to=acc_to,
    )
    if rng.range_data_hash and data_hash.hex() != _norm_hex(rng.range_data_hash):
        raise ValueError(
            "qledger: the fetched entries do not hash to the chain's inbox range commitment"
        )

    try:
        latest = rest.get_latest_batch(rollup_id)
    except RuntimeError as err:
        if not is_http_not_found(err):
            raise
        latest = None
    prev_state_root = _wire(latest.state_root) if latest is not None else qledger_empty_root()
    if ledger.root() != prev_state_root:
        raise ValueError(
            f"qledger: the ledger you passed has root {ledger.root().hex()}, but the rollup's "
            f"latest state root is {prev_state_root.hex()}"
        )
    after = ledger.clone()
    result = execute_qledger(after, entries, chain_id=chain_id, rollup_id=rollup_id)
    return QledgerBatchPlan(
        input={
            "rollup_id": rollup_id,
            "batch_index": latest.batch_index + 1 if latest is not None else 0,
            "prev_state_root": prev_state_root,
            "state_root": result.state_root,
            "tx_count": len(entries),
            "data_hash": data_hash,
            "withdrawals_root": result.withdrawals_root,
            "inbox_end": end,
        },
        entries=entries,
        result=result,
        ledger=after,
    )


__all__ = [
    "QLEDGER_FRESH_POST_BLOCKS",
    "QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER",
    "QLEDGER_CHECKPOINT_INTERVAL",
    "QLEDGER_SLASH_BURN_PERCENT",
    "QledgerBatchPlan",
    "is_http_not_found",
    "is_qledger_checkpoint",
    "qledger_batch_errors",
    "choose_qledger_batch_end",
    "fetch_qledger_entries",
    "qledger_accumulate",
    "plan_qledger_batch",
]
