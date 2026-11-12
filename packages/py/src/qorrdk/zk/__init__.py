"""ZK public inputs as the chain checks them (chain v3.2.8+,
``rdk-zk-canonical-inputs``).

A Groth16 batch is verified with four public inputs, in order:
``prev_state_root``, ``state_root``, ``data_hash``, ``withdrawals_root``, each
read as a 32-byte big-endian integer. From v3.2.8 the chain no longer reduces a
submitter-chosen input into the BLS12-381 scalar field: it refuses the batch
unless the value is already below the scalar modulus ``r``. A raw SHA-256 or
SHAKE-256 output is at or above ``r`` about 55% of the time.

- ``prev_state_root`` and ``state_root`` are always checked. Commit to state
  with a field-friendly hash, or reduce with :func:`to_canonical_scalar` and
  prove the reduced value.
- ``data_hash`` is not checked when the chain fixed it itself: a based
  rollup's inbox range commitment, or a native-DA batch whose hash names a
  posted or stored blob (:func:`is_data_hash_chain_bound`). Otherwise it must
  be canonical.
- ``withdrawals_root`` may be any 32 bytes: the chain stores it reduced
  modulo r and checks withdrawals against it modulo r
  (:func:`withdrawals_root_matches`). The circuit's fourth input is
  ``int(withdrawals_root) mod r`` (:func:`zk_public_inputs`).
"""

from __future__ import annotations

from typing import Any, Optional, Union

from ..utils.bytes import to_bytes

BytesLike = Union[str, bytes, bytearray]

#: The BLS12-381 scalar field modulus ``r``.
BLS12_381_SCALAR_MODULUS = int(
    "73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001", 16
)


def _to_int(value: BytesLike) -> int:
    return int.from_bytes(to_bytes(value), "big")


def is_canonical_scalar(value: BytesLike) -> bool:
    """Whether a big-endian value is a canonical BLS12-381 scalar (strictly below ``r``)."""
    return _to_int(value) < BLS12_381_SCALAR_MODULUS


def to_canonical_scalar(value: BytesLike) -> bytes:
    """Reduce a big-endian value modulo ``r`` and return it as 32 big-endian
    bytes. Use it for values the rollup chooses (state roots, an unbound data
    hash), and prove the reduced value in the circuit."""
    return (_to_int(value) % BLS12_381_SCALAR_MODULUS).to_bytes(32, "big")


def zk_public_input_errors(
    *,
    state_root: BytesLike,
    prev_state_root: Optional[BytesLike] = None,
    data_hash: Optional[BytesLike] = None,
    withdrawals_root: Optional[BytesLike] = None,
    data_hash_bound: bool = False,
) -> list[str]:
    """Why the chain would refuse a zk (snark) batch's public inputs as not
    canonical, one message per input; empty when they are all accepted.

    ``data_hash_bound``: the chain fixed ``data_hash`` itself (see
    :func:`is_data_hash_chain_bound`), so it is not checked.
    ``withdrawals_root`` is accepted for symmetry and never refused: the chain
    takes any 32 bytes and reduces it modulo r.
    """
    checks: list[tuple[str, Optional[BytesLike]]] = [
        ("prev_state_root", prev_state_root),
        ("state_root", state_root),
    ]
    if not data_hash_bound:
        checks.append(("data_hash", data_hash))
    errors: list[str] = []
    for name, value in checks:
        if value is None:
            continue
        if not is_canonical_scalar(value):
            errors.append(
                f"{name} is not a canonical BLS12-381 scalar (it must be below r): "
                "reduce it with to_canonical_scalar and prove the reduced value"
            )
    return errors


def zk_public_inputs(
    *,
    state_root: BytesLike,
    prev_state_root: Optional[BytesLike] = None,
    data_hash: Optional[BytesLike] = None,
    withdrawals_root: Optional[BytesLike] = None,
) -> list[bytes]:
    """The four public inputs of a Groth16 rollup circuit, in the chain's order
    (``prev_state_root``, ``state_root``, ``data_hash``, ``withdrawals_root``),
    each the 32-byte big-endian value reduced modulo r. An empty value is 0.
    Use them as the circuit's public witness."""
    return [
        to_canonical_scalar(b"" if v is None else v)
        for v in (prev_state_root, state_root, data_hash, withdrawals_root)
    ]


def withdrawals_root_matches(
    stored_root: BytesLike, tree_root: BytesLike, withdrawals_root_reduced: bool
) -> bool:
    """Whether a withdrawals tree root matches a batch's stored root, as the
    chain checks a withdrawal: modulo r when the batch's
    ``withdrawals_root_reduced`` is set (chain v3.2.8+ Groth16 batches), byte
    for byte otherwise."""
    if withdrawals_root_reduced:
        r = BLS12_381_SCALAR_MODULUS
        return _to_int(stored_root) % r == _to_int(tree_root) % r
    return to_bytes(stored_root) == to_bytes(tree_root)


def is_data_hash_chain_bound(rollup: Any, data_hash: Optional[BytesLike] = None) -> bool:
    """Whether the chain fixes a batch's ``data_hash`` itself, so it is exempt
    from the canonical check: always on a based rollup (the inbox range
    commitment), and on a ``native`` or ``both`` DA rollup when the hash is
    non-empty (the chain then requires a posted or stored blob with exactly
    that hash).

    ``rollup`` is a :class:`~qorrdk.client.views.RollupView` or a dict with
    ``da_backend`` and optionally ``sequencing``.
    """
    if isinstance(rollup, dict):
        da_backend = rollup.get("da_backend", "")
        sequencing = rollup.get("sequencing", "")
    else:
        da_backend = getattr(rollup, "da_backend", "")
        sequencing = getattr(rollup, "sequencing", "")
    if sequencing == "based":
        return True
    non_empty = data_hash is not None and len(to_bytes(data_hash)) > 0
    return non_empty and da_backend in ("native", "both")


__all__ = [
    "BLS12_381_SCALAR_MODULUS",
    "is_canonical_scalar",
    "to_canonical_scalar",
    "zk_public_input_errors",
    "zk_public_inputs",
    "withdrawals_root_matches",
    "is_data_hash_chain_bound",
]
