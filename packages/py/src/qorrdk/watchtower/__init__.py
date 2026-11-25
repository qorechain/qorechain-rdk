"""Watchtower helpers: decide whether a settlement batch would survive a
challenge, by the rule the chain applies to its rollup.

For a qledger-v1 rollup, :func:`qledger_validator` gives a predicate that is
``True`` exactly when a challenge against a batch would be dismissed, and
:func:`qledger_fraud_proof_for_batch` the proof that wins one against a batch
that is wrong. The chain judges these batches by re-executing their inbox
entries, not by the transition-root rule of :mod:`qorrdk.transition`.

Mirrors the TS ``watchtower`` module's qledger-v1 support with idiomatic Python.
"""

from __future__ import annotations

from .qledger import (
    QledgerEntryReader,
    QledgerJudge,
    QledgerJudgement,
    qledger_fraud_proof_for_batch,
    qledger_validator,
)

__all__ = [
    "QledgerEntryReader",
    "QledgerJudge",
    "QledgerJudgement",
    "qledger_fraud_proof_for_batch",
    "qledger_validator",
]
