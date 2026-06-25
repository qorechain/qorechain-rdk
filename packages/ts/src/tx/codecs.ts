/**
 * Hand-written protobuf codecs for the `qorechain.rdk.v1` transaction messages.
 *
 * These mirror the on-chain `rdk` module's `tx.proto` exactly — field numbers,
 * wire types, and message names — and follow the `cosmjs-types` generated-code
 * shape (`encode` / `decode` / `fromPartial`) so they register directly with a
 * `@cosmjs` `Registry`. 64-bit integers are represented as `bigint`, and `bytes`
 * fields as `Uint8Array`.
 */
import { BinaryReader, BinaryWriter } from "cosmjs-types/binary";

const TYPE_URL_PREFIX = "/qorechain.rdk.v1.";

export interface MsgCreateRollup {
  creator: string;
  rollupId: string;
  profile: string;
  vmType: string;
  stakeAmount: bigint;
}
export interface MsgCreateRollupResponse {
  rollupId: string;
}
export interface MsgSubmitBatch {
  sequencer: string;
  rollupId: string;
  batchIndex: bigint;
  stateRoot: Uint8Array;
  prevStateRoot: Uint8Array;
  txCount: bigint;
  dataHash: Uint8Array;
  proof: Uint8Array;
  withdrawalsRoot: Uint8Array;
}
export interface MsgChallengeBatch {
  challenger: string;
  rollupId: string;
  batchIndex: bigint;
  proof: Uint8Array;
}
export interface MsgResolveChallenge {
  resolver: string;
  rollupId: string;
  batchIndex: bigint;
  fraudUpheld: boolean;
}
export interface MsgPauseRollup {
  creator: string;
  rollupId: string;
  reason: string;
}
export interface MsgResumeRollup {
  creator: string;
  rollupId: string;
}
export interface MsgStopRollup {
  creator: string;
  rollupId: string;
}
export interface MsgExecuteWithdrawal {
  submitter: string;
  rollupId: string;
  batchIndex: bigint;
  withdrawalIndex: bigint;
  recipient: string;
  denom: string;
  amount: bigint;
  proof: Uint8Array[];
}

export const MsgCreateRollup = {
  typeUrl: `${TYPE_URL_PREFIX}MsgCreateRollup`,
  encode(message: MsgCreateRollup, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.creator !== "") writer.uint32(10).string(message.creator);
    if (message.rollupId !== "") writer.uint32(18).string(message.rollupId);
    if (message.profile !== "") writer.uint32(26).string(message.profile);
    if (message.vmType !== "") writer.uint32(34).string(message.vmType);
    if (message.stakeAmount !== 0n) writer.uint32(40).int64(message.stakeAmount);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgCreateRollup {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgCreateRollup = {
      creator: "",
      rollupId: "",
      profile: "",
      vmType: "",
      stakeAmount: 0n,
    };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.rollupId = reader.string();
          break;
        case 3:
          message.profile = reader.string();
          break;
        case 4:
          message.vmType = reader.string();
          break;
        case 5:
          message.stakeAmount = reader.int64();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgCreateRollup>): MsgCreateRollup {
    return {
      creator: object.creator ?? "",
      rollupId: object.rollupId ?? "",
      profile: object.profile ?? "",
      vmType: object.vmType ?? "",
      stakeAmount: object.stakeAmount ?? 0n,
    };
  },
};

export const MsgCreateRollupResponse = {
  typeUrl: `${TYPE_URL_PREFIX}MsgCreateRollupResponse`,
  encode(
    message: MsgCreateRollupResponse,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.rollupId !== "") writer.uint32(10).string(message.rollupId);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgCreateRollupResponse {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgCreateRollupResponse = { rollupId: "" };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.rollupId = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgCreateRollupResponse>): MsgCreateRollupResponse {
    return { rollupId: object.rollupId ?? "" };
  },
};

