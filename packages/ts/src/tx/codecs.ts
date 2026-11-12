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
  /**
   * Field 6 (chain v3.2.7+): the rollup's ZK verification key, registered at
   * creation, in the encoding `MsgSetVerificationKey` takes. Empty: none.
   */
  verificationKey: Uint8Array;
  /**
   * Field 7 (chain v3.2.8+): `""` (the rollup's sequencer settles) or
   * `"based"` (transactions are ordered by their inclusion on the chain, every
   * batch consumes the inbox in order). zk (snark), based settlement, and
   * qledger-v1 optimistic rollups only.
   */
  sequencing: string;
  /** Field 8 (chain v3.2.8+): `""` or `"qledger-v1"` (optimistic, must be based). */
  executionVm: string;
  /** Field 9 (chain v3.2.8+): `""` or `"encapsulated"` (zk with a Groth16 key only). */
  privacy: string;
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
  /**
   * Field 10 (chain v3.2.2+): the rollup creator's Dilithium signature over the
   * v2 anchor sign bytes of this batch. When present the chain anchors the
   * batch in `x/multilayer` in the same transaction, and a refused anchor
   * refuses the batch. When absent the batch settles unanchored — and no
   * settlement receipt can ever be built for it.
   */
  anchorSignature: Uint8Array;
  /** Field 11 (chain v3.2.2+): the validator-set commitment carried in the anchor. */
  validatorSetHash: Uint8Array;
  /**
   * Field 12 (chain v3.2.8+): for a based rollup, the inbox sequence of the
   * last post this batch consumes; `data_hash` must then be the inbox range
   * commitment. Zero for every other rollup.
   */
  inboxEnd: bigint;
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
    if (message.verificationKey.length !== 0) writer.uint32(50).bytes(message.verificationKey);
    if (message.sequencing !== "") writer.uint32(58).string(message.sequencing);
    if (message.executionVm !== "") writer.uint32(66).string(message.executionVm);
    if (message.privacy !== "") writer.uint32(74).string(message.privacy);
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
      verificationKey: new Uint8Array(),
      sequencing: "",
      executionVm: "",
      privacy: "",
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
        case 6:
          message.verificationKey = reader.bytes();
          break;
        case 7:
          message.sequencing = reader.string();
          break;
        case 8:
          message.executionVm = reader.string();
          break;
        case 9:
          message.privacy = reader.string();
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
      verificationKey: object.verificationKey ?? new Uint8Array(),
      sequencing: object.sequencing ?? "",
      executionVm: object.executionVm ?? "",
      privacy: object.privacy ?? "",
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
    if (message.anchorSignature.length !== 0) writer.uint32(82).bytes(message.anchorSignature);
    if (message.validatorSetHash.length !== 0) writer.uint32(90).bytes(message.validatorSetHash);
    if (message.inboxEnd !== 0n) writer.uint32(96).uint64(message.inboxEnd);
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
      anchorSignature: new Uint8Array(),
      validatorSetHash: new Uint8Array(),
      inboxEnd: 0n,
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
        case 10:
          message.anchorSignature = reader.bytes();
          break;
        case 11:
          message.validatorSetHash = reader.bytes();
          break;
        case 12:
          message.inboxEnd = reader.uint64();
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
      anchorSignature: object.anchorSignature ?? new Uint8Array(),
      validatorSetHash: object.validatorSetHash ?? new Uint8Array(),
      inboxEnd: object.inboxEnd ?? 0n,
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

// ---------------------------------------------------------------------------
// Messages added in chain v3.2.7 (verification keys) and v3.2.8 (posted data,
// based sequencing, qledger-v1 rollups, private rollups). They hold only
// string, bytes, uint64 and repeated-string fields, so one table-driven codec
// serves all of them.
// ---------------------------------------------------------------------------

type FieldKind = "string" | "bytes" | "uint64" | "uint32" | "repeatedString";
type FieldSpec = readonly [no: number, key: string, kind: FieldKind];

function zeroOf(kind: FieldKind): unknown {
  switch (kind) {
    case "string":
      return "";
    case "bytes":
      return new Uint8Array();
    case "uint64":
      return 0n;
    case "uint32":
      return 0;
    case "repeatedString":
      return [];
  }
}

/** A cosmjs-shaped codec (`encode` / `decode` / `fromPartial`) built from a field table. */
export interface TableCodec<T> {
  readonly typeUrl: string;
  encode(message: T, writer?: BinaryWriter): BinaryWriter;
  decode(input: BinaryReader | Uint8Array, length?: number): T;
  fromPartial(object: Partial<T>): T;
}

