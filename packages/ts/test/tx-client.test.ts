import { describe, it, expect } from "vitest";
import { RdkTxClient, type SignAndBroadcastCapable, type TxFee } from "../src/index";
import type { EncodeObject } from "@cosmjs/proto-signing";

interface Call {
  signerAddress: string;
  messages: readonly EncodeObject[];
  fee: TxFee;
  memo?: string;
}

function fakeClient() {
  const calls: Call[] = [];
  const client: SignAndBroadcastCapable = {
    async signAndBroadcast(signerAddress, messages, fee, memo) {
      calls.push({ signerAddress, messages, fee, memo });
      // Minimal DeliverTxResponse-shaped value for the test.
      return { code: 0, transactionHash: "DEADBEEF", height: 1 } as never;
    },
  };
  return { client, calls };
}

describe("RdkTxClient", () => {
  it("creates a rollup with the client address as creator and defaults fee to auto", async () => {
    const { client, calls } = fakeClient();
    const rdk = RdkTxClient.fromClient(client, "qor1me");
    await rdk.createRollup({ rollupId: "r", profile: "defi", vmType: "evm", stakeAmount: "100" });

    expect(calls).toHaveLength(1);
    expect(calls[0].signerAddress).toBe("qor1me");
    expect(calls[0].fee).toBe("auto");
    const msg = calls[0].messages[0];
    expect(msg.typeUrl).toBe("/qorechain.rdk.v1.MsgCreateRollup");
    expect((msg.value as { creator: string }).creator).toBe("qor1me");
  });

  it("submitBatch uses the address as the sequencer", async () => {
    const { client, calls } = fakeClient();
    const rdk = RdkTxClient.fromClient(client, "qor1seq");
    await rdk.submitBatch({
      rollupId: "r",
      batchIndex: 0,
      stateRoot: "0xaa",
      txCount: 1,
      dataHash: "0xbb",
    });
    const msg = calls[0].messages[0];
    expect(msg.typeUrl).toBe("/qorechain.rdk.v1.MsgSubmitBatch");
    expect((msg.value as { sequencer: string }).sequencer).toBe("qor1seq");
  });

  it("guards an invalid lifecycle transition before broadcasting", async () => {
    const { client, calls } = fakeClient();
    const rdk = RdkTxClient.fromClient(client, "qor1me");
    await expect(rdk.resumeRollup({ rollupId: "r", currentStatus: "active" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("allows a valid guarded transition", async () => {
    const { client, calls } = fakeClient();
    const rdk = RdkTxClient.fromClient(client, "qor1me");
    await rdk.pauseRollup({ rollupId: "r", reason: "maintenance", currentStatus: "active" });
    expect(calls).toHaveLength(1);
    expect(calls[0].messages[0].typeUrl).toBe("/qorechain.rdk.v1.MsgPauseRollup");
  });
});
