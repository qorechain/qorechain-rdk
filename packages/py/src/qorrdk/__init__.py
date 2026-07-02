"""Python Rollup Development Kit for the QoreChain network.

The Rollup Development Kit drives the on-chain ``rdk`` module: rollup
configuration and creation, the rollup and settlement-batch lifecycles, native
data availability, transaction signing and broadcast, and the read surface (REST
and the ``qor_`` JSON-RPC namespace), plus a QCAI-assisted profile recommendation.

This mirrors the TypeScript RDK (``@qorechain/rdk``) with idiomatic, snake_case
Python. Live broadcast requires a reachable node endpoint; everything else
(config, presets, economics, Merkle proofs, manifests, message encoding, and
account derivation) works fully offline.
"""

from __future__ import annotations

__version__ = "0.4.1"

# Constants.
from .constants import (  # noqa: E402
    ACCOUNT_PREFIX,
    BASE_DENOM,
    CHAIN_IDS,
    DEFAULT_CHALLENGE_BOND_UQOR,
    DEFAULT_RDK_PARAMS,
    DENOM_EXPONENT,
    DISPLAY_DENOM,
    NETWORK_NAMES,
    VALIDATOR_PREFIX,
)

# Enums.
from .enums import (  # noqa: E402
    BATCH_STATUSES,
    DA_BACKENDS,
    GAS_MODELS,
    PROFILE_NAMES,
    PROOF_SYSTEMS,
    ROLLUP_STATUSES,
    SEQUENCER_MODES,
    SETTLEMENT_PARADIGMS,
    VM_TYPES,
    BatchStatus,
    DABackend,
    GasModel,
    ProfileName,
    ProofSystem,
    RollupStatus,
    SequencerMode,
    SettlementParadigm,
    VmType,
)

# Configuration: types, networks, matrix, validation, builder.
from .config import (  # noqa: E402
    NETWORKS,
    CreateRollupMsgInput,
    Endpoints,
    NetworkConfig,
    RollupConfig,
    RollupConfigBuilder,
    RollupConfigError,
    SequencerParams,
    SETTLEMENT_PROOF_MATRIX,
    ValidationResult,
    assert_valid_rollup_config,
    get_network,
    is_proof_compatible,
    list_networks,
    requires_based_sequencer,
    valid_proof_systems,
    validate_rollup_config,
)

# Preset profiles.
from .presets import PRESET_DEFAULTS, presets  # noqa: E402

# Utilities.
from .utils import (  # noqa: E402
    CreationCost,
    base64_to_bytes,
    bech32_prefix,
    bech32_to_hex,
    bytes_to_base64,
    bytes_to_hex,
    decode_wire_bytes,
    estimate_creation_cost,
    hex_to_bech32,
    hex_to_bytes,
    mul_decimal_floor,
    qor_to_uqor,
    to_bytes,
    uqor_to_qor,
)

# Lifecycle.
from .lifecycle import (  # noqa: E402
    BATCH_TRANSITIONS,
    ROLLUP_ACTION_FROM,
    assert_rollup_action,
    can_perform_rollup_action,
    challenge_window_deadline,
    is_batch_final,
    is_challenge_window_closed,
)

# Data availability.
from .da import (  # noqa: E402
    DA_CELESTIA_UNAVAILABLE_MESSAGE,
    DaBlob,
    assert_da_backend_available,
    build_da_blob,
    is_da_backend_available,
)

# Bridge.
from .bridge import (  # noqa: E402
    MerkleOptions,
    MerkleProof,
    WithdrawalProof,
    assemble_withdrawal_proof,
    binary_merkle_proof,
    binary_merkle_root,
    build_execute_withdrawal_input,
    verify_binary_merkle_proof,
)

# Manifest.
from .manifest import (  # noqa: E402
    MANIFEST_SCHEMA,
    RollupManifest,
    from_manifest,
    manifest_from_dict,
    manifest_to_dict,
    parse_manifest,
    stringify_manifest,
    to_manifest,
)

