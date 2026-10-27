"""Post-quantum (ML-DSA-87) key resolution for hybrid signing.

Built on the QoreChain Python SDK (``qorechain-sdk``, import ``qorsdk``): the
canonical and legacy derivations and the keypair type are the SDK's own. The
resolution rules mirror the TypeScript RDK's ``resolvePqcKeypair`` and
``pqcKeypairFromEnv``: ask the chain which key the account holds, and sign with
that one.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Mapping, Optional

from dilithium_py.ml_dsa import ML_DSA_87
from qorsdk.authenticator import derive_pqc_canonical, derive_pqc_legacy
from qorsdk.pqc import PqcKeypair

from ..utils.bytes import hex_to_bytes

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..client.rdk_client import RdkClient

#: Which derivation produced an operator's post-quantum key.
PqcDerivation = Literal["canonical", "legacy", "seed"]


@dataclass(frozen=True)
class ResolvedPqcKeypair:
    """The outcome of :func:`resolve_pqc_keypair` / :func:`pqc_keypair_from_env`."""

    keypair: PqcKeypair
    derivation: PqcDerivation
    #: The chain already holds this key for the account.
    registered: bool
    #: Pass this as ``include_pqc_public_key`` to ``connect_tx``: ``True`` when
    #: the account has no key on chain yet, so the first hybrid transaction
    #: registers it.
    include_pqc_public_key: bool


def pqc_keypair_from_seed(seed: bytes) -> PqcKeypair:
    """The ML-DSA-87 keypair for a 32-byte seed (FIPS 204 seeded key generation)."""
    if len(seed) != 32:
        raise ValueError(f"ML-DSA-87 seed must be 32 bytes, got {len(seed)}")
    public_key, secret_key = ML_DSA_87.key_derive(bytes(seed))
    return PqcKeypair(public_key=bytes(public_key), secret_key=bytes(secret_key))


def _registered_pqc_key(client: "RdkClient", address: str) -> str:
    """The account's registered public key as lowercase hex, or ``""`` if none."""
    try:
        return client.rest.get_pqc_account(address).public_key.lower()
    except Exception:  # noqa: BLE001 - an account with no record reads as "not registered"
        return ""


def resolve_pqc_keypair(
    client: "RdkClient", address: str, mnemonic: str
) -> ResolvedPqcKeypair:
    """Find the ML-DSA-87 keypair an account actually uses, by asking the chain.

    A mnemonic can yield two post-quantum keys, and a wallet may have registered
    either: the **canonical** one (address-bound,
    ``shake256("qorechain:pqc:v1|" + account + "|" + mnemonic)``, what unified
    accounts use) or the **legacy** one (the older chain-bridge scheme). Signing
    with the wrong one is not a soft failure: the hybrid signature would not
    match the registered key and every transaction would be refused. So this
    derives both and returns whichever the chain has registered.

    - If the account has **no** key registered, it returns the canonical key
      with ``include_pqc_public_key=True``, so the first transaction registers it.
    - If the account has a key that **neither** derivation produces, it raises:
      the key was registered from another secret, and guessing would only cost
      a refused transaction. Supply that keypair explicitly instead.
    """
    canonical = derive_pqc_canonical(address, mnemonic)
    legacy = derive_pqc_legacy(mnemonic)
    registered_key = _registered_pqc_key(client, address)

    if registered_key == "":
        return ResolvedPqcKeypair(canonical, "canonical", False, True)
    if registered_key == canonical.public_key.hex():
        return ResolvedPqcKeypair(canonical, "canonical", True, False)
    if registered_key == legacy.public_key.hex():
        return ResolvedPqcKeypair(legacy, "legacy", True, False)
    raise ValueError(
        f"account {address} has a post-quantum key on chain that neither the canonical nor the legacy "
        "derivation of this mnemonic produces, so it was registered from another secret. Supply that "
        "keypair explicitly (QORE_PQC_SEED_HEX), or check that the mnemonic belongs to this account."
    )


def pqc_keypair_from_env(
    client: "RdkClient",
    address: str,
    env: Optional[Mapping[str, Optional[str]]] = None,
) -> Optional[ResolvedPqcKeypair]:
    """The operator's ML-DSA-87 keypair from the environment, checked against
    the chain, or ``None`` when no source is configured (the caller then signs
    classical-only, which both public networks refuse on the native lane).

    - ``QORE_MNEMONIC``: resolved with :func:`resolve_pqc_keypair`, whichever of
      the canonical and legacy derivations the chain has registered.
    - ``QORE_PQC_SEED_HEX``: a 32-byte ML-DSA-87 seed, for an operator who signs
      with a raw private key (``QORE_OPERATOR_PRIVATE_KEY_HEX``) and so has no
      mnemonic to derive from. Takes precedence when set. Still checked against
      the chain, and refused if the account holds a different key.
    """
    env = os.environ if env is None else env
    seed_hex = (env.get("QORE_PQC_SEED_HEX") or "").strip()
    if seed_hex:
        seed = hex_to_bytes(seed_hex)
        if len(seed) != 32:
            raise ValueError(f"QORE_PQC_SEED_HEX must be 32 bytes, got {len(seed)}")
        keypair = pqc_keypair_from_seed(seed)
        registered_key = _registered_pqc_key(client, address)
        if registered_key == "":
            return ResolvedPqcKeypair(keypair, "seed", False, True)
        if registered_key == keypair.public_key.hex():
            return ResolvedPqcKeypair(keypair, "seed", True, False)
        raise ValueError(
            f"QORE_PQC_SEED_HEX does not produce the post-quantum key registered for {address}; "
            "every hybrid transaction signed with it would be refused"
        )
    mnemonic = (env.get("QORE_MNEMONIC") or "").strip()
    if mnemonic:
        return resolve_pqc_keypair(client, address, mnemonic)
    return None


__all__ = [
    "PqcKeypair",
    "PqcDerivation",
    "ResolvedPqcKeypair",
    "derive_pqc_canonical",
    "derive_pqc_legacy",
    "pqc_keypair_from_seed",
    "resolve_pqc_keypair",
    "pqc_keypair_from_env",
]
