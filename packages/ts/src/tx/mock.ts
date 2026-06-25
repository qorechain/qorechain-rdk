/**
 * A mock tx backend — the offline "devnet" equivalent. Drop it into
 * `RdkTxClient.fromClient(new MockTxClient(), address)` to exercise the full
 * create/submit/lifecycle flow without a node: it records every call and returns
 * a successful, fake transaction result.
 */
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { DeliverTxResponse } from "@cosmjs/stargate";
import type { SignAndBroadcastCapable, TxFee } from "./client";

export interface MockCall {
  signerAddress: string;
  messages: readonly EncodeObject[];
  fee: TxFee;
  memo?: string;
}

export interface MockTxClientOptions {
  /** Gas returned from `simulate` and reported as used. Default 120000. */
  gasEstimate?: number;
  /** Fields to merge into the fake response (e.g. a custom transactionHash). */
  response?: Partial<DeliverTxResponse>;
}

export class MockTxClient implements SignAndBroadcastCapable {
  /** Every signAndBroadcast call, in order. */
  readonly calls: MockCall[] = [];
  private readonly gasEstimate: number;
  private readonly response: Partial<DeliverTxResponse>;

  constructor(options: MockTxClientOptions = {}) {
    this.gasEstimate = options.gasEstimate ?? 120000;
    this.response = options.response ?? {};
  }

  async signAndBroadcast(
    signerAddress: string,
    messages: readonly EncodeObject[],
    fee: TxFee,
    memo?: string,
  ): Promise<DeliverTxResponse> {
    this.calls.push({ signerAddress, messages, fee, memo });
    return {
      code: 0,
      height: 1,
      txIndex: 0,
      transactionHash: "MOCK_TX_HASH",
      events: [],
      rawLog: "",
      msgResponses: [],
      gasUsed: BigInt(this.gasEstimate),
      gasWanted: BigInt(this.gasEstimate),
      ...this.response,
    } as DeliverTxResponse;
  }

  async simulate(): Promise<number> {
    return this.gasEstimate;
  }
}
