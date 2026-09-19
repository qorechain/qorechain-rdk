/**
 * Hybrid (post-quantum) signing through `RdkTxClient`.
 *
 * No live chain: a fake transport reports a chain id and a sequence and records
 * the broadcast. `@qorechain/sdk`'s `signAndBroadcastHybrid` runs for real (the
 * ML-DSA-87 signing is local) so the wiring is exercised end to end; it is
 * wrapped only to record the options the RDK hands it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { StdFee } from "@cosmjs/stargate";

const hybridSpy = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock("@qorechain/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@qorechain/sdk")>();
  return {
    ...actual,
    signAndBroadcastHybrid: (opts: Record<string, unknown>) => {
      hybridSpy.calls.push(opts);
      return actual.signAndBroadcastHybrid(
        opts as unknown as Parameters<typeof actual.signAndBroadcastHybrid>[0],
      );
    },
  };
});

const {
  RdkTxClient,
  directSignerFromPrivateKey,
  generatePqcKeypair,
  resolveSignBytesVersion,
  isHybridSignBytesRejection,
} = await import("../src/index");

const FEE: StdFee = { amount: [{ denom: "uqor", amount: "30000" }], gas: "200000" };

/** A fake client that satisfies both the classical and the hybrid capabilities. */
function fakeTransport(chainId = "qorechain-diana") {
  const classical: {
    signerAddress: string;
    messages: readonly EncodeObject[];
    fee: unknown;
    memo?: string;
  }[] = [];
  const broadcasts: Uint8Array[] = [];
  const client = {
    async signAndBroadcast(
      signerAddress: string,
      messages: readonly EncodeObject[],
      fee: unknown,
      memo?: string,
    ) {
      classical.push({ signerAddress, messages, fee, memo });
      return { code: 0, transactionHash: "CLASSICAL", height: 7 } as never;
    },
    async simulate() {
      return 120000;
    },
    async getChainId() {
      return chainId;
    },
    async getSequence() {
      return { accountNumber: 12, sequence: 5 };
    },
    async broadcastTx(tx: Uint8Array) {
      broadcasts.push(tx);
      return {
        code: 0,
        transactionHash: "HYBRIDHASH",
        height: 42,
        gasUsed: BigInt(111111),
        gasWanted: BigInt(200000),
        rawLog: "ok",
      };
    },
    async broadcastTxSync(tx: Uint8Array) {
      broadcasts.push(tx);
      return "HYBRIDHASH";
    },
  };
  return { client, classical, broadcasts };
}

async function directSigner() {
  const key = new Uint8Array(32).fill(7);
  return directSignerFromPrivateKey(key, "qor");
}

