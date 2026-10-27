"""Account and signing helpers.

Derive a native operator account from a BIP-39 mnemonic (BIP-44 path
``m/44'/118'/0'/0/0``, secp256k1) and build a signer from the environment. The
native address is bech32-encoded with the ``qor`` prefix.

For hybrid (post-quantum) signing, :func:`resolve_pqc_keypair` and
:func:`pqc_keypair_from_env` find the ML-DSA-87 keypair the account actually
uses (canonical, legacy, or an explicit seed), checked against the chain.
"""

from __future__ import annotations

from .pqc import (
    PqcDerivation,
    PqcKeypair,
    ResolvedPqcKeypair,
    derive_pqc_canonical,
    derive_pqc_legacy,
    pqc_keypair_from_env,
    pqc_keypair_from_seed,
    resolve_pqc_keypair,
)
from .wallet import (
    NativeAccount,
    Signer,
    derive_native_account,
    generate_mnemonic,
    signer_from_env,
    signer_from_private_key,
    validate_mnemonic,
)

__all__ = [
    "NativeAccount",
    "Signer",
    "derive_native_account",
    "generate_mnemonic",
    "validate_mnemonic",
    "signer_from_private_key",
    "signer_from_env",
    "PqcKeypair",
    "PqcDerivation",
    "ResolvedPqcKeypair",
    "derive_pqc_canonical",
    "derive_pqc_legacy",
    "pqc_keypair_from_seed",
    "resolve_pqc_keypair",
    "pqc_keypair_from_env",
]
