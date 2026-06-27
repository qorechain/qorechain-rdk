/**
 * Typed, camelCase views of the `rdk` query responses, with mappers from the
 * REST/JSON-RPC payloads. Cosmos REST encodes 64-bit integers as strings;
 * amounts that can be large (stakes) are kept as strings, while small bounded
 * counters are parsed to numbers.
 */

import { bytesToHex, decodeWireBytes } from "../utils/bytes";

/** A loosely-typed JSON object from the wire. */
export type RawRecord = Record<string, unknown>;

/** Normalize a wire bytes field (base64 or hex) to a lowercase hex string. */
function hexBytes(value: unknown): string {
  const s = str(value);
  return s === "" ? "" : bytesToHex(decodeWireBytes(s));
}

function pick(obj: RawRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function str(value: unknown, fallback = ""): string {
  return value === undefined || value === null ? fallback : String(value);
}

function num(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Module parameters. */
export interface ParamsView {
  maxRollups: number;
  minStakeForRollup: string;
  rollupCreationBurnRate: string;
  defaultChallengeWindow: number;
  maxDaBlobSize: number;
  blobRetentionBlocks: number;
  maxBatchesPerBlock: number;
}

/** A rollup's configuration and status. */
export interface RollupView {
  rollupId: string;
  creator: string;
  profile: string;
  settlementMode: string;
  daBackend: string;
  blockTimeMs: number;
  maxTxPerBlock: number;
  vmType: string;
  status: string;
  stakeAmount: string;
  layerId: string;
  createdHeight: number;
}

/** A settlement batch. */
export interface BatchView {
  rollupId: string;
  batchIndex: number;
  stateRoot: string;
  prevStateRoot: string;
  txCount: number;
  dataHash: string;
  proofType: string;
  status: string;
  submittedAt: number;
  finalizedAt: number;
  withdrawalsRoot: string;
}

/**
 * A subsidiary-layer state anchor committed to the Main Chain (the
 * `x/multilayer` `StateAnchorView`). Byte fields are normalized to lowercase
 * hex. The PQC (Dilithium-5) signature covers the canonical message
 * `layer_id || layer_height(8B BE) || state_root || validator_set_hash`,
 * signed by the layer creator's registered post-quantum key.
 */
export interface AnchorView {
  layerId: string;
  layerHeight: number;
  stateRoot: string;
  validatorSetHash: string;
  mainChainHeight: number;
  anchoredAt: number;
  pqcSignature: string;
  transactionCount: number;
  compressedStateProof: string;
}

/** A post-quantum account view (the `x/pqc` `PQCAccountView`). */
export interface PqcAccountView {
  address: string;
  publicKey: string;
  algorithmId: number;
  algorithmName: string;
  ecdsaPubkey: string;
}

export function mapAnchorView(raw: RawRecord): AnchorView {
  return {
    layerId: str(pick(raw, "layer_id", "layerId")),
    layerHeight: num(pick(raw, "layer_height", "layerHeight")),
    stateRoot: hexBytes(pick(raw, "state_root", "stateRoot")),
    validatorSetHash: hexBytes(pick(raw, "validator_set_hash", "validatorSetHash")),
    mainChainHeight: num(pick(raw, "main_chain_height", "mainChainHeight")),
    anchoredAt: num(pick(raw, "anchored_at", "anchoredAt")),
    pqcSignature: hexBytes(pick(raw, "pqc_aggregate_signature", "pqcAggregateSignature")),
    transactionCount: num(pick(raw, "transaction_count", "transactionCount")),
    compressedStateProof: hexBytes(pick(raw, "compressed_state_proof", "compressedStateProof")),
  };
}

export function mapPqcAccountView(raw: RawRecord): PqcAccountView {
  return {
    address: str(pick(raw, "address")),
    publicKey: hexBytes(pick(raw, "public_key", "publicKey")),
    algorithmId: num(pick(raw, "algorithm_id", "algorithmId")),
    algorithmName: str(pick(raw, "algorithm_name", "algorithmName")),
    ecdsaPubkey: hexBytes(pick(raw, "ecdsa_pubkey", "ecdsaPubkey")),
  };
}

export function mapParamsView(raw: RawRecord): ParamsView {
  return {
    maxRollups: num(pick(raw, "max_rollups", "maxRollups")),
    minStakeForRollup: str(pick(raw, "min_stake_for_rollup", "minStakeForRollup"), "0"),
    rollupCreationBurnRate: str(pick(raw, "rollup_creation_burn_rate", "rollupCreationBurnRate"), "0"),
    defaultChallengeWindow: num(pick(raw, "default_challenge_window", "defaultChallengeWindow")),
    maxDaBlobSize: num(pick(raw, "max_da_blob_size", "maxDaBlobSize")),
    blobRetentionBlocks: num(pick(raw, "blob_retention_blocks", "blobRetentionBlocks")),
    maxBatchesPerBlock: num(pick(raw, "max_batches_per_block", "maxBatchesPerBlock")),
  };
}

export function mapRollupView(raw: RawRecord): RollupView {
  return {
    rollupId: str(pick(raw, "rollup_id", "rollupId")),
    creator: str(pick(raw, "creator")),
    profile: str(pick(raw, "profile")),
    settlementMode: str(pick(raw, "settlement_mode", "settlementMode")),
    daBackend: str(pick(raw, "da_backend", "daBackend")),
    blockTimeMs: num(pick(raw, "block_time_ms", "blockTimeMs")),
    maxTxPerBlock: num(pick(raw, "max_tx_per_block", "maxTxPerBlock")),
    vmType: str(pick(raw, "vm_type", "vmType")),
    status: str(pick(raw, "status")),
    stakeAmount: str(pick(raw, "stake_amount", "stakeAmount"), "0"),
    layerId: str(pick(raw, "layer_id", "layerId")),
    createdHeight: num(pick(raw, "created_height", "createdHeight")),
  };
}

export function mapBatchView(raw: RawRecord): BatchView {
  return {
    rollupId: str(pick(raw, "rollup_id", "rollupId")),
    batchIndex: num(pick(raw, "batch_index", "batchIndex")),
    stateRoot: str(pick(raw, "state_root", "stateRoot")),
    prevStateRoot: str(pick(raw, "prev_state_root", "prevStateRoot")),
    txCount: num(pick(raw, "tx_count", "txCount")),
    dataHash: str(pick(raw, "data_hash", "dataHash")),
    proofType: str(pick(raw, "proof_type", "proofType")),
    status: str(pick(raw, "status")),
    submittedAt: num(pick(raw, "submitted_at", "submittedAt")),
    finalizedAt: num(pick(raw, "finalized_at", "finalizedAt")),
    withdrawalsRoot: str(pick(raw, "withdrawals_root", "withdrawalsRoot")),
  };
}
