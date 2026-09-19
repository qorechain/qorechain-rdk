/**
 * `RdkTxClient` — submits `rdk` transactions (rollup lifecycle, settlement
 * batches, withdrawals) through a `@cosmjs` signing client configured with the
 * `rdk` registry.
 *
 * Two signing paths:
 *
 * - **Classical** (default) — a standard `@cosmjs` `OfflineSigner` signs with
 *   SIGN_MODE_DIRECT and the connected `SigningStargateClient` broadcasts.
 * - **Hybrid (post-quantum)** — pass `pqcKeypair` on connect. The transaction is
 *   then built, signed, and broadcast by
 *   [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk)'s
 *   `signAndBroadcastHybrid`, which attaches the ML-DSA-87 half as a tx-body
 *   extension alongside the classical secp256k1 signature. Networks that
 *   require the post-quantum signature on native-lane transactions only accept
 *   this path.
 *
 * `@qorechain/sdk`'s `directSignerFromPrivateKey` provides a suitable
 * `OfflineDirectSigner`; any compatible one works.
 */
import {
  GasPrice,
  SigningStargateClient,
  calculateFee,
  type DeliverTxResponse,
  type StdFee,
} from "@cosmjs/stargate";
import type {
  EncodeObject,
  OfflineSigner,
  OfflineDirectSigner,
} from "@cosmjs/proto-signing";
import {
  signAndBroadcastHybrid,
  type PqcKeypair,
  type SignBytesVersionOption,
} from "@qorechain/sdk";
import type { RollupStatus } from "../config/enums";
import { assertRollupAction } from "../lifecycle/state-machine";
import { createRdkRegistry } from "./registry";
import * as msgs from "./messages";

/** A transaction fee: an explicit `StdFee`, a gas number, or `"auto"`. */
export type TxFee = StdFee | number | "auto";

/** The multiplier applied to a simulated gas estimate for an `"auto"` fee. */
const GAS_MULTIPLIER = 1.4;

/** The signing capability `RdkTxClient` depends on (satisfied by `SigningStargateClient`). */
export interface SignAndBroadcastCapable {
  signAndBroadcast(
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: TxFee,
    memo?: string,
  ): Promise<DeliverTxResponse>;
}

/** Optional gas-simulation capability (also satisfied by `SigningStargateClient`). */
export interface SimulateCapable {
  simulate(
    signerAddress: string,
    messages: readonly EncodeObject[],
    memo: string | undefined,
  ): Promise<number>;
}

/**
 * The extra capabilities the hybrid (post-quantum) path needs from the
 * connected client: the chain id, the signer's account number/sequence, and raw
 * transaction broadcast. `SigningStargateClient` (and `StargateClient`) satisfy
 * all of them.
 */
export interface HybridTxCapable {
  getChainId(): Promise<string>;
  getSequence(
    address: string,
  ): Promise<{ accountNumber: number | bigint; sequence: number | bigint }>;
  broadcastTx(
    tx: Uint8Array,
    timeoutMs?: number,
    pollIntervalMs?: number,
  ): Promise<{
    code: number;
    transactionHash: string;
    height?: number;
    gasUsed?: bigint;
    gasWanted?: bigint;
    rawLog?: string;
  }>;
  broadcastTxSync(tx: Uint8Array): Promise<string>;
}

/**
 * Post-quantum signing configuration. Supplying {@link pqcKeypair} switches the
 * client to the hybrid path; everything else is optional tuning.
 */
export interface HybridSigningOptions {
  /**
   * The ML-DSA-87 (Dilithium-5) keypair providing the post-quantum half of the
   * signature. When present, every transaction this client sends is signed
   * hybrid.
   *
   * The key is expected to already be registered on chain (via
   * `MsgRegisterPQCKey`) unless {@link includePqcPublicKey} is set.
   */
  pqcKeypair?: PqcKeypair;
  /**
   * The network's REST (LCD) base URL, used by `signBytesVersion: "auto"` to
   * ask the network which hybrid sign-bytes form it expects. `RdkClient.connectTx`
   * fills this in from the network preset.
   */
  rest?: string;
  /**
   * Which hybrid sign-bytes form to sign. `"auto"` (the default) asks the
   * network over `rest`; `"v1"` / `"v2"` force a form — useful when a network's
   * upgrade plan name differs from what `"auto"` looks up.
   */
  signBytesVersion?: SignBytesVersionOption;
  /**
   * Embed the ML-DSA-87 public key in the extension so the chain can register
   * it on first use. Defaults to `false`.
   */
  includePqcPublicKey?: boolean;
}

export interface RdkTxClientConnectOptions extends HybridSigningOptions {
  /** Gas price for `"auto"` fee estimation, e.g. `"0.15uqor"`. */
  gasPrice?: GasPrice | string;
}

export interface TxOptions {
  /** Fee override; defaults to `"auto"` (requires a gas price on connect). */
  fee?: TxFee;
  /** Optional memo. */
  memo?: string;
}

