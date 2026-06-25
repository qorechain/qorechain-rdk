/**
 * Typed, camelCase views of the `rdk` query responses, with mappers from the
 * REST/JSON-RPC payloads. Cosmos REST encodes 64-bit integers as strings;
 * amounts that can be large (stakes) are kept as strings, while small bounded
 * counters are parsed to numbers.
 */

/** A loosely-typed JSON object from the wire. */
export type RawRecord = Record<string, unknown>;

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
