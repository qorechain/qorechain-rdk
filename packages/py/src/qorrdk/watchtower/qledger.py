"""Watching qledger-v1 rollups.

The chain decides a challenge against a qledger-v1 batch by re-executing the
inbox entries the batch consumed from its parent state and comparing the state
and withdrawals roots it published (:func:`~qorrdk.qledger.check_qledger_fraud`).
A qledger-v1 state root is the root of the account tree, not the canonical
transition root (:mod:`qorrdk.transition`) other optimistic rollups publish, so
the transition-root rule reports every honest qledger-v1 batch as invalid, and a
transition-root proof (:func:`~qorrdk.transition.fraud_proof`) is one the chain
dismisses.

:func:`qledger_validator` applies the chain's own qledger-v1 rule: it rebuilds
the parent state by replaying the rollup's earlier batches, reads the entries the
batch consumed, builds the fraud proof a challenger would send, and decides it
with :func:`~qorrdk.qledger.check_qledger_fraud`, the same decision the chain
makes. A batch it rejects is one the proof from
:func:`qledger_fraud_proof_for_batch` wins.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, Optional, Protocol, Sequence

from ..enums import BatchStatus
from ..inbox import EMPTY_INBOX_ACC
from ..qledger.batch import fetch_qledger_entries
from ..qledger.execute import QledgerEntry, execute_qledger
from ..qledger.fraud import QledgerClaim, build_qledger_fraud_proof, check_qledger_fraud
from ..qledger.smt import QledgerLedger
from ..utils.bytes import decode_wire_bytes

if TYPE_CHECKING:  # pragma: no cover
    from ..client.rdk_client import RdkClient
    from ..client.views import BatchView

#: How many parent states a :class:`QledgerJudge` keeps by default.
_DEFAULT_MAX_CACHED_STATES = 32


class QledgerEntryReader(Protocol):
    """Reads the inbox entries a batch consumed: sequences ``from_sequence + 1``
    through ``to_sequence``. ``acc_from`` is the inbox accumulator after entry
    ``from_sequence`` (the batch's start)."""

    def __call__(
        self, *, from_sequence: int, to_sequence: int, acc_from: bytes
    ) -> Sequence[QledgerEntry]:
        ...


@dataclass
class QledgerJudgement:
    """How a qledger-v1 batch fares under the chain's fraud rule."""

    #: ``True`` when a challenge against the batch would be dismissed.
    valid: bool
    #: The state root an honest batch over the same entries publishes.
    honest_state_root: bytes
    #: The withdrawals root an honest batch over the same entries publishes
    #: (empty when it has no withdrawal).
    honest_withdrawals_root: bytes
    #: For an invalid batch: the encoded proof that wins ``challenge_batch``.
    proof: Optional[bytes] = None


def _hex_of(wire: str) -> str:
    return decode_wire_bytes(wire).hex()


class QledgerJudge:
    """Judges the batches of one qledger-v1 rollup, keeping the honest ledger
    after each batch it accepts so the next batch is judged without a full
    replay. Calls to :meth:`judge` are serialized with a lock, so one judge may
    be shared between threads; use one judge per rollup.

    ``read_entries`` is where the entries come from. It defaults to
    :func:`~qorrdk.qledger.fetch_qledger_entries`, which reads them back from the
    node's transaction index and checks them against the chain's inbox
    accumulator. Supply your own to read from an archive of posts you keep, for
    example once the node has pruned old transactions.

    ``max_cached_states`` is how many parent states to keep in memory (default
    32, at least 2; the empty ledger is always kept). Older ones are rebuilt by
    replay.
    """

    def __init__(
        self,
        client: "RdkClient",
        rollup_id: str,
        *,
        read_entries: Optional[QledgerEntryReader] = None,
        max_cached_states: Optional[int] = None,
    ) -> None:
        self._client = client
        self._chain_id: str = client.network.chain_id
        self._rollup_id = rollup_id
        self._max_states = max(
            2,
            _DEFAULT_MAX_CACHED_STATES if max_cached_states is None else int(max_cached_states),
        )
        self._read: QledgerEntryReader = (
            read_entries if read_entries is not None else self._fetch_entries
        )
        empty = QledgerLedger()
        self._empty_root = empty.root().hex()
        #: Honest ledgers by state root (hex), oldest first.
        self._states: "OrderedDict[str, QledgerLedger]" = OrderedDict()
        self._states[self._empty_root] = empty
        self._lock = threading.Lock()

    def judge(self, batch: "BatchView") -> QledgerJudgement:
        """Decide ``batch`` as the chain would decide a challenge against it.

        Raises when the batch cannot be decided: when the entries read do not
        belong to it (:func:`~qorrdk.qledger.check_qledger_fraud` refuses the
        proof), or when it builds on a state root no honest replay reaches.
        Such a batch is never reported invalid.
        """
        with self._lock:
            parent = self._ledger_at(_hex_of(batch.prev_state_root))
            return self._judge_on(parent, batch)

    def _fetch_entries(
        self, *, from_sequence: int, to_sequence: int, acc_from: bytes
    ) -> Sequence[QledgerEntry]:
        return fetch_qledger_entries(
            self._client.rest,
            chain_id=self._chain_id,
            rollup_id=self._rollup_id,
            from_sequence=from_sequence,
            to_sequence=to_sequence,
            acc_from=acc_from,
        )

    def _remember(self, root: str, ledger: QledgerLedger) -> None:
        self._states.pop(root, None)
        self._states[root] = ledger
        while len(self._states) > self._max_states:
            oldest = next((k for k in self._states if k != self._empty_root), None)
            if oldest is None:
                break
            del self._states[oldest]

    def _acc_after(self, sequence: int) -> bytes:
        """The inbox accumulator after entry ``sequence`` (posted data is
        numbered from 1)."""
        if sequence == 0:
            return EMPTY_INBOX_ACC
        posted = self._client.rest.get_posted_data(self._rollup_id, sequence)
        return decode_wire_bytes(posted.inbox_acc)

    def _judge_on(self, parent: QledgerLedger, batch: "BatchView") -> QledgerJudgement:
        env = {"chain_id": self._chain_id, "rollup_id": self._rollup_id}
        acc_from = self._acc_after(batch.inbox_start)
        entries = list(
            self._read(
                from_sequence=batch.inbox_start, to_sequence=batch.inbox_end, acc_from=acc_from
            )
        )
        proof, honest = build_qledger_fraud_proof(parent, acc_from, entries, **env)
        # The chain's own decision on that proof. It raises when the entries do
        # not belong to this batch, which leaves the batch undecided rather than
        # invalid.
        fraud = check_qledger_fraud(
            QledgerClaim(
                inbox_start=batch.inbox_start,
                inbox_end=batch.inbox_end,
                data_hash=decode_wire_bytes(batch.data_hash),
                prev_state_root=decode_wire_bytes(batch.prev_state_root),
                state_root=decode_wire_bytes(batch.state_root),
                withdrawals_root=decode_wire_bytes(batch.withdrawals_root),
            ),
            proof,
            **env,
        )
        if not fraud:
            after = parent.clone()
            execute_qledger(after, entries, **env)
            self._remember(after.root().hex(), after)
        return QledgerJudgement(
            valid=not fraud,
            honest_state_root=honest.state_root,
            honest_withdrawals_root=honest.withdrawals_root,
            proof=proof if fraud else None,
        )

    def _ledger_at(self, root: str) -> QledgerLedger:
        """The honest ledger whose root is ``root``, replaying the rollup's
        batches in order from the empty ledger when it is not already known.
        Only a batch that reproduces from a known state is followed, so a root
        that no honest replay reaches is refused: the batch that introduced it
        is the one to challenge."""
        known = self._states.get(root)
        if known is not None:
            return known
        batches = sorted(
            (
                b
                for b in self._client.rest.list_batches(self._rollup_id)
                if b.status != BatchStatus.REJECTED.value
            ),
            key=lambda b: b.batch_index,
        )
        for b in batches:
            if _hex_of(b.state_root) in self._states:
                continue
            parent = self._states.get(_hex_of(b.prev_state_root))
            if parent is None:
                continue
            self._judge_on(parent, b)
            found = self._states.get(root)
            if found is not None:
                return found
        raise ValueError(
            f"qledger: no honest replay of {self._rollup_id} reaches state root {root}; "
            "a batch before this one published it, and that batch is the one a challenge "
            "wins against"
        )


def qledger_validator(
    client: "RdkClient",
    rollup_id: str,
    *,
    read_entries: Optional[QledgerEntryReader] = None,
    max_cached_states: Optional[int] = None,
) -> Callable[["BatchView"], bool]:
    """A batch validity predicate for a qledger-v1 rollup: ``True`` exactly when
    a challenge against the batch would be dismissed. It raises when it cannot
    decide, for example when the batch builds on a state no honest replay
    reaches; report that as an error rather than flagging the batch.

    The predicate keeps one :class:`QledgerJudge` (so earlier states stay
    cached between calls) and is safe to call from a polling thread.
    """
    judge = QledgerJudge(
        client, rollup_id, read_entries=read_entries, max_cached_states=max_cached_states
    )

    def validate(batch: "BatchView") -> bool:
        return judge.judge(batch).valid

    return validate


def qledger_fraud_proof_for_batch(
    client: "RdkClient",
    rollup_id: str,
    batch: "BatchView",
    *,
    read_entries: Optional[QledgerEntryReader] = None,
    max_cached_states: Optional[int] = None,
) -> Optional[bytes]:
    """The qledger-v1 fraud proof that wins a challenge against ``batch``, or
    ``None`` when the batch is right (a challenge would be dismissed and forfeit
    its bond). The proof has already been decided with
    :func:`~qorrdk.qledger.check_qledger_fraud`, the rule the chain applies."""
    judge = QledgerJudge(
        client, rollup_id, read_entries=read_entries, max_cached_states=max_cached_states
    )
    return judge.judge(batch).proof


__all__ = [
    "QledgerEntryReader",
    "QledgerJudge",
    "QledgerJudgement",
    "qledger_fraud_proof_for_batch",
    "qledger_validator",
]