/** Resolved hybrid configuration held by a client that signs post-quantum. */
interface HybridConfig {
  signer: OfflineDirectSigner;
  pqcKeypair: PqcKeypair;
  rest?: string;
  signBytesVersion?: SignBytesVersionOption;
  includePqcPublicKey?: boolean;
}

function asDirectSigner(signer: OfflineSigner): OfflineDirectSigner {
  if (typeof (signer as Partial<OfflineDirectSigner>).signDirect !== "function") {
    throw new Error(
      "hybrid (post-quantum) signing requires an OfflineDirectSigner (SIGN_MODE_DIRECT); " +
        "the signer provided has no signDirect — amino-only signers cannot carry the " +
        "PQC signature extension. Use directSignerFromPrivateKey from @qorechain/sdk.",
    );
  }
  return signer as OfflineDirectSigner;
}

/** Build the hybrid config from connect options, or `undefined` for the classical path. */
function hybridConfigFrom(
  signer: OfflineSigner,
  options: HybridSigningOptions,
): HybridConfig | undefined {
  if (!options.pqcKeypair) return undefined;
  return {
    signer: asDirectSigner(signer),
    pqcKeypair: options.pqcKeypair,
    rest: options.rest,
    signBytesVersion: options.signBytesVersion,
    includePqcPublicKey: options.includePqcPublicKey,
  };
}

export class RdkTxClient {
  private constructor(
    private readonly client: SignAndBroadcastCapable &
      Partial<SimulateCapable> &
      Partial<HybridTxCapable>,
    /** The signing/operator address used as the message signer. */
    readonly address: string,
    private readonly hybrid?: HybridConfig,
    private readonly gasPrice?: GasPrice,
  ) {}

  /** Whether this client signs hybrid (post-quantum) transactions. */
  get isHybrid(): boolean {
    return this.hybrid !== undefined;
  }

  /**
   * Estimate gas for a set of messages without broadcasting — the basis for a
   * dry run. Throws if the underlying client does not support simulation.
   */
  async simulate(messages: readonly EncodeObject[], memo?: string): Promise<number> {
    if (typeof this.client.simulate !== "function") {
      throw new Error("the underlying client does not support simulation");
    }
    return this.client.simulate(this.address, messages, memo);
  }

  /** Connect a signing client at a consensus RPC endpoint with the `rdk` registry. */
  static async connect(
    rpcUrl: string,
    signer: OfflineSigner,
    options: RdkTxClientConnectOptions = {},
  ): Promise<RdkTxClient> {
    const gasPrice =
      typeof options.gasPrice === "string"
        ? GasPrice.fromString(options.gasPrice)
        : options.gasPrice;
    // Validate the signer before opening a connection, so a misconfigured
    // hybrid setup fails fast with a clear message.
    const hybrid = hybridConfigFrom(signer, options);
    const client = await SigningStargateClient.connectWithSigner(rpcUrl, signer, {
      registry: createRdkRegistry(),
      gasPrice,
    });
    const accounts = await signer.getAccounts();
    if (accounts.length === 0) {
      throw new Error("signer has no accounts");
    }
    return new RdkTxClient(client, accounts[0].address, hybrid, gasPrice);
  }

  /**
   * Wrap an existing sign-and-broadcast client (advanced use and testing).
   *
   * Pass `options.pqcKeypair` together with an `OfflineDirectSigner` to exercise
   * the hybrid path against a custom transport; the client must then also
   * satisfy {@link HybridTxCapable}.
   */
  static fromClient(
    client: SignAndBroadcastCapable & Partial<SimulateCapable> & Partial<HybridTxCapable>,
    address: string,
    options: RdkTxClientConnectOptions & { signer?: OfflineSigner } = {},
  ): RdkTxClient {
    const gasPrice =
      typeof options.gasPrice === "string"
        ? GasPrice.fromString(options.gasPrice)
        : options.gasPrice;
    let hybrid: HybridConfig | undefined;
    if (options.pqcKeypair) {
      if (!options.signer) {
        throw new Error("hybrid signing requires `signer` (an OfflineDirectSigner)");
      }
      hybrid = hybridConfigFrom(options.signer, options);
    }
    return new RdkTxClient(client, address, hybrid, gasPrice);
  }

  /**
   * Turn the caller's {@link TxFee} into the explicit `StdFee` the hybrid
   * builder requires: an `StdFee` passes through, a number is a gas limit, and
   * `"auto"` simulates and applies the standard multiplier.
   */
  private async resolveFee(
    messages: readonly EncodeObject[],
    fee: TxFee,
    memo: string | undefined,
  ): Promise<StdFee> {
    if (typeof fee === "object") return fee;
    if (!this.gasPrice) {
      throw new Error(
        "hybrid signing needs an explicit fee: pass `fee` as an StdFee in the transaction " +
          'options, or set `gasPrice` on connect (e.g. "0.15uqor") so a gas limit or "auto" ' +
          "can be priced.",
      );
    }
    if (typeof fee === "number") return calculateFee(fee, this.gasPrice);
    const gas = await this.simulate(messages, memo);
    return calculateFee(Math.round(gas * GAS_MULTIPLIER), this.gasPrice);
  }

