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
  anchorSignBytesForBatch: anchorSignBytesForBatchRef,
  pqcVerify: pqcVerifyRef,
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
        msgResponses: [{ typeUrl: "/qorechain.rdk.v1.MsgSubmitBatchResponse", value: new Uint8Array([7]) }],
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
      rollupId: "roll-r",
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
      { rollupId: "roll-r", batchIndex: 0, stateRoot: "0xaa", txCount: 1, dataHash: "0xbb" },
      { fee: FEE, memo: "batch" },
    );

    // The hybrid path was taken, not cosmjs's signAndBroadcast.
    expect(classical).toHaveLength(0);
    expect(hybridSpy.calls).toHaveLength(1);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].byteLength).toBeGreaterThan(4627); // carries the ML-DSA-87 signature

    // The typed Msg*Response the node returned is forwarded, not dropped.
    expect(res.msgResponses).toEqual([
      { typeUrl: "/qorechain.rdk.v1.MsgSubmitBatchResponse", value: new Uint8Array([7]) },
    ]);

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
      { rollupId: "roll-r", profile: "defi", vmType: "evm", stakeAmount: "100" },
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
        { rollupId: "roll-r", profile: "defi", vmType: "evm", stakeAmount: "100" },
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
      { rollupId: "roll-r", profile: "defi", vmType: "evm", stakeAmount: "100" },
      { fee: 200000 },
    );
    expect(hybridSpy.calls[0].fee).toEqual({
      amount: [{ denom: "uqor", amount: "30000" }],
      gas: "200000",
    });

    // "auto" simulates (120000) and applies the 1.4 multiplier → 168000 gas.
    await rdk.createRollup({
      rollupId: "roll-r2",
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
      rdk.createRollup({ rollupId: "roll-r", profile: "defi", vmType: "evm", stakeAmount: "100" }),
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

describe("RdkTxClient.submitBatch anchoring (chain v3.2.2+)", () => {
  const { anchorSignBytesForBatch, pqcVerify } = await_import();
  const layerId = "layer-roll-1";

  /** Serve getRollup over the stubbed global fetch. */
  function stubRollup(creator: string, daBackend = "") {
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("/qorechain/rdk/v1/rollup/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            rollup: { rollup_id: "roll-r", creator, layer_id: layerId, status: "active", da_backend: daBackend },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
  }

  async function hybridClient() {
    const { client, broadcasts } = fakeTransport();
    const signer = await directSigner();
    const [account] = await signer.getAccounts();
    const pqcKeypair = generatePqcKeypair(new Uint8Array(32).fill(3));
    const rdk = RdkTxClient.fromClient(client, account.address, {
      signer,
      pqcKeypair,
      rest: "https://node",
      signBytesVersion: "v2",
    });
    return { rdk, address: account.address, pqcKeypair, broadcasts };
  }

  const batch = { rollupId: "roll-r", batchIndex: 7, stateRoot: "ab".repeat(32), txCount: 3, dataHash: "bb" };
  const sentMsg = () => (hybridSpy.calls.at(-1)!.messages as EncodeObject[])[0].value as Record<string, Uint8Array>;

  beforeEach(() => {
    hybridSpy.calls.length = 0;
    vi.unstubAllGlobals();
  });

  it("signs the anchor when this client is the rollup's creator, and the chain's bytes verify", async () => {
    const { rdk, address, pqcKeypair } = await hybridClient();
    stubRollup(address);
    await rdk.submitBatch(batch, { fee: FEE });
    const sig = sentMsg().anchorSignature;
    expect(sig.length).toBe(4627); // an ML-DSA-87 signature
    const message = anchorSignBytesForBatch({
      chainId: "qorechain-diana",
      layerId,
      batchIndex: 7,
      stateRoot: batch.stateRoot,
      txCount: 3,
    });
    expect(pqcVerify(pqcKeypair.publicKey, message, sig)).toBe(true);
  });

  it("submits unanchored, not wrongly signed, when this client is not the creator", async () => {
    // The chain checks the creator's key and refuses the whole batch on a bad
    // anchor, so signing with our own key here would break the submission.
    const { rdk } = await hybridClient();
    stubRollup("qor1someoneelse000000000000000000000000000");
    await rdk.submitBatch(batch, { fee: FEE });
    expect(sentMsg().anchorSignature.length).toBe(0);
  });

  it("refuses with anchor: 'require' rather than submit unanchored, and broadcasts nothing", async () => {
    const { rdk, broadcasts } = await hybridClient();
    stubRollup("qor1someoneelse000000000000000000000000000");
    await expect(rdk.submitBatch(batch, { fee: FEE, anchor: "require" })).rejects.toThrow(
      /not the rollup's creator/,
    );
    expect(broadcasts).toHaveLength(0);
  });

  it("refuses a data hash on a native-DA rollup before broadcasting", async () => {
    // No transaction stores a DA blob, so the chain would refuse the batch.
    const { rdk, address, broadcasts } = await hybridClient();
    stubRollup(address, "native");
    await expect(rdk.submitBatch(batch, { fee: FEE })).rejects.toThrow(/dataHash must be empty/);
    expect(broadcasts).toHaveLength(0);
  });

  it("submits a native-DA batch that leaves the data hash empty", async () => {
    const { rdk, address } = await hybridClient();
    stubRollup(address, "native");
    const withoutHash: Partial<typeof batch> = { ...batch };
    delete withoutHash.dataHash;
    await rdk.submitBatch(withoutHash as Omit<typeof batch, "dataHash">, { fee: FEE });
    expect(sentMsg().dataHash.length).toBe(0);
    expect(sentMsg().anchorSignature.length).toBe(4627);
  });

  it("never signs with anchor: 'off'", async () => {
    const { rdk, address } = await hybridClient();
    stubRollup(address);
    await rdk.submitBatch(batch, { fee: FEE, anchor: "off" });
    expect(sentMsg().anchorSignature.length).toBe(0);
  });

  it("sends an explicit anchorSignature as given — the separate-sequencer path", async () => {
    const { rdk } = await hybridClient();
    stubRollup("qor1someoneelse000000000000000000000000000");
    const outOfBand = new Uint8Array([1, 2, 3, 4]);
    await rdk.submitBatch({ ...batch, anchorSignature: outOfBand }, { fee: FEE });
    expect(Array.from(sentMsg().anchorSignature)).toEqual([1, 2, 3, 4]);
  });
});

function await_import() {
  // Resolved after the vi.mock above has been applied.
  return { anchorSignBytesForBatch: anchorSignBytesForBatchRef, pqcVerify: pqcVerifyRef };
}