export const MsgSubmitBatch = {
  typeUrl: `${TYPE_URL_PREFIX}MsgSubmitBatch`,
  encode(message: MsgSubmitBatch, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.sequencer !== "") writer.uint32(10).string(message.sequencer);
    if (message.rollupId !== "") writer.uint32(18).string(message.rollupId);
    if (message.batchIndex !== 0n) writer.uint32(24).uint64(message.batchIndex);
    if (message.stateRoot.length !== 0) writer.uint32(34).bytes(message.stateRoot);
    if (message.prevStateRoot.length !== 0) writer.uint32(42).bytes(message.prevStateRoot);
    if (message.txCount !== 0n) writer.uint32(48).uint64(message.txCount);
    if (message.dataHash.length !== 0) writer.uint32(58).bytes(message.dataHash);
    if (message.proof.length !== 0) writer.uint32(66).bytes(message.proof);
    if (message.withdrawalsRoot.length !== 0) writer.uint32(74).bytes(message.withdrawalsRoot);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgSubmitBatch {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgSubmitBatch = {
      sequencer: "",
      rollupId: "",
      batchIndex: 0n,
      stateRoot: new Uint8Array(),
      prevStateRoot: new Uint8Array(),
      txCount: 0n,
      dataHash: new Uint8Array(),
      proof: new Uint8Array(),
      withdrawalsRoot: new Uint8Array(),
    };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.sequencer = reader.string();
          break;
        case 2:
          message.rollupId = reader.string();
          break;
        case 3:
          message.batchIndex = reader.uint64();
          break;
        case 4:
          message.stateRoot = reader.bytes();
          break;
        case 5:
          message.prevStateRoot = reader.bytes();
          break;
        case 6:
          message.txCount = reader.uint64();
          break;
        case 7:
          message.dataHash = reader.bytes();
          break;
        case 8:
          message.proof = reader.bytes();
          break;
        case 9:
          message.withdrawalsRoot = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgSubmitBatch>): MsgSubmitBatch {
    return {
      sequencer: object.sequencer ?? "",
      rollupId: object.rollupId ?? "",
      batchIndex: object.batchIndex ?? 0n,
      stateRoot: object.stateRoot ?? new Uint8Array(),
      prevStateRoot: object.prevStateRoot ?? new Uint8Array(),
      txCount: object.txCount ?? 0n,
      dataHash: object.dataHash ?? new Uint8Array(),
      proof: object.proof ?? new Uint8Array(),
      withdrawalsRoot: object.withdrawalsRoot ?? new Uint8Array(),
    };
  },
};

export const MsgChallengeBatch = {
  typeUrl: `${TYPE_URL_PREFIX}MsgChallengeBatch`,
  encode(message: MsgChallengeBatch, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.challenger !== "") writer.uint32(10).string(message.challenger);
    if (message.rollupId !== "") writer.uint32(18).string(message.rollupId);
    if (message.batchIndex !== 0n) writer.uint32(24).uint64(message.batchIndex);
    if (message.proof.length !== 0) writer.uint32(34).bytes(message.proof);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgChallengeBatch {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgChallengeBatch = {
      challenger: "",
      rollupId: "",
      batchIndex: 0n,
      proof: new Uint8Array(),
    };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.challenger = reader.string();
          break;
        case 2:
          message.rollupId = reader.string();
          break;
        case 3:
          message.batchIndex = reader.uint64();
          break;
        case 4:
          message.proof = reader.bytes();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgChallengeBatch>): MsgChallengeBatch {
    return {
      challenger: object.challenger ?? "",
      rollupId: object.rollupId ?? "",
      batchIndex: object.batchIndex ?? 0n,
      proof: object.proof ?? new Uint8Array(),
    };
  },
};

export const MsgResolveChallenge = {
  typeUrl: `${TYPE_URL_PREFIX}MsgResolveChallenge`,
  encode(message: MsgResolveChallenge, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.resolver !== "") writer.uint32(10).string(message.resolver);
    if (message.rollupId !== "") writer.uint32(18).string(message.rollupId);
    if (message.batchIndex !== 0n) writer.uint32(24).uint64(message.batchIndex);
    if (message.fraudUpheld === true) writer.uint32(32).bool(message.fraudUpheld);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgResolveChallenge {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgResolveChallenge = {
      resolver: "",
      rollupId: "",
      batchIndex: 0n,
      fraudUpheld: false,
    };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.resolver = reader.string();
          break;
        case 2:
          message.rollupId = reader.string();
          break;
        case 3:
          message.batchIndex = reader.uint64();
          break;
        case 4:
          message.fraudUpheld = reader.bool();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgResolveChallenge>): MsgResolveChallenge {
    return {
      resolver: object.resolver ?? "",
      rollupId: object.rollupId ?? "",
      batchIndex: object.batchIndex ?? 0n,
      fraudUpheld: object.fraudUpheld ?? false,
    };
  },
};