  /** Sign and broadcast hybrid, mapping the SDK result onto cosmjs's shape. */
  private async broadcastHybrid(
    hybrid: HybridConfig,
    messages: EncodeObject[],
    opts: TxOptions,
  ): Promise<DeliverTxResponse> {
    const transport = this.client as Partial<HybridTxCapable>;
    if (
      typeof transport.getChainId !== "function" ||
      typeof transport.getSequence !== "function" ||
      typeof transport.broadcastTx !== "function"
    ) {
      throw new Error(
        "the underlying client cannot sign hybrid transactions: it must provide " +
          "getChainId, getSequence, and broadcastTx (a connected StargateClient does).",
      );
    }
    const memo = opts.memo ?? "";
    const fee = await this.resolveFee(messages, opts.fee ?? "auto", opts.memo);
    const chainId = await transport.getChainId();
    const { accountNumber, sequence } = await transport.getSequence(this.address);

    const result = await signAndBroadcastHybrid({
      registry: createRdkRegistry(),
      signer: hybrid.signer,
      pqcKeypair: hybrid.pqcKeypair,
      messages,
      fee,
      memo,
      chainId,
      accountNumber,
      sequence,
      includePqcPublicKey: hybrid.includePqcPublicKey,
      signBytesVersion: hybrid.signBytesVersion ?? "auto",
      rest: hybrid.rest,
      transport: transport as HybridTxCapable,
    });

    return {
      code: result.code,
      height: result.height ?? 0,
      txIndex: 0,
      transactionHash: result.transactionHash,
      events: (result.events ?? []) as DeliverTxResponse["events"],
      rawLog: result.rawLog,
      msgResponses: [],
      gasUsed: result.gasUsed ?? BigInt(0),
      gasWanted: result.gasWanted ?? BigInt(0),
    };
  }

  private broadcast(messages: EncodeObject[], opts: TxOptions = {}): Promise<DeliverTxResponse> {
    if (this.hybrid) {
      return this.broadcastHybrid(this.hybrid, messages, opts);
    }
    return this.client.signAndBroadcast(this.address, messages, opts.fee ?? "auto", opts.memo ?? "");
  }

  /** Create a rollup. The client's address is the creator. */
  createRollup(
    input: Omit<msgs.CreateRollupInput, "creator">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    return this.broadcast([msgs.createRollupMsg({ creator: this.address, ...input })], opts);
  }

  /** Submit a settlement batch. The client's address is the sequencer. */
  submitBatch(
    input: Omit<msgs.SubmitBatchInput, "sequencer">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    return this.broadcast([msgs.submitBatchMsg({ sequencer: this.address, ...input })], opts);
  }

  /** Challenge an optimistic batch with a fraud proof. */
  challengeBatch(
    input: Omit<msgs.ChallengeBatchInput, "challenger">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    return this.broadcast([msgs.challengeBatchMsg({ challenger: this.address, ...input })], opts);
  }

  /** Resolve an open challenge (upheld or dismissed). */
  resolveChallenge(
    input: Omit<msgs.ResolveChallengeInput, "resolver">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    return this.broadcast([msgs.resolveChallengeMsg({ resolver: this.address, ...input })], opts);
  }

  /** Pause an active rollup. Pass `currentStatus` to guard the transition. */
  async pauseRollup(
    input: { rollupId: string; reason?: string; currentStatus?: RollupStatus },
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    if (input.currentStatus) assertRollupAction("pause", input.currentStatus);
    return this.broadcast(
      [msgs.pauseRollupMsg({ creator: this.address, rollupId: input.rollupId, reason: input.reason })],
      opts,
    );
  }

  /** Resume a paused rollup. Pass `currentStatus` to guard the transition. */
  async resumeRollup(
    input: { rollupId: string; currentStatus?: RollupStatus },
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    if (input.currentStatus) assertRollupAction("resume", input.currentStatus);
    return this.broadcast(
      [msgs.resumeRollupMsg({ creator: this.address, rollupId: input.rollupId })],
      opts,
    );
  }

  /** Stop a rollup permanently. Pass `currentStatus` to guard the transition. */
  async stopRollup(
    input: { rollupId: string; currentStatus?: RollupStatus },
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    if (input.currentStatus) assertRollupAction("stop", input.currentStatus);
    return this.broadcast(
      [msgs.stopRollupMsg({ creator: this.address, rollupId: input.rollupId })],
      opts,
    );
  }

  /** Execute a finalized-batch withdrawal. The client's address is the submitter. */
  executeWithdrawal(
    input: Omit<msgs.ExecuteWithdrawalInput, "submitter">,
    opts?: TxOptions,
  ): Promise<DeliverTxResponse> {
    return this.broadcast([msgs.executeWithdrawalMsg({ submitter: this.address, ...input })], opts);
  }
}