# Events.
from .events import (  # noqa: E402
    RDK_EVENT_TYPES,
    DecodedRdkEvent,
    RawEvent,
    decode_rdk_events,
    find_rdk_event,
)

# Transactions.
from .tx import (  # noqa: E402
    BroadcastResult,
    ChallengeBatchInput,
    CreateRollupInput,
    EncodedMsg,
    ExecuteWithdrawalInput,
    MockCall,
    MockTxClient,
    PauseRollupInput,
    RdkTxClient,
    ResolveChallengeInput,
    RollupRefInput,
    SignAndBroadcastBackend,
    SubmitBatchInput,
    TxOptions,
    challenge_batch_msg,
    create_rollup_msg,
    execute_withdrawal_msg,
    pause_rollup_msg,
    resolve_challenge_msg,
    resume_rollup_msg,
    stop_rollup_msg,
    submit_batch_msg,
)

# Accounts & signing.
from .accounts import (  # noqa: E402
    NativeAccount,
    Signer,
    derive_native_account,
    generate_mnemonic,
    signer_from_env,
    signer_from_private_key,
    validate_mnemonic,
)

# Read clients & facade.
from .client import (  # noqa: E402
    AnchorView,
    BatchView,
    HttpResponse,
    ParamsView,
    PqcAccountView,
    QorClient,
    RdkClient,
    RestClient,
    RollupView,
    Transport,
    create_rdk_client,
    default_transport,
    map_anchor_view,
    map_batch_view,
    map_params_view,
    map_pqc_account_view,
    map_rollup_view,
)

# Settlement receipts.
from .receipts import (  # noqa: E402
    RECEIPT_ALGORITHM,
    RECEIPT_VERSION,
    ReceiptChecks,
    ReceiptVerification,
    SettlementReceipt,
    anchor_sign_bytes,
    build_settlement_receipt,
    verify_settlement_receipt,
)

# QCAI rollup copilot.
from .copilot import (  # noqa: E402
    CopilotSuggestion,
    RollupAdvice,
    get_rollup_advice,
)

# Profile suggestion.
from .profiles import ProfileSuggestion, suggest_profile  # noqa: E402

# Preflight, health, faucet.
from .preflight import PreflightCheck, PreflightResult, check_preflight  # noqa: E402
from .health import RollupHealth, get_rollup_health  # noqa: E402
from .faucet import FaucetResult, request_faucet  # noqa: E402

# Live monitoring.
from .monitor import Watcher, events_from_tx_hash, watch_rollup  # noqa: E402

