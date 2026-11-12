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
  /** Chain v3.2.7+: register the zk verification key at creation (see `setVerificationKeyMsg`). */
  verificationKey?: Bytes;
  /**
   * Chain v3.2.8+: `"based"` orders the rollup's transactions by their
   * inclusion on the chain (anyone posts, every batch consumes the inbox).
   * Allowed for zk (snark), based settlement, and qledger-v1 optimistic rollups.
   */
  sequencing?: "" | "based";
  /**
   * Chain v3.2.8+: `"qledger-v1"`, the execution model the chain re-executes in
   * a fraud proof. **Required for every new optimistic rollup** (`nft`,
   * `custom`), together with `sequencing: "based"`.
   */
  executionVm?: "" | "qledger-v1";
  /** Chain v3.2.8+: `"encapsulated"` for a private rollup (zk with a Groth16 key only). */
  privacy?: "" | "encapsulated";
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
  /**
   * Chain v3.2.8+, based rollups only: the inbox sequence of the last post this
   * batch consumes. `dataHash` must then be the inbox range commitment
   * (`inboxRangeHash`, or `RestClient.getInbox(rollupId, inboxEnd)`).
   */
  inboxEnd?: Numeric;
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
      verificationKey: input.verificationKey ? toBytes(input.verificationKey) : EMPTY,
      sequencing: input.sequencing ?? "",
      executionVm: input.executionVm ?? "",
      privacy: input.privacy ?? "",
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
      inboxEnd: input.inboxEnd === undefined ? 0n : big(input.inboxEnd),
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

// --- chain v3.2.7+ -----------------------------------------------------------

export interface SetVerificationKeyInput {
  creator: string;
  rollupId: string;
  /** Groth16 BLS12-381 verifying key, gnark binary encoding, four public inputs. */
  verificationKey: Bytes;
  /** `"snark"`; empty keeps the rollup's proof system. `"stark"` is refused from v3.2.8. */
  proofSystem?: string;
}

export function setVerificationKeyMsg(input: SetVerificationKeyInput): EncodeObject {
  return {
    typeUrl: codecs.MsgSetVerificationKey.typeUrl,
    value: codecs.MsgSetVerificationKey.fromPartial({
      creator: input.creator,
      rollupId: input.rollupId,
      verificationKey: toBytes(input.verificationKey),
      proofSystem: input.proofSystem ?? "",
    }),
  };
}

/** Governance only: put this message in a proposal; `authority` is the gov module account. */
export function updateVerificationKeyMsg(input: {
  authority: string;
  rollupId: string;
  verificationKey: Bytes;
  proofSystem?: string;
}): EncodeObject {
  return {
    typeUrl: codecs.MsgUpdateVerificationKey.typeUrl,
    value: codecs.MsgUpdateVerificationKey.fromPartial({
      authority: input.authority,
      rollupId: input.rollupId,
      verificationKey: toBytes(input.verificationKey),
      proofSystem: input.proofSystem ?? "",
    }),
  };
}

// --- chain v3.2.8+ -----------------------------------------------------------

export function postRollupDataMsg(input: { poster: string; rollupId: string; data: Bytes }): EncodeObject {
  return {
    typeUrl: codecs.MsgPostRollupData.typeUrl,
    value: codecs.MsgPostRollupData.fromPartial({
      poster: input.poster,
      rollupId: input.rollupId,
      data: toBytes(input.data),
    }),
  };
}

/** Governance only: `sequencing` is `"based"` or `""`. */
export function setRollupSequencingMsg(input: {
  authority: string;
  rollupId: string;
  sequencing: "" | "based";
}): EncodeObject {
  return {
    typeUrl: codecs.MsgSetRollupSequencing.typeUrl,
    value: codecs.MsgSetRollupSequencing.fromPartial({
      authority: input.authority,
      rollupId: input.rollupId,
      sequencing: input.sequencing,
    }),
  };
}

export function depositToRollupMsg(input: {
  depositor: string;
  rollupId: string;
  /** The 32-byte qledger-v1 account id to credit. */
  account: Bytes;
  amount: Numeric;
}): EncodeObject {
  return {
    typeUrl: codecs.MsgDepositToRollup.typeUrl,
    value: codecs.MsgDepositToRollup.fromPartial({
      depositor: input.depositor,
      rollupId: input.rollupId,
      account: toBytes(input.account),
      amount: big(input.amount),
    }),
  };
}

export function bondRollupSubmitterMsg(input: {
  submitter: string;
  rollupId: string;
  amount: Numeric;
}): EncodeObject {
  return {
    typeUrl: codecs.MsgBondRollupSubmitter.typeUrl,
    value: codecs.MsgBondRollupSubmitter.fromPartial({
      submitter: input.submitter,
      rollupId: input.rollupId,
      amount: big(input.amount),
    }),
  };
}

export function unbondRollupSubmitterMsg(input: { submitter: string; rollupId: string }): EncodeObject {
  return {
    typeUrl: codecs.MsgUnbondRollupSubmitter.typeUrl,
    value: codecs.MsgUnbondRollupSubmitter.fromPartial({
      submitter: input.submitter,
      rollupId: input.rollupId,
    }),
  };
}

export function setRollupMembersMsg(input: { creator: string; rollupId: string; members: string[] }): EncodeObject {
  return {
    typeUrl: codecs.MsgSetRollupMembers.typeUrl,
    value: codecs.MsgSetRollupMembers.fromPartial({
      creator: input.creator,
      rollupId: input.rollupId,
      members: [...input.members],
    }),
  };
}

/** ML-KEM-1024's id in the chain's algorithm registry. */
export const ML_KEM_1024_ALGORITHM_ID = 2;

/** Publish an ML-KEM-1024 encapsulation key (1568 bytes) in the chain's KEM registry. */
export function registerKemKeyMsg(input: { sender: string; publicKey: Bytes; algorithmId?: number }): EncodeObject {
  return {
    typeUrl: codecs.MsgRegisterKEMKey.typeUrl,
    value: codecs.MsgRegisterKEMKey.fromPartial({
      sender: input.sender,
      algorithmId: input.algorithmId ?? ML_KEM_1024_ALGORITHM_ID,
      publicKey: toBytes(input.publicKey),
    }),
  };
}
