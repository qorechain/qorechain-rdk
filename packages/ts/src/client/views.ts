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
  /** Chain v3.2.8+ (effective values; `undefined` from an older node). */
  finalizedBatchRetentionBlocks?: number;
  maxPostedDataBytes?: number;
  maxPostedDataBytesPerBlock?: number;
  postedDataFeePerByte?: number;
  postedDataRetentionBlocks?: number;
  /** Bond a qledger-v1 batch submitter must hold, in uqor (v3.2.8+). */
  minSubmitterBond?: string;
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
  /**
   * What the rollup still holds in the pooled module escrow, in uqor: what its
   * withdrawals can still pay and what stopping it refunds (chain v3.2.3+).
   * `0` from an older node.
   */
  escrowBalance: string;
  /**
   * The rollup's own challenge window in seconds, when the node exposes it.
   * `undefined` from a node that does not, in which case a caller must supply
   * it — the window is per rollup, so the global
   * `default_challenge_window` param is only a fallback.
   */
  challengeWindowSec?: number;
  /** The rollup's challenge bond in uqor, when the node exposes it (v3.2.4+). */
  challengeBond?: string;
  /** The rollup's proof system (e.g. `fraud`, `snark`), when exposed (v3.2.4+). */
  proofSystem?: string;
  /**
   * Whether the rollup has a ZK verification key registered (chain v3.2.7+,
   * `MsgSetVerificationKey`). `undefined` (field not served) means none: every
   * zk batch is then refused.
   */
  hasVerificationKey?: boolean;
  /** Chain v3.2.8+: `"based"` or `""` (the rollup's sequencer settles). */
  sequencing: string;
  /** Chain v3.2.8+: `"qledger-v1"` or `""`. */
  executionVm: string;
  /** Chain v3.2.8+: `"encapsulated"` or `""`. */
  privacy: string;
  /** Chain v3.2.8+: a private rollup's members, in envelope order. */
  members: string[];
  /** Chain v3.2.8+: the membership epoch an envelope must carry. */
  membersEpoch: number;
  /** Chain v3.2.8+: uqor deposited into a qledger-v1 rollup and not withdrawn. */
  depositPool: string;
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
  /**
   * The **block height** the batch was submitted at. Not a timestamp —
   * releases before 0.6.0 treated it as one, which broke every challenge
   * deadline the health monitor and watchtower computed.
   */
  submittedAt: number;
  finalizedAt: number;
  withdrawalsRoot: string;
  /**
   * Whether the chain judges this batch by the v2 transition binding (chain
   * v3.2.5, `rdk-withdrawals-binding`). Undefined when the node does not serve
   * the field; {@link transitionRootVersionForBatch} then decides by height.
   */
  withdrawalsBound?: boolean;
  /**
   * The block time (Unix seconds) of the submission block, for a batch
   * submitted under the chain's time-based challenge window (v3.2.4,
   * `rdk-challenge-window-time`). `0` for every batch before it, which keeps
   * the block-count window. Read when the node exposes it.
   */
  submittedTime: number;
  /** Chain v3.2.8+, based rollups: the inbox range the batch consumed (after `inboxStart`, up to `inboxEnd`). */
  inboxStart: number;
  inboxEnd: number;
  /**
   * Chain v3.2.8+: the stored `withdrawalsRoot` is the submitted root reduced
   * modulo the BLS12-381 scalar field (a Groth16 batch that binds its
   * withdrawals, settled with `rdk-zk-canonical-inputs` on). Compare a tree
   * root with it modulo r (`withdrawalsRootMatches`), not byte for byte.
   */
  withdrawalsRootReduced: boolean;
}

/** A rollup's inbox (chain v3.2.8+). Hex fields are as the node serves them. */
export interface InboxView {
  rollupId: string;
  sequencing: string;
  /** Sequence of the last post (0 = none yet). */
  headSequence: number;
  headAcc: string;
  /** Where the next based batch starts. */
  consumedSequence: number;
  consumedAcc: string;
  /** The range end `rangeDataHash` is for. */
  rangeEnd: number;
  /** The `data_hash` a based batch with `inbox_end = rangeEnd` must carry; empty when no longer retained. */
  rangeDataHash: string;
}

/** One posted-data commitment (chain v3.2.8+). */
export interface PostedDataView {
  rollupId: string;
  sequence: number;
  /** SHA-256 of the payload, hex. */
  dataHash: string;
  size: number;
  poster: string;
  /** The block whose transaction carries the payload. */
  height: number;
  inboxAcc: string;
  expiresAtHeight: number;
}

/** A key-encapsulation key an address published (`x/pqc`, chain v3.2.5+). */
export interface KemKeyView {
  address: string;
  algorithmId: number;
  algorithmName: string;
  /** The FIPS 203 encapsulation key, lowercase hex. */
  publicKey: string;
  registeredHeight: number;
}

export function mapKemKeyView(raw: RawRecord): KemKeyView {
  return {
    address: str(pick(raw, "address")),
    algorithmId: num(pick(raw, "algorithm_id", "algorithmId")),
    algorithmName: str(pick(raw, "algorithm_name", "algorithmName")),
    publicKey: hexBytes(pick(raw, "public_key", "publicKey")),
    registeredHeight: num(pick(raw, "registered_height", "registeredHeight")),
  };
}

