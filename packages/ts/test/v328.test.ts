import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import {
  BLS12_381_SCALAR_MODULUS,
  PRESET_DEFAULTS,
  bytesToHex,
  createRdkRegistry,
  createRollupMsg,
  dataHashError,
  decodeRdkTxError,
  depositToRollupMsg,
  envelopeMembershipError,
  hexToBytes,
  inboxAccumulate,
  inboxRangeHash,
  isCanonicalScalar,
  isDataHashChainBound,
  isProofCompatible,
  kemKeypairFromSeed,
  kemKeyFingerprint,
  openEnvelope,
  parseEnvelope,
  postRollupDataMsg,
  registerKemKeyMsg,
  postedDataHash,
  presets,
  rollupModeErrors,
  sealEnvelope,
  setRollupMembersMsg,
  setVerificationKeyMsg,
  submitBatchMsg,
  toCanonicalScalar,
  bondRollupSubmitterMsg,
  unbondRollupSubmitterMsg,
  updateVerificationKeyMsg,
  setRollupSequencingMsg,
  validateRollupConfig,
  zkPublicInputErrors,
} from "../src";
import { MsgPostRollupDataResponse } from "../src/tx/codecs";

const v = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/v328.json", import.meta.url)), "utf8"),
);
const reg = createRdkRegistry();
const hex = (o: { typeUrl: string; value: unknown }) => bytesToHex(reg.encode(o));

describe("v3.2.8 message bytes match the chain's tx.proto", () => {
  it("MsgCreateRollup carries fields 6-9", () => {
    expect(
      hex(
        createRollupMsg({
          creator: "qor1creator",
          rollupId: "my-rollup",
          profile: "nft",
          vmType: "native",
          stakeAmount: 10_000_000_000n,
          verificationKey: new Uint8Array([9, 8, 7]),
          sequencing: "based",
          executionVm: "qledger-v1",
          privacy: "encapsulated",
        }),
      ),
    ).toBe(v.msgProtoHex.MsgCreateRollupV328);
  });
  it("MsgSubmitBatch carries inbox_end", () => {
    expect(
      hex(
        submitBatchMsg({
          sequencer: "qor1seq",
          rollupId: "r1",
          batchIndex: 7,
          stateRoot: new Uint8Array([1, 2, 3]),
          txCount: 42,
          dataHash: new Uint8Array([9, 9]),
          inboxEnd: 300,
        }),
      ),
    ).toBe(v.msgProtoHex.MsgSubmitBatchV328);
  });
  it("new messages", () => {
    const cases: [string, { typeUrl: string; value: unknown }][] = [
      ["MsgSetVerificationKey", setVerificationKeyMsg({ creator: "qor1creator", rollupId: "r1", verificationKey: "01020304", proofSystem: "snark" })],
      ["MsgUpdateVerificationKey", updateVerificationKeyMsg({ authority: "qor1gov", rollupId: "r1", verificationKey: "0506", proofSystem: "snark" })],
      ["MsgPostRollupData", postRollupDataMsg({ poster: "qor1poster", rollupId: "r1", data: new TextEncoder().encode("hello") })],
      ["MsgSetRollupSequencing", setRollupSequencingMsg({ authority: "qor1gov", rollupId: "r1", sequencing: "based" })],
      ["MsgDepositToRollup", depositToRollupMsg({ depositor: "qor1dep", rollupId: "r1", account: "00".repeat(31) + "01", amount: 1_000_000 })],
      ["MsgBondRollupSubmitter", bondRollupSubmitterMsg({ submitter: "qor1sub", rollupId: "r1", amount: 1_000_000_000n })],
      ["MsgUnbondRollupSubmitter", unbondRollupSubmitterMsg({ submitter: "qor1sub", rollupId: "r1" })],
      ["MsgSetRollupMembers", setRollupMembersMsg({ creator: "qor1creator", rollupId: "r1", members: ["qor1a", "qor1b"] })],
      ["MsgRegisterKEMKey", registerKemKeyMsg({ sender: "qor1member", publicKey: "01020304" })],
    ];
    for (const [name, msg] of cases) expect(hex(msg), name).toBe(v.msgProtoHex[name]);
  });
  it("decodes MsgPostRollupDataResponse and round-trips every new message", () => {
    const r = MsgPostRollupDataResponse.decode(hexToBytes(v.msgProtoHex.MsgPostRollupDataResponse));
    expect(r.sequence).toBe(5n);
    expect(bytesToHex(r.dataHash)).toBe("aabb");
    const m = setRollupMembersMsg({ creator: "c", rollupId: "r", members: ["a", "b"] });
    expect(reg.decode({ typeUrl: m.typeUrl, value: reg.encode(m) })).toEqual(m.value);
  });
});

