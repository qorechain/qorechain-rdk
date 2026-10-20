/**
 * `RdkClient` — the high-level entry point. Resolves a network, composes the
 * REST and `qor_` JSON-RPC read clients, exposes the QCAI-assisted profile
 * suggestion, and connects a signing tx client.
 */
import type { OfflineSigner } from "@cosmjs/proto-signing";
import type { NetworkName } from "../constants";
import { getNetwork, type Endpoints, type NetworkConfig } from "../config/networks";
import { suggestProfile, type ProfileSuggestion } from "../profiles/suggest";
import { RdkTxClient, type RdkTxClientConnectOptions } from "../tx/client";
import { QorClient } from "./jsonrpc";
import { RestClient } from "./rest";
import { defaultFetch, type FetchLike } from "./http";
import type { ChainTip } from "../lifecycle/state-machine";
import type { ParamsView } from "./views";
import type { ProfileName } from "../config/enums";

export interface CreateRdkClientOptions {
  /** Network preset (default `testnet`). */
  network?: NetworkName;
  /** Endpoint overrides; merged onto the network preset's defaults. */
  endpoints?: Partial<Endpoints>;
  /** Custom fetch (for testing or non-standard environments). */
  fetch?: FetchLike;
}

export class RdkClient {
  /** The resolved network (chain id and endpoints). */
  readonly network: NetworkConfig;
  /** REST (LCD) read client. */
  readonly rest: RestClient;
  /** `qor_` JSON-RPC client. */
  readonly qor: QorClient;

  private readonly fetchImpl: FetchLike;

  constructor(options: CreateRdkClientOptions = {}) {
    const net = getNetwork(options.network ?? "testnet");
    net.endpoints = { ...net.endpoints, ...options.endpoints };
    this.network = net;
    this.fetchImpl = options.fetch ?? defaultFetch;
    this.rest = new RestClient(net.endpoints.rest, { fetch: options.fetch });
    this.qor = new QorClient(net.endpoints.evmRpc, { fetch: options.fetch });
  }

  /**
   * The chain tip — latest block height and its block time — read from the
   * consensus RPC's `/status`. A challenge window is judged against this, not
   * against the local clock: on the block-count path the chain counts heights,
   * and on the time-based path it compares block time, which can lag wall time.
   */
  async getChainTip(): Promise<ChainTip> {
    const url = `${this.network.endpoints.rpc.replace(/\/+$/, "")}/status`;
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`could not read the chain tip from ${url} (HTTP ${res.status})`);
    const body = (await res.json()) as {
      result?: { sync_info?: { latest_block_height?: string; latest_block_time?: string } };
    };
    const info = body.result?.sync_info;
    const height = Number(info?.latest_block_height ?? NaN);
    const timeMs = Date.parse(info?.latest_block_time ?? "");
    if (!Number.isFinite(height) || !Number.isFinite(timeMs)) {
      throw new Error(`the node at ${url} did not report a latest block height and time`);
    }
    return { height, timeSecs: Math.floor(timeMs / 1000) };
  }

  /** Read the live `rdk` module parameters from the chain. */
  params(): Promise<ParamsView> {
    return this.rest.getParams();
  }

  /** QCAI-assisted profile suggestion, with a documented fallback to `defi`. */
  suggestProfile(useCase: string, opts?: { fallback?: ProfileName }): Promise<ProfileSuggestion> {
    return suggestProfile(useCase, this.qor, opts);
  }

  /**
   * Connect a signing tx client at the consensus RPC endpoint.
   *
   * `rest` defaults to this network's REST endpoint, so hybrid (post-quantum)
   * signing with the default `signBytesVersion: "auto"` works out of the box;
   * an explicit `rest` or `signBytesVersion` from the caller always wins.
   */
  connectTx(signer: OfflineSigner, opts?: RdkTxClientConnectOptions): Promise<RdkTxClient> {
    return RdkTxClient.connect(this.network.endpoints.rpc, signer, {
      ...opts,
      rest: opts?.rest ?? this.network.endpoints.rest,
    });
  }
}

/** Create an {@link RdkClient}. Defaults to the public testnet. */
export function createRdkClient(options: CreateRdkClientOptions = {}): RdkClient {
  return new RdkClient(options);
}