function tableCodec<T>(name: string, fields: readonly FieldSpec[], prefix = TYPE_URL_PREFIX): TableCodec<T> {
  const byNo = new Map(fields.map((f) => [f[0], f] as const));
  const fresh = (): Record<string, unknown> =>
    Object.fromEntries(fields.map(([, key, kind]) => [key, zeroOf(kind)]));
  return {
    typeUrl: `${prefix}${name}`,
    encode(message: T, writer: BinaryWriter = BinaryWriter.create()): BinaryWriter {
      const m = message as Record<string, unknown>;
      for (const [no, key, kind] of fields) {
        const v = m[key];
        switch (kind) {
          case "string":
            if (typeof v === "string" && v !== "") writer.uint32((no << 3) | 2).string(v);
            break;
          case "bytes":
            if (v instanceof Uint8Array && v.length !== 0) writer.uint32((no << 3) | 2).bytes(v);
            break;
          case "uint64":
            if (typeof v === "bigint" && v !== 0n) writer.uint32(no << 3).uint64(v);
            break;
          case "uint32":
            if (typeof v === "number" && v !== 0) writer.uint32(no << 3).uint32(v);
            break;
          case "repeatedString":
            for (const s of (v as string[] | undefined) ?? []) writer.uint32((no << 3) | 2).string(s);
            break;
        }
      }
      return writer;
    },
    decode(input: BinaryReader | Uint8Array, length?: number): T {
      const reader = input instanceof BinaryReader ? input : new BinaryReader(input);
      const end = length === undefined ? reader.len : reader.pos + length;
      const m = fresh();
      while (reader.pos < end) {
        const tag = reader.uint32();
        const spec = byNo.get(tag >>> 3);
        if (!spec) {
          reader.skipType(tag & 7);
          continue;
        }
        const [, key, kind] = spec;
        switch (kind) {
          case "string":
            m[key] = reader.string();
            break;
          case "bytes":
            m[key] = reader.bytes();
            break;
          case "uint64":
            m[key] = reader.uint64();
            break;
          case "uint32":
            m[key] = reader.uint32();
            break;
          case "repeatedString":
            (m[key] as string[]).push(reader.string());
            break;
        }
      }
      return m as T;
    },
    fromPartial(object: Partial<T>): T {
      const m = fresh();
      for (const [, key] of fields) {
        const v = (object as Record<string, unknown>)[key];
        if (v !== undefined) m[key] = Array.isArray(v) ? [...v] : v;
      }
      return m as T;
    },
  };
}

/**
 * Registers or replaces a zk rollup's verification key (chain v3.2.7+). Signed
 * by the creator, before the rollup's first batch only. For `snark` the key is
 * a Groth16 BLS12-381 verifying key in gnark's binary encoding for a circuit
 * with exactly four public inputs (prev_state_root, state_root, data_hash,
 * withdrawals_root). From v3.2.8 a `stark` key is refused.
 */
export interface MsgSetVerificationKey {
  creator: string;
  rollupId: string;
  verificationKey: Uint8Array;
  /** `"snark"`, or empty to keep the rollup's proof system. */
  proofSystem: string;
}
export const MsgSetVerificationKey = tableCodec<MsgSetVerificationKey>("MsgSetVerificationKey", [
  [1, "creator", "string"],
  [2, "rollupId", "string"],
  [3, "verificationKey", "bytes"],
  [4, "proofSystem", "string"],
]);

/** Governance-only key replacement (chain v3.2.7+); `authority` is the gov module account. */
export interface MsgUpdateVerificationKey {
  authority: string;
  rollupId: string;
  verificationKey: Uint8Array;
  proofSystem: string;
}
export const MsgUpdateVerificationKey = tableCodec<MsgUpdateVerificationKey>("MsgUpdateVerificationKey", [
  [1, "authority", "string"],
  [2, "rollupId", "string"],
  [3, "verificationKey", "bytes"],
  [4, "proofSystem", "string"],
]);

/**
 * Puts rollup data on chain (chain v3.2.8+). The chain keeps a commitment
 * (SHA-256 of `data`) under the rollup's next inbox sequence; a native-DA batch
 * may then carry that SHA-256 as its `data_hash`. Who may post: the rollup's
 * sequencer (its creator when none is set); anyone on a based rollup.
 */
export interface MsgPostRollupData {
  poster: string;
  rollupId: string;
  data: Uint8Array;
}
export const MsgPostRollupData = tableCodec<MsgPostRollupData>("MsgPostRollupData", [
  [1, "poster", "string"],
  [2, "rollupId", "string"],
  [3, "data", "bytes"],
]);
export interface MsgPostRollupDataResponse {
  /** The inbox sequence the post was given (from 1). */
  sequence: bigint;
  /** SHA-256 of the data: the hash a batch references. */
  dataHash: Uint8Array;
}
export const MsgPostRollupDataResponse = tableCodec<MsgPostRollupDataResponse>("MsgPostRollupDataResponse", [
  [1, "sequence", "uint64"],
  [2, "dataHash", "bytes"],
]);