describe("rollup inbox", () => {
  it("accumulator and range commitments match the chain", () => {
    const { chainId, rollupId, posts } = v.inbox;
    let acc = new Uint8Array();
    const accs: Uint8Array[] = [];
    for (const p of posts) {
      expect(bytesToHex(postedDataHash(hexToBytes(p.dataHex)))).toBe(p.dataHash);
      acc = inboxAccumulate({ chainId, rollupId, prevAcc: acc, sequence: p.sequence, height: p.height, poster: p.poster, dataHash: p.dataHash });
      expect(bytesToHex(acc)).toBe(p.acc);
      accs.push(acc);
    }
    expect(bytesToHex(inboxRangeHash({ chainId, rollupId, from: 0, to: 3, accFrom: new Uint8Array(), accTo: accs[2]! }))).toBe(v.inbox.range_0_3);
    expect(bytesToHex(inboxRangeHash({ chainId, rollupId, from: 1, to: 3, accFrom: accs[0]!, accTo: accs[2]! }))).toBe(v.inbox.range_1_3);
  });
});

describe("canonical ZK inputs", () => {
  it("classifies and reduces against the BLS12-381 scalar modulus", () => {
    expect(BLS12_381_SCALAR_MODULUS.toString(16).padStart(64, "0")).toBe(v.zk.modulus);
    for (const c of v.zk.cases) {
      expect(isCanonicalScalar(c.value), c.value).toBe(c.canonical);
      expect(bytesToHex(toCanonicalScalar(c.value))).toBe(c.reduced);
    }
  });
  it("names each refused input, and skips a chain-bound data hash", () => {
    const high = "ff".repeat(32);
    const ok = "00".repeat(31) + "01";
    expect(zkPublicInputErrors({ prevStateRoot: ok, stateRoot: ok, dataHash: ok })).toEqual([]);
    expect(zkPublicInputErrors({ stateRoot: high, dataHash: high, withdrawalsRoot: high })).toHaveLength(2);
    expect(zkPublicInputErrors({ stateRoot: ok, dataHash: high }, { dataHashBound: true })).toEqual([]);
    expect(zkPublicInputErrors({ stateRoot: ok, withdrawalsRoot: "" })).toEqual([]);
    expect(isDataHashChainBound({ daBackend: "celestia", sequencing: "based" })).toBe(true);
    expect(isDataHashChainBound({ daBackend: "native" }, high)).toBe(true);
    expect(isDataHashChainBound({ daBackend: "native" }, "")).toBe(false);
    expect(isDataHashChainBound({ daBackend: "celestia" }, high)).toBe(false);
  });
});

describe("private-rollup envelopes", () => {
  const p = v.privpost;
  const pt = hexToBytes(p.plaintextHex);
  const recipients = p.members.map((m: { member: string; seed: string }) => ({
    member: m.member,
    encapsulationKey: kemKeypairFromSeed(m.seed).publicKey,
  }));

  it("opens the chain's envelope as each member", () => {
    const env = parseEnvelope(p.envelope);
    expect(env.epoch).toBe(BigInt(p.epoch));
    expect(env.entries.map((e) => e.member)).toEqual(p.members.map((m: { member: string }) => m.member));
    for (const m of p.members) {
      expect(bytesToHex(kemKeyFingerprint(kemKeypairFromSeed(m.seed).publicKey))).toBe(m.ekSha256);
      const out = openEnvelope({ envelope: p.envelope, chainId: p.chainId, rollupId: p.rollupId, member: m.member, decapsulationKey: m.seed });
      expect(bytesToHex(out)).toBe(p.plaintextHex);
    }
  });

  it("seals byte for byte as the chain does with the same randomness", () => {
    let n = 0;
    const random = (len: number) => {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++, n++) {
        const c = new Uint8Array(8);
        new DataView(c.buffer).setBigUint64(0, BigInt(Math.floor(n / 32)), false);
        const blk = sha256(new Uint8Array([...new TextEncoder().encode("qorechain-rdk-test-rand"), ...c]));
        out[i] = blk[n % 32]!;
      }
      return out;
    };
    const env = sealEnvelope({ chainId: p.chainId, rollupId: p.rollupId, epoch: p.epoch, recipients, plaintext: pt, random });
    expect(bytesToHex(sha256(env))).toBe(p.envelopeSha256);
  });

  it("refuses a wrong member, rollup or tampered payload, and mirrors the chain's membership check", () => {
    const m = p.members[0];
    const open = (over: Record<string, unknown>) =>
      openEnvelope({ envelope: p.envelope, chainId: p.chainId, rollupId: p.rollupId, member: m.member, decapsulationKey: m.seed, ...over });
    expect(() => open({ member: "qor1nobody" })).toThrow(/no entry/);
    expect(() => open({ rollupId: "other" })).toThrow(/does not open/);
    const tampered = hexToBytes(p.envelope);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => open({ envelope: tampered })).toThrow(/does not open/);
    const fresh = sealEnvelope({ chainId: p.chainId, rollupId: p.rollupId, epoch: 1, recipients, plaintext: pt });
    expect(envelopeMembershipError(fresh, { membersEpoch: 1, members: recipients })).toBeUndefined();
    expect(envelopeMembershipError(fresh, { membersEpoch: 2, members: recipients })).toMatch(/epoch/);
    expect(envelopeMembershipError(fresh, { membersEpoch: 1, members: [...recipients].reverse() })).toMatch(/entry 0/);
    expect(envelopeMembershipError(fresh, { membersEpoch: 1, members: recipients.slice(0, 1) })).toMatch(/2 entries/);
  });
});