describe("RdkTxClient hybrid signing", () => {
  beforeEach(() => {
    hybridSpy.calls.length = 0;
  });

  it("keeps the classical path untouched when no pqcKeypair is given", async () => {
    const { client, classical, broadcasts } = fakeTransport();
    const rdk = RdkTxClient.fromClient(client, "qor1me");

    expect(rdk.isHybrid).toBe(false);
    const res = await rdk.createRollup({
      rollupId: "r",
      profile: "defi",
      vmType: "evm",
      stakeAmount: "100",
    });

    expect(hybridSpy.calls).toHaveLength(0);
    expect(broadcasts).toHaveLength(0);
    expect(classical).toHaveLength(1);
    expect(classical[0].fee).toBe("auto");
    expect(classical[0].memo).toBe("");
    expect(res.transactionHash).toBe("CLASSICAL");
  });

  it("signs hybrid and maps the SDK result onto DeliverTxResponse", async () => {
    const { client, classical, broadcasts } = fakeTransport();
    const signer = await directSigner();
    const [account] = await signer.getAccounts();
    const rdk = RdkTxClient.fromClient(client, account.address, {
      signer,
      pqcKeypair: generatePqcKeypair(new Uint8Array(32).fill(3)),
      signBytesVersion: "v2",
    });

    expect(rdk.isHybrid).toBe(true);
    const res = await rdk.submitBatch(
      { rollupId: "r", batchIndex: 0, stateRoot: "0xaa", txCount: 1, dataHash: "0xbb" },
      { fee: FEE, memo: "batch" },
    );

    // The hybrid path was taken, not cosmjs's signAndBroadcast.
    expect(classical).toHaveLength(0);
    expect(hybridSpy.calls).toHaveLength(1);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].byteLength).toBeGreaterThan(4627); // carries the ML-DSA-87 signature

    const opts = hybridSpy.calls[0];
    expect(opts.chainId).toBe("qorechain-diana");
    expect(opts.accountNumber).toBe(12);
    expect(opts.sequence).toBe(5);
    expect(opts.fee).toEqual(FEE);
    expect(opts.memo).toBe("batch");
    expect(opts.transport).toBe(client);
    expect((opts.messages as EncodeObject[])[0].typeUrl).toBe(
      "/qorechain.rdk.v1.MsgSubmitBatch",
    );

    // DeliverTxResponse shape, so existing call sites are unchanged.
    expect(res).toMatchObject({
      code: 0,
      height: 42,
      txIndex: 0,
      transactionHash: "HYBRIDHASH",
      rawLog: "ok",
      gasUsed: BigInt(111111),
      gasWanted: BigInt(200000),
    });
    expect(res.events).toEqual([]);
    expect(res.msgResponses).toEqual([]);
  });

  it('passes an explicit signBytesVersion: "v2" through to the SDK', async () => {
    const { client } = fakeTransport();
    const signer = await directSigner();
    const [account] = await signer.getAccounts();
    const rdk = RdkTxClient.fromClient(client, account.address, {
      signer,
      pqcKeypair: generatePqcKeypair(new Uint8Array(32).fill(4)),
      signBytesVersion: "v2",
      rest: "https://api.example.invalid",
    });

    await rdk.createRollup(
      { rollupId: "r", profile: "defi", vmType: "evm", stakeAmount: "100" },
      { fee: FEE },
    );

    expect(hybridSpy.calls[0].signBytesVersion).toBe("v2");
    expect(hybridSpy.calls[0].rest).toBe("https://api.example.invalid");
  });

  it('defaults signBytesVersion to "auto" and surfaces the SDK throw when rest is missing', async () => {
    const { client, broadcasts } = fakeTransport();
    const signer = await directSigner();
    const [account] = await signer.getAccounts();
    const rdk = RdkTxClient.fromClient(client, account.address, {
      signer,
      pqcKeypair: generatePqcKeypair(new Uint8Array(32).fill(5)),
    });

    await expect(
      rdk.createRollup(
        { rollupId: "r", profile: "defi", vmType: "evm", stakeAmount: "100" },
        { fee: FEE },
      ),
    ).rejects.toThrow(/sign-bytes form for qorechain-diana without its REST endpoint/);

    // The SDK refused rather than guessing a sign-bytes form; nothing broadcast.
    expect(hybridSpy.calls[0].signBytesVersion).toBe("auto");
    expect(hybridSpy.calls[0].rest).toBeUndefined();
    expect(broadcasts).toHaveLength(0);
  });

  it("prices an explicit gas limit and an auto fee from the connect gasPrice", async () => {
    const { client } = fakeTransport();
    const signer = await directSigner();
    const [account] = await signer.getAccounts();
    const rdk = RdkTxClient.fromClient(client, account.address, {
      signer,
      pqcKeypair: generatePqcKeypair(new Uint8Array(32).fill(6)),
      signBytesVersion: "v2",
      gasPrice: "0.15uqor",
    });

    await rdk.createRollup(
      { rollupId: "r", profile: "defi", vmType: "evm", stakeAmount: "100" },
      { fee: 200000 },
    );
    expect(hybridSpy.calls[0].fee).toEqual({
      amount: [{ denom: "uqor", amount: "30000" }],
      gas: "200000",
    });

    // "auto" simulates (120000) and applies the 1.4 multiplier → 168000 gas.
    await rdk.createRollup({
      rollupId: "r2",
      profile: "defi",
      vmType: "evm",
      stakeAmount: "100",
    });
    expect(hybridSpy.calls[1].fee).toEqual({
      amount: [{ denom: "uqor", amount: "25200" }],
      gas: "168000",
    });
  });

  it("throws a clear error when a hybrid fee cannot be priced", async () => {
    const { client } = fakeTransport();
    const signer = await directSigner();
    const [account] = await signer.getAccounts();
    const rdk = RdkTxClient.fromClient(client, account.address, {
      signer,
      pqcKeypair: generatePqcKeypair(new Uint8Array(32).fill(8)),
      signBytesVersion: "v2",
    });

    await expect(
      rdk.createRollup({ rollupId: "r", profile: "defi", vmType: "evm", stakeAmount: "100" }),
    ).rejects.toThrow(/explicit fee|gasPrice/);
    expect(hybridSpy.calls).toHaveLength(0);
  });

  it("rejects an amino-only signer for hybrid signing", async () => {
    const { client } = fakeTransport();
    const aminoOnly = {
      getAccounts: async () => [{ address: "qor1me", algo: "secp256k1", pubkey: new Uint8Array() }],
      signAmino: async () => {
        throw new Error("unused");
      },
    };
    expect(() =>
      RdkTxClient.fromClient(client, "qor1me", {
        signer: aminoOnly as never,
        pqcKeypair: generatePqcKeypair(new Uint8Array(32).fill(9)),
      }),
    ).toThrow(/OfflineDirectSigner|signDirect/);
  });

  it("re-exports the sign-bytes helpers an operator needs", () => {
    expect(typeof resolveSignBytesVersion).toBe("function");
    expect(typeof isHybridSignBytesRejection).toBe("function");
    expect(isHybridSignBytesRejection(new Error("unrelated"))).toBe(false);
  });
});