/** Governance-only move to based sequencing (`"based"`) or back (`""`), chain v3.2.8+. */
export interface MsgSetRollupSequencing {
  authority: string;
  rollupId: string;
  sequencing: string;
}
export const MsgSetRollupSequencing = tableCodec<MsgSetRollupSequencing>("MsgSetRollupSequencing", [
  [1, "authority", "string"],
  [2, "rollupId", "string"],
  [3, "sequencing", "string"],
]);

/**
 * Moves `amount` uqor into a qledger-v1 rollup's deposit pool and credits the
 * 32-byte L2 `account` through the rollup's inbox (chain v3.2.8+). At least
 * 1 QOR (1,000,000 uqor).
 */
export interface MsgDepositToRollup {
  depositor: string;
  rollupId: string;
  account: Uint8Array;
  amount: bigint;
}
export const MsgDepositToRollup = tableCodec<MsgDepositToRollup>("MsgDepositToRollup", [
  [1, "depositor", "string"],
  [2, "rollupId", "string"],
  [3, "account", "bytes"],
  [4, "amount", "uint64"],
]);
export interface MsgDepositToRollupResponse {
  /** The inbox sequence of the deposit entry. */
  sequence: bigint;
}
export const MsgDepositToRollupResponse = tableCodec<MsgDepositToRollupResponse>("MsgDepositToRollupResponse", [
  [1, "sequence", "uint64"],
]);

/** Adds `amount` uqor to the submitter's bond on a qledger-v1 rollup (chain v3.2.8+). */
export interface MsgBondRollupSubmitter {
  submitter: string;
  rollupId: string;
  amount: bigint;
}
export const MsgBondRollupSubmitter = tableCodec<MsgBondRollupSubmitter>("MsgBondRollupSubmitter", [
  [1, "submitter", "string"],
  [2, "rollupId", "string"],
  [3, "amount", "uint64"],
]);
export interface MsgBondRollupSubmitterResponse {
  bond: bigint;
}
export const MsgBondRollupSubmitterResponse = tableCodec<MsgBondRollupSubmitterResponse>(
  "MsgBondRollupSubmitterResponse",
  [[1, "bond", "uint64"]],
);

/** Returns the submitter's whole bond, a full challenge window after its last batch (chain v3.2.8+). */
export interface MsgUnbondRollupSubmitter {
  submitter: string;
  rollupId: string;
}
export const MsgUnbondRollupSubmitter = tableCodec<MsgUnbondRollupSubmitter>("MsgUnbondRollupSubmitter", [
  [1, "submitter", "string"],
  [2, "rollupId", "string"],
]);
export interface MsgUnbondRollupSubmitterResponse {
  returned: bigint;
}
export const MsgUnbondRollupSubmitterResponse = tableCodec<MsgUnbondRollupSubmitterResponse>(
  "MsgUnbondRollupSubmitterResponse",
  [[1, "returned", "uint64"]],
);

/**
 * Sets a private rollup's member list (chain v3.2.8+): at most 32 canonical
 * account addresses, each with a registered ML-KEM-1024 key. Signed by the
 * creator; each change starts a new membership epoch.
 */
export interface MsgSetRollupMembers {
  creator: string;
  rollupId: string;
  members: string[];
}
export const MsgSetRollupMembers = tableCodec<MsgSetRollupMembers>("MsgSetRollupMembers", [
  [1, "creator", "string"],
  [2, "rollupId", "string"],
  [3, "members", "repeatedString"],
]);
export interface MsgSetRollupMembersResponse {
  epoch: bigint;
}
export const MsgSetRollupMembersResponse = tableCodec<MsgSetRollupMembersResponse>("MsgSetRollupMembersResponse", [
  [1, "epoch", "uint64"],
]);

/**
 * Publishes the sender's key-encapsulation public key in the chain's KEM
 * registry (`x/pqc`, chain v3.2.5+). A private rollup's members need an
 * ML-KEM-1024 key there (`algorithmId` 2, the 1568-byte FIPS 203 encapsulation
 * key). Signed hybrid like the other key maintenance.
 */
export interface MsgRegisterKEMKey {
  sender: string;
  algorithmId: number;
  publicKey: Uint8Array;
}
export const MsgRegisterKEMKey = tableCodec<MsgRegisterKEMKey>(
  "MsgRegisterKEMKey",
  [
    [1, "sender", "string"],
    [2, "algorithmId", "uint32"],
    [3, "publicKey", "bytes"],
  ],
  "/qorechain.pqc.v1.",
);
