/**
 * Friendly builders that turn RDK-shaped inputs into `@cosmjs` `EncodeObject`s
 * ready to sign and broadcast. Numeric 64-bit fields accept `string | number |
 * bigint`; byte fields accept a hex string (with or without `0x`) or a
 * `Uint8Array`.
 */
import type { EncodeObject } from "@cosmjs/proto-signing";
import * as codecs from "./codecs";
import { toBytes } from "../utils/bytes";
import { vmTypeWireValue } from "../config/enums";

type Numeric = string | number | bigint;
type Bytes = string | Uint8Array;

function big(value: Numeric): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export interface CreateRollupInput {
  creator: string;
  rollupId: string;
  profile: string;
  vmType: string;
  stakeAmount: Numeric;
}

export interface SubmitBatchInput {
  sequencer: string;
  rollupId: string;
  batchIndex: Numeric;
  stateRoot: Bytes;
  prevStateRoot?: Bytes;
  txCount: Numeric;
  /**
   * Commitment to the batch's off-chain data. Leave it empty on a `native` or
   * `both` DA rollup: no transaction stores a DA blob on chain, so the chain
   * refuses a batch whose `data_hash` claims one (see `dataHashError`).
   */
  dataHash?: Bytes;
  proof?: Bytes;
  withdrawalsRoot?: Bytes;
  /**
   * The rollup creator's ML-DSA-87 signature over this batch's v2 anchor sign
   * bytes (see `anchorSignBytesForBatch`). With it the chain anchors the batch
   * in the same transaction, which is what makes a settlement receipt possible.
   * `RdkTxClient.submitBatch` produces it for you when it signs hybrid.
   */
  anchorSignature?: Bytes;
  /** The validator-set commitment covered by `anchorSignature`. */
  validatorSetHash?: Bytes;
}

export interface ChallengeBatchInput {
  challenger: string;
  rollupId: string;
  batchIndex: Numeric;
  proof: Bytes;
}

export interface ResolveChallengeInput {
  resolver: string;
  rollupId: string;
  batchIndex: Numeric;
  fraudUpheld: boolean;
}

export interface PauseRollupInput {
  creator: string;
  rollupId: string;
  reason?: string;
}

export interface RollupRefInput {
  creator: string;
  rollupId: string;
}

export interface ExecuteWithdrawalInput {
  submitter: string;
  rollupId: string;
  batchIndex: Numeric;
  withdrawalIndex: Numeric;
  recipient: string;
  denom: string;
  amount: Numeric;
  proof?: Bytes[];
}

const EMPTY = new Uint8Array();

export function createRollupMsg(input: CreateRollupInput): EncodeObject {
  return {
    typeUrl: codecs.MsgCreateRollup.typeUrl,
    value: codecs.MsgCreateRollup.fromPartial({
      creator: input.creator,
      rollupId: input.rollupId,
      profile: input.profile,
      vmType: vmTypeWireValue(input.vmType),
      stakeAmount: big(input.stakeAmount),
    }),
  };
}

export function submitBatchMsg(input: SubmitBatchInput): EncodeObject {
  return {
    typeUrl: codecs.MsgSubmitBatch.typeUrl,
    value: codecs.MsgSubmitBatch.fromPartial({
      sequencer: input.sequencer,
      rollupId: input.rollupId,
      batchIndex: big(input.batchIndex),
      stateRoot: toBytes(input.stateRoot),
      prevStateRoot: input.prevStateRoot ? toBytes(input.prevStateRoot) : EMPTY,
      txCount: big(input.txCount),
      dataHash: input.dataHash ? toBytes(input.dataHash) : EMPTY,
      proof: input.proof ? toBytes(input.proof) : EMPTY,
      withdrawalsRoot: input.withdrawalsRoot ? toBytes(input.withdrawalsRoot) : EMPTY,
      anchorSignature: input.anchorSignature ? toBytes(input.anchorSignature) : EMPTY,
      validatorSetHash: input.validatorSetHash ? toBytes(input.validatorSetHash) : EMPTY,
    }),
  };
}

export function challengeBatchMsg(input: ChallengeBatchInput): EncodeObject {
  return {
    typeUrl: codecs.MsgChallengeBatch.typeUrl,
    value: codecs.MsgChallengeBatch.fromPartial({
      challenger: input.challenger,
      rollupId: input.rollupId,
      batchIndex: big(input.batchIndex),
      proof: toBytes(input.proof),
    }),
  };
}

export function resolveChallengeMsg(input: ResolveChallengeInput): EncodeObject {
  return {
    typeUrl: codecs.MsgResolveChallenge.typeUrl,
    value: codecs.MsgResolveChallenge.fromPartial({
      resolver: input.resolver,
      rollupId: input.rollupId,
      batchIndex: big(input.batchIndex),
      fraudUpheld: input.fraudUpheld,
    }),
  };
}

export function pauseRollupMsg(input: PauseRollupInput): EncodeObject {
  return {
    typeUrl: codecs.MsgPauseRollup.typeUrl,
    value: codecs.MsgPauseRollup.fromPartial({
      creator: input.creator,
      rollupId: input.rollupId,
      reason: input.reason ?? "",
    }),
  };
}

export function resumeRollupMsg(input: RollupRefInput): EncodeObject {
  return {
    typeUrl: codecs.MsgResumeRollup.typeUrl,
    value: codecs.MsgResumeRollup.fromPartial({
      creator: input.creator,
      rollupId: input.rollupId,
    }),
  };
}

export function stopRollupMsg(input: RollupRefInput): EncodeObject {
  return {
    typeUrl: codecs.MsgStopRollup.typeUrl,
    value: codecs.MsgStopRollup.fromPartial({
      creator: input.creator,
      rollupId: input.rollupId,
    }),
  };
}

export function executeWithdrawalMsg(input: ExecuteWithdrawalInput): EncodeObject {
  return {
    typeUrl: codecs.MsgExecuteWithdrawal.typeUrl,
    value: codecs.MsgExecuteWithdrawal.fromPartial({
      submitter: input.submitter,
      rollupId: input.rollupId,
      batchIndex: big(input.batchIndex),
      withdrawalIndex: big(input.withdrawalIndex),
      recipient: input.recipient,
      denom: input.denom,
      amount: big(input.amount),
      proof: (input.proof ?? []).map(toBytes),
    }),
  };
}