/** A submitter's bond on a qledger-v1 rollup (chain v3.2.8+). */
export interface SubmitterBondView {
  /** uqor; `"0"` when there is none. */
  amount: string;
  lastSubmitTime: number;
  /** Block time (Unix seconds) from which an unbond succeeds. */
  unbondAfter: number;
  /** The submitter's batches on the rollup still waiting for finality (chain v3.2.8+; at most 1,024). */
  pending: number;
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
    finalizedBatchRetentionBlocks: optNum(raw, "finalized_batch_retention_blocks", "finalizedBatchRetentionBlocks"),
    maxPostedDataBytes: optNum(raw, "max_posted_data_bytes", "maxPostedDataBytes"),
    maxPostedDataBytesPerBlock: optNum(raw, "max_posted_data_bytes_per_block", "maxPostedDataBytesPerBlock"),
    postedDataFeePerByte: optNum(raw, "posted_data_fee_per_byte", "postedDataFeePerByte"),
    postedDataRetentionBlocks: optNum(raw, "posted_data_retention_blocks", "postedDataRetentionBlocks"),
    minSubmitterBond: (() => {
      const v = pick(raw, "min_submitter_bond", "minSubmitterBond");
      return v === undefined || v === null || v === "" ? undefined : String(v);
    })(),
  };
}

function optNum(raw: RawRecord, snake: string, camel: string): number | undefined {
  const v = pick(raw, snake, camel);
  return v === undefined || v === null || v === "" ? undefined : num(v);
}

export function mapInboxView(raw: RawRecord): InboxView {
  return {
    rollupId: str(pick(raw, "rollup_id", "rollupId")),
    sequencing: str(pick(raw, "sequencing")),
    headSequence: num(pick(raw, "head_sequence", "headSequence")),
    headAcc: str(pick(raw, "head_acc", "headAcc")),
    consumedSequence: num(pick(raw, "consumed_sequence", "consumedSequence")),
    consumedAcc: str(pick(raw, "consumed_acc", "consumedAcc")),
    rangeEnd: num(pick(raw, "range_end", "rangeEnd")),
    rangeDataHash: str(pick(raw, "range_data_hash", "rangeDataHash")),
  };
}

export function mapPostedDataView(raw: RawRecord): PostedDataView {
  return {
    rollupId: str(pick(raw, "rollup_id", "rollupId")),
    sequence: num(pick(raw, "sequence")),
    dataHash: str(pick(raw, "data_hash", "dataHash")),
    size: num(pick(raw, "size")),
    poster: str(pick(raw, "poster")),
    height: num(pick(raw, "height")),
    inboxAcc: str(pick(raw, "inbox_acc", "inboxAcc")),
    expiresAtHeight: num(pick(raw, "expires_at_height", "expiresAtHeight")),
  };
}

export function mapSubmitterBondView(raw: RawRecord): SubmitterBondView {
  return {
    amount: str(pick(raw, "amount"), "0"),
    lastSubmitTime: num(pick(raw, "last_submit_time", "lastSubmitTime")),
    unbondAfter: num(pick(raw, "unbond_after", "unbondAfter")),
    pending: num(pick(raw, "pending")),
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
    escrowBalance: str(pick(raw, "escrow_balance", "escrowBalance"), "0"),
    challengeWindowSec: (() => {
      const v = pick(raw, "challenge_window_sec", "challengeWindowSec");
      return v === undefined || v === null || v === "" ? undefined : num(v);
    })(),
    challengeBond: (() => {
      const v = pick(raw, "challenge_bond", "challengeBond");
      return v === undefined || v === null || v === "" ? undefined : String(v);
    })(),
    proofSystem: (() => {
      const v = pick(raw, "proof_system", "proofSystem");
      return v === undefined || v === null || v === "" ? undefined : String(v);
    })(),
    hasVerificationKey: pick(raw, "has_verification_key", "hasVerificationKey") === true ? true : undefined,
    sequencing: str(pick(raw, "sequencing")),
    executionVm: str(pick(raw, "execution_vm", "executionVm")),
    privacy: str(pick(raw, "privacy")),
    members: (() => {
      const v = pick(raw, "members");
      return Array.isArray(v) ? v.map(String) : [];
    })(),
    membersEpoch: num(pick(raw, "members_epoch", "membersEpoch")),
    depositPool: str(pick(raw, "deposit_pool", "depositPool"), "0"),
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
    withdrawalsBound: pick(raw, "withdrawals_bound", "withdrawalsBound") === true ? true : undefined,
    submittedTime: num(pick(raw, "submitted_time", "submittedTime")),
    inboxStart: num(pick(raw, "inbox_start", "inboxStart")),
    inboxEnd: num(pick(raw, "inbox_end", "inboxEnd")),
    withdrawalsRootReduced: pick(raw, "withdrawals_root_reduced", "withdrawalsRootReduced") === true,
  };
}
