import { describe, it, expect } from "vitest";
import {
  MsgCreateRollup,
  MsgSubmitBatch,
  MsgExecuteWithdrawal,
  MsgPauseRollup,
} from "../src/tx/codecs";
import { bytesToHex } from "../src/index";

describe("rdk message codecs", () => {
  it("encodes MsgPauseRollup to the exact expected wire bytes", () => {
    // Pins the field numbers/wire types against the proto.
    const bytes = MsgPauseRollup.encode(
      MsgPauseRollup.fromPartial({ creator: "qor1abc", rollupId: "r1", reason: "x" }),
    ).finish();
    expect(bytesToHex(bytes)).toBe("0a07716f7231616263120272311a0178");
  });

  it("round-trips MsgCreateRollup including int64", () => {
    const original = MsgCreateRollup.fromPartial({
      creator: "qor1creator",
      rollupId: "my-rollup",
      profile: "defi",
      vmType: "evm",
      stakeAmount: 10000000000n,
    });
    const decoded = MsgCreateRollup.decode(MsgCreateRollup.encode(original).finish());
    expect(decoded).toEqual(original);
  });

  it("round-trips MsgSubmitBatch including uint64 and bytes", () => {
    const original = MsgSubmitBatch.fromPartial({
      sequencer: "qor1seq",
      rollupId: "r",
      batchIndex: 7n,
      stateRoot: new Uint8Array([1, 2, 3]),
      prevStateRoot: new Uint8Array([4, 5]),
      txCount: 42n,
      dataHash: new Uint8Array([9, 9]),
      proof: new Uint8Array([8]),
      withdrawalsRoot: new Uint8Array([7, 7, 7]),
    });
    const decoded = MsgSubmitBatch.decode(MsgSubmitBatch.encode(original).finish());
    expect(decoded).toEqual(original);
  });

  it("round-trips MsgExecuteWithdrawal including repeated bytes", () => {
    const original = MsgExecuteWithdrawal.fromPartial({
      submitter: "qor1sub",
      rollupId: "r",
      batchIndex: 3n,
      withdrawalIndex: 1n,
      recipient: "qor1dest",
      denom: "uqor",
      amount: 500n,
      proof: [new Uint8Array([1]), new Uint8Array([2, 2])],
    });
    const decoded = MsgExecuteWithdrawal.decode(MsgExecuteWithdrawal.encode(original).finish());
    expect(decoded).toEqual(original);
  });
});
