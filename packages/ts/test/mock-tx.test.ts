import { describe, it, expect } from "vitest";
import { RdkTxClient, MockTxClient } from "../src/index";

describe("MockTxClient + simulate", () => {
  it("records create-rollup and returns a fake success", async () => {
    const mock = new MockTxClient();
    const tx = RdkTxClient.fromClient(mock, "qor1me");
    const res = await tx.createRollup({
      rollupId: "d",
      profile: "defi",
      vmType: "evm",
      stakeAmount: "10000000000",
    });
    expect(res.transactionHash).toBe("MOCK_TX_HASH");
    expect(res.code).toBe(0);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].messages[0].typeUrl).toBe("/qorechain.rdk.v1.MsgCreateRollup");
  });

  it("supports gas simulation", async () => {
    const mock = new MockTxClient({ gasEstimate: 99_000 });
    const tx = RdkTxClient.fromClient(mock, "qor1me");
    const gas = await tx.simulate([
      { typeUrl: "/qorechain.rdk.v1.MsgPauseRollup", value: { creator: "qor1me", rollupId: "d", reason: "" } },
    ]);
    expect(gas).toBe(99_000);
  });

  it("runs the full lifecycle offline via the mock", async () => {
    const mock = new MockTxClient();
    const tx = RdkTxClient.fromClient(mock, "qor1me");
    await tx.createRollup({ rollupId: "d", profile: "gaming", vmType: "custom", stakeAmount: "1" });
    await tx.pauseRollup({ rollupId: "d", reason: "maintenance", currentStatus: "active" });
    await tx.resumeRollup({ rollupId: "d", currentStatus: "paused" });
    await tx.stopRollup({ rollupId: "d", currentStatus: "active" });
    expect(mock.calls.map((c) => c.messages[0].typeUrl)).toEqual([
      "/qorechain.rdk.v1.MsgCreateRollup",
      "/qorechain.rdk.v1.MsgPauseRollup",
      "/qorechain.rdk.v1.MsgResumeRollup",
      "/qorechain.rdk.v1.MsgStopRollup",
    ]);
  });
});