describe("v3.2.8 configuration rules", () => {
  it("optimistic presets run qledger-v1 and are based, and validate", () => {
    for (const name of ["nft", "custom"] as const) {
      expect(PRESET_DEFAULTS[name].executionVm).toBe("qledger-v1");
      expect(PRESET_DEFAULTS[name].sequencing).toBe("based");
      const r = validateRollupConfig({ ...PRESET_DEFAULTS[name], rollupId: "my-rollup" });
      expect(r.errors).toEqual([]);
      const msg = presets[name]({ rollupId: "my-rollup" }).toCreateMsg("qor1c", { stakeAmount: "1" });
      expect(msg.executionVm).toBe("qledger-v1");
      expect(msg.sequencing).toBe("based");
    }
  });
  it("refuses an optimistic rollup without an execution VM, and stark", () => {
    expect(validateRollupConfig({ ...PRESET_DEFAULTS.custom, rollupId: "my-rollup", executionVm: "", sequencing: "" }).valid).toBe(false);
    expect(isProofCompatible("zk", "stark")).toBe(false);
    expect(validateRollupConfig({ ...PRESET_DEFAULTS.defi, rollupId: "my-rollup", proofSystem: "stark" }).errors.join()).toMatch(/paused/);
  });
  it("mirrors the chain's sequencing, execution VM and privacy matrix", () => {
    expect(rollupModeErrors({ settlement: "zk", proofSystem: "snark", sequencing: "based", privacy: "encapsulated" })).toEqual([]);
    expect(rollupModeErrors({ settlement: "based", proofSystem: "none", sequencing: "based" })).toEqual([]);
    expect(rollupModeErrors({ settlement: "sovereign", proofSystem: "none", sequencing: "based" })).toHaveLength(1);
    expect(rollupModeErrors({ settlement: "zk", proofSystem: "snark", executionVm: "qledger-v1", sequencing: "based" }).join()).toMatch(/optimistic/);
    expect(rollupModeErrors({ settlement: "optimistic", proofSystem: "fraud", executionVm: "qledger-v1" }).join()).toMatch(/based/);
    expect(rollupModeErrors({ settlement: "optimistic", proofSystem: "fraud", executionVm: "qledger-v1", sequencing: "based", privacy: "encapsulated" }).length).toBeGreaterThan(0);
    expect(rollupModeErrors({ settlement: "based", proofSystem: "none", privacy: "encapsulated" }).join()).toMatch(/private rollup/);
  });
  it("lets a native data hash through once posted data is on", () => {
    expect(dataHashError("native", "ab")).toBeDefined();
    expect(dataHashError("native", "ab", { postedDataEnabled: true })).toBeUndefined();
  });
  it("names the v3.2.8 refusals", () => {
    expect(decodeRdkTxError({ code: 48, codespace: "rdk" }).kind).toBe("invalid_rollup_mode");
    expect(decodeRdkTxError({ code: 52, codespace: "rdk" }).kind).toBe("stark_statement_unsupported");
    expect(decodeRdkTxError({ code: 46, codespace: "rdk" }).kind).toBe("invalid_inbox_range");
  });
});
