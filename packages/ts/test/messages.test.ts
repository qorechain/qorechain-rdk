import { describe, it, expect } from "vitest";
import {
  createRollupMsg,
  submitBatchMsg,
  executeWithdrawalMsg,
  createRdkRegistry,
} from "../src/index";

describe("message builders", () => {
  it("createRollupMsg coerces stake to bigint and sets the type URL", () => {
    const msg = createRollupMsg({
      creator: "qor1c",
      rollupId: "r",
      profile: "defi",
      vmType: "evm",
      stakeAmount: "10000000000",
    });
    expect(msg.typeUrl).toBe("/qorechain.rdk.v1.MsgCreateRollup");
    expect(msg.value.stakeAmount).toBe(10000000000n);
  });

  it("submitBatchMsg parses hex byte fields and defaults optional bytes to empty", () => {
    const msg = submitBatchMsg({
      sequencer: "qor1s",
      rollupId: "r",
      batchIndex: 1,
      stateRoot: "0x0a0b",
      txCount: 5,
      dataHash: new Uint8Array([255]),
    });
    expect(Array.from(msg.value.stateRoot)).toEqual([10, 11]);
    expect(Array.from(msg.value.dataHash)).toEqual([255]);
    expect(msg.value.prevStateRoot.length).toBe(0);
    expect(msg.value.proof.length).toBe(0);
    expect(msg.value.batchIndex).toBe(1n);
  });

  it("executeWithdrawalMsg maps repeated proof bytes", () => {
    const msg = executeWithdrawalMsg({
      submitter: "qor1x",
      rollupId: "r",
      batchIndex: 2,
      withdrawalIndex: 0,
      recipient: "qor1y",
      denom: "uqor",
      amount: 100,
      proof: ["0x01", new Uint8Array([2, 2])],
    });
    expect(msg.value.proof.map((p: Uint8Array) => Array.from(p))).toEqual([[1], [2, 2]]);
  });

  it("the rdk registry can look up every message type", () => {
    const registry = createRdkRegistry();
    for (const typeUrl of [
      "MsgCreateRollup",
      "MsgSubmitBatch",
      "MsgChallengeBatch",
      "MsgResolveChallenge",
      "MsgPauseRollup",
      "MsgResumeRollup",
      "MsgStopRollup",
      "MsgExecuteWithdrawal",
    ]) {
      expect(registry.lookupType(`/qorechain.rdk.v1.${typeUrl}`)).toBeTruthy();
    }
  });
});
