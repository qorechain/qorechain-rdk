"""Network and module constants for the QoreChain ``rdk`` module.

The parameter values here are the network's documented defaults. They are NOT a
substitute for the live chain state: always read the authoritative values with
the ``rdk.params()`` query surface before acting on them.
"""

from __future__ import annotations

from typing import Final

#: Display denomination.
DISPLAY_DENOM: Final = "QOR"

#: Base denomination.
BASE_DENOM: Final = "uqor"

#: Base units per display unit (10^6).
DENOM_EXPONENT: Final = 6

#: Bech32 prefix for account addresses.
ACCOUNT_PREFIX: Final = "qor"

#: Bech32 prefix for validator addresses.
VALIDATOR_PREFIX: Final = "qorvaloper"

#: Named networks and their chain ids. The RDK defaults to testnet.
CHAIN_IDS: Final[dict[str, str]] = {
    "testnet": "qorechain-diana",
    "mainnet": "qorechain-vladi",
}

#: The valid network names.
NETWORK_NAMES: Final[tuple[str, ...]] = tuple(CHAIN_IDS.keys())

#: Documented defaults for the ``rdk`` module parameters. Read the live values
#: from the chain with ``rdk.params()``; treat these as reference only.
DEFAULT_RDK_PARAMS: Final[dict[str, object]] = {
    # Maximum number of registered rollups.
    "max_rollups": 100,
    # Minimum stake to create a rollup, in uqor (10,000 QOR).
    "min_stake_for_rollup": "10000000000",
    # Fraction of stake burned on creation, as a decimal string (1%).
    "rollup_creation_burn_rate": "0.01",
    # Default optimistic challenge window, in seconds (7 days).
    "default_challenge_window": 604800,
    # Maximum data-availability blob size, in bytes (2 MiB).
    "max_da_blob_size": 2097152,
    # Blocks before expired DA blobs are pruned (~30 days at 6s blocks).
    "blob_retention_blocks": 432000,
    # Maximum settlement batches accepted per block.
    "max_batches_per_block": 10,
}

#: Default optimistic challenge bond, in uqor (1,000 QOR).
DEFAULT_CHALLENGE_BOND_UQOR: Final = "1000000000"

__all__ = [
    "DISPLAY_DENOM",
    "BASE_DENOM",
    "DENOM_EXPONENT",
    "ACCOUNT_PREFIX",
    "VALIDATOR_PREFIX",
    "CHAIN_IDS",
    "NETWORK_NAMES",
    "DEFAULT_RDK_PARAMS",
    "DEFAULT_CHALLENGE_BOND_UQOR",
]
