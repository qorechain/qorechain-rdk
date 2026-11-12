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

#: Protocol switches of the chain v3.2.7 and v3.2.8 RDK features, as ``x/pqc``
#: reports them.
RDK_FEATURES: Final[dict[str, str]] = {
    "zk_verification_key": "rdk-zk-verification-key",
    "post_rollup_data": "rdk-post-rollup-data",
    "based_sequencing": "rdk-based-sequencing",
    "optimistic_reexec": "rdk-optimistic-reexec",
    "stark_statement": "rdk-stark-statement",
    "private_rollups": "rdk-private-rollups",
    "zk_canonical_inputs": "rdk-zk-canonical-inputs",
    "max_batches_per_block": "rdk-max-batches-per-block",
}

#: Posted-data retention (chain v3.2.8): default 648,000 blocks; a set value is
#: 100 to 25,920,000 blocks and at least the longest challenge window in
#: force, counted as one block per second.
DEFAULT_POSTED_DATA_RETENTION_BLOCKS: Final = 648_000
MIN_POSTED_DATA_RETENTION_BLOCKS: Final = 100
MAX_POSTED_DATA_RETENTION_BLOCKS: Final = 25_920_000

#: Smallest ``MsgDepositToRollup`` amount, in uqor (1 QOR).
MIN_ROLLUP_DEPOSIT_UQOR: Final = 1_000_000

#: Default ``min_submitter_bond``, in uqor (1,000 QOR); read the live value
#: from ``rdk.params()``.
DEFAULT_MIN_SUBMITTER_BOND_UQOR: Final = 1_000_000_000

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
    "RDK_FEATURES",
    "MIN_ROLLUP_DEPOSIT_UQOR",
    "DEFAULT_MIN_SUBMITTER_BOND_UQOR",
    "DEFAULT_POSTED_DATA_RETENTION_BLOCKS",
    "MIN_POSTED_DATA_RETENTION_BLOCKS",
    "MAX_POSTED_DATA_RETENTION_BLOCKS",
]