export const MsgPauseRollup = {
  typeUrl: `${TYPE_URL_PREFIX}MsgPauseRollup`,
  encode(message: MsgPauseRollup, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.creator !== "") writer.uint32(10).string(message.creator);
    if (message.rollupId !== "") writer.uint32(18).string(message.rollupId);
    if (message.reason !== "") writer.uint32(26).string(message.reason);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgPauseRollup {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgPauseRollup = { creator: "", rollupId: "", reason: "" };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.rollupId = reader.string();
          break;
        case 3:
          message.reason = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgPauseRollup>): MsgPauseRollup {
    return {
      creator: object.creator ?? "",
      rollupId: object.rollupId ?? "",
      reason: object.reason ?? "",
    };
  },
};

export const MsgResumeRollup = {
  typeUrl: `${TYPE_URL_PREFIX}MsgResumeRollup`,
  encode(message: MsgResumeRollup, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.creator !== "") writer.uint32(10).string(message.creator);
    if (message.rollupId !== "") writer.uint32(18).string(message.rollupId);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgResumeRollup {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgResumeRollup = { creator: "", rollupId: "" };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.rollupId = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgResumeRollup>): MsgResumeRollup {
    return { creator: object.creator ?? "", rollupId: object.rollupId ?? "" };
  },
};

export const MsgStopRollup = {
  typeUrl: `${TYPE_URL_PREFIX}MsgStopRollup`,
  encode(message: MsgStopRollup, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
    if (message.creator !== "") writer.uint32(10).string(message.creator);
    if (message.rollupId !== "") writer.uint32(18).string(message.rollupId);
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgStopRollup {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgStopRollup = { creator: "", rollupId: "" };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.creator = reader.string();
          break;
        case 2:
          message.rollupId = reader.string();
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgStopRollup>): MsgStopRollup {
    return { creator: object.creator ?? "", rollupId: object.rollupId ?? "" };
  },
};

export const MsgExecuteWithdrawal = {
  typeUrl: `${TYPE_URL_PREFIX}MsgExecuteWithdrawal`,
  encode(
    message: MsgExecuteWithdrawal,
    writer: BinaryWriter = BinaryWriter.create(),
  ): BinaryWriter {
    if (message.submitter !== "") writer.uint32(10).string(message.submitter);
    if (message.rollupId !== "") writer.uint32(18).string(message.rollupId);
    if (message.batchIndex !== 0n) writer.uint32(24).uint64(message.batchIndex);
    if (message.withdrawalIndex !== 0n) writer.uint32(32).uint64(message.withdrawalIndex);
    if (message.recipient !== "") writer.uint32(42).string(message.recipient);
    if (message.denom !== "") writer.uint32(50).string(message.denom);
    if (message.amount !== 0n) writer.uint32(56).int64(message.amount);
    for (const v of message.proof) {
      writer.uint32(66).bytes(v);
    }
    return writer;
  },
  decode(input: BinaryReader | Uint8Array, length?: number): MsgExecuteWithdrawal {
    const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
    const end = length === undefined ? reader.len : reader.pos + length;
    const message: MsgExecuteWithdrawal = {
      submitter: "",
      rollupId: "",
      batchIndex: 0n,
      withdrawalIndex: 0n,
      recipient: "",
      denom: "",
      amount: 0n,
      proof: [],
    };
    while (reader.pos < end) {
      const tag = reader.uint32();
      switch (tag >>> 3) {
        case 1:
          message.submitter = reader.string();
          break;
        case 2:
          message.rollupId = reader.string();
          break;
        case 3:
          message.batchIndex = reader.uint64();
          break;
        case 4:
          message.withdrawalIndex = reader.uint64();
          break;
        case 5:
          message.recipient = reader.string();
          break;
        case 6:
          message.denom = reader.string();
          break;
        case 7:
          message.amount = reader.int64();
          break;
        case 8:
          message.proof.push(reader.bytes());
          break;
        default:
          reader.skipType(tag & 7);
          break;
      }
    }
    return message;
  },
  fromPartial(object: Partial<MsgExecuteWithdrawal>): MsgExecuteWithdrawal {
    return {
      submitter: object.submitter ?? "",
      rollupId: object.rollupId ?? "",
      batchIndex: object.batchIndex ?? 0n,
      withdrawalIndex: object.withdrawalIndex ?? 0n,
      recipient: object.recipient ?? "",
      denom: object.denom ?? "",
      amount: object.amount ?? 0n,
      proof: object.proof ?? [],
    };
  },
};
