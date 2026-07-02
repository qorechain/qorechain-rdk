/**
 * `RdkTxClient` — submits `rdk` transactions (rollup lifecycle, settlement
 * batches, withdrawals) through a `@cosmjs` signing client configured with the
 * `rdk` registry.
 *
 * Signing is delegated to a standard `@cosmjs` `OfflineSigner`. The
 * [`@qorechain/sdk`](https://github.com/qorechain/qorechain-sdk) package provides
 * such a signer (including quantum-safe variants) via
 * `directSignerFromPrivateKey`; any compatible `OfflineSigner` works.
 */
import {
  GasPrice,
  SigningStargateClient,
  type DeliverTxResponse,
  type StdFee,
} from "@cosmjs/stargate";
import type { EncodeObject, OfflineSigner } from "@cosmjs/proto-signing";
import type { RollupStatus } from "../config/enums";
import { assertRollupAction } from "../lifecycle/state-machine";
import { createRdkRegistry } from "./registry";
import * as msgs from "./messages";

/** A transaction fee: an explicit `StdFee`, a gas number, or `"auto"`. */
export type TxFee = StdFee | number | "auto";

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

export interface RdkTxClientConnectOptions {
  /** Gas price for `"auto"` fee estimation, e.g. `"0.15uqor"`. */
  gasPrice?: GasPrice | string;
}

export interface TxOptions {
  /** Fee override; defaults to `"auto"` (requires a gas price on connect). */
  fee?: TxFee;
  /** Optional memo. */
  memo?: string;
}

export class RdkTxClient {
  private constructor(
    private readonly client: SignAndBroadcastCapable & Partial<SimulateCapable>,
    /** The signing/operator address used as the message signer. */
    readonly address: string,
  ) {}

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
    const client = await SigningStargateClient.connectWithSigner(rpcUrl, signer, {
      registry: createRdkRegistry(),
      gasPrice,
    });
    const accounts = await signer.getAccounts();
    if (accounts.length === 0) {
      throw new Error("signer has no accounts");
    }
    return new RdkTxClient(client, accounts[0].address);
  }

  /** Wrap an existing sign-and-broadcast client (advanced use and testing). */
  static fromClient(client: SignAndBroadcastCapable, address: string): RdkTxClient {
    return new RdkTxClient(client, address);
  }

  private broadcast(messages: EncodeObject[], opts: TxOptions = {}): Promise<DeliverTxResponse> {
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