__all__ = [
    "__version__",
    # constants
    "DISPLAY_DENOM",
    "BASE_DENOM",
    "DENOM_EXPONENT",
    "ACCOUNT_PREFIX",
    "VALIDATOR_PREFIX",
    "CHAIN_IDS",
    "NETWORK_NAMES",
    "DEFAULT_RDK_PARAMS",
    "DEFAULT_CHALLENGE_BOND_UQOR",
    # enums
    "SettlementParadigm",
    "SequencerMode",
    "ProofSystem",
    "DABackend",
    "GasModel",
    "VmType",
    "RollupStatus",
    "BatchStatus",
    "ProfileName",
    "SETTLEMENT_PARADIGMS",
    "SEQUENCER_MODES",
    "PROOF_SYSTEMS",
    "DA_BACKENDS",
    "GAS_MODELS",
    "VM_TYPES",
    "ROLLUP_STATUSES",
    "BATCH_STATUSES",
    "PROFILE_NAMES",
    # config
    "RollupConfig",
    "SequencerParams",
    "CreateRollupMsgInput",
    "RollupConfigBuilder",
    "RollupConfigError",
    "ValidationResult",
    "validate_rollup_config",
    "assert_valid_rollup_config",
    "SETTLEMENT_PROOF_MATRIX",
    "valid_proof_systems",
    "is_proof_compatible",
    "requires_based_sequencer",
    "Endpoints",
    "NetworkConfig",
    "NETWORKS",
    "get_network",
    "list_networks",
    # presets
    "PRESET_DEFAULTS",
    "presets",
    # utils
    "qor_to_uqor",
    "uqor_to_qor",
    "mul_decimal_floor",
    "estimate_creation_cost",
    "CreationCost",
    "bech32_to_hex",
    "hex_to_bech32",
    "bech32_prefix",
    "bytes_to_hex",
    "hex_to_bytes",
    "to_bytes",
    "base64_to_bytes",
    "bytes_to_base64",
    "decode_wire_bytes",
    # lifecycle
    "ROLLUP_ACTION_FROM",
    "can_perform_rollup_action",
    "assert_rollup_action",
    "BATCH_TRANSITIONS",
    "is_batch_final",
    "challenge_window_deadline",
    "is_challenge_window_closed",
    # da
    "DA_CELESTIA_UNAVAILABLE_MESSAGE",
    "DaBlob",
    "build_da_blob",
    "is_da_backend_available",
    "assert_da_backend_available",
    # bridge
    "MerkleOptions",
    "MerkleProof",
    "binary_merkle_root",
    "binary_merkle_proof",
    "verify_binary_merkle_proof",
    "WithdrawalProof",
    "assemble_withdrawal_proof",
    "build_execute_withdrawal_input",
    # manifest
    "MANIFEST_SCHEMA",
    "RollupManifest",
    "to_manifest",
    "from_manifest",
    "manifest_to_dict",
    "manifest_from_dict",
    "stringify_manifest",
    "parse_manifest",
    # events
    "RDK_EVENT_TYPES",
    "RawEvent",
    "DecodedRdkEvent",
    "decode_rdk_events",
    "find_rdk_event",
    # tx
    "EncodedMsg",
    "CreateRollupInput",
    "SubmitBatchInput",
    "ChallengeBatchInput",
    "ResolveChallengeInput",
    "PauseRollupInput",
    "RollupRefInput",
    "ExecuteWithdrawalInput",
    "create_rollup_msg",
    "submit_batch_msg",
    "challenge_batch_msg",
    "resolve_challenge_msg",
    "pause_rollup_msg",
    "resume_rollup_msg",
    "stop_rollup_msg",
    "execute_withdrawal_msg",
    "RdkTxClient",
    "TxOptions",
    "BroadcastResult",
    "SignAndBroadcastBackend",
    "MockTxClient",
    "MockCall",
    # accounts
    "NativeAccount",
    "Signer",
    "derive_native_account",
    "generate_mnemonic",
    "validate_mnemonic",
    "signer_from_private_key",
    "signer_from_env",
    # clients
    "Transport",
    "HttpResponse",
    "default_transport",
    "RestClient",
    "QorClient",
    "RdkClient",
    "create_rdk_client",
    "ParamsView",
    "RollupView",
    "BatchView",
    "AnchorView",
    "PqcAccountView",
    "map_params_view",
    "map_rollup_view",
    "map_batch_view",
    "map_anchor_view",
    "map_pqc_account_view",
    # receipts
    "RECEIPT_ALGORITHM",
    "RECEIPT_VERSION",
    "SettlementReceipt",
    "ReceiptChecks",
    "ReceiptVerification",
    "anchor_sign_bytes",
    "build_settlement_receipt",
    "verify_settlement_receipt",
    # copilot
    "CopilotSuggestion",
    "RollupAdvice",
    "get_rollup_advice",
    # profiles
    "ProfileSuggestion",
    "suggest_profile",
    # preflight / health / faucet
    "PreflightCheck",
    "PreflightResult",
    "check_preflight",
    "RollupHealth",
    "get_rollup_health",
    "FaucetResult",
    "request_faucet",
    # monitor
    "Watcher",
    "events_from_tx_hash",
    "watch_rollup",
]
