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
import type { FetchLike } from "./http";
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

  constructor(options: CreateRdkClientOptions = {}) {
    const net = getNetwork(options.network ?? "testnet");
    net.endpoints = { ...net.endpoints, ...options.endpoints };
    this.network = net;
    this.rest = new RestClient(net.endpoints.rest, { fetch: options.fetch });
    this.qor = new QorClient(net.endpoints.evmRpc, { fetch: options.fetch });
  }

  /** Read the live `rdk` module parameters from the chain. */
  params(): Promise<ParamsView> {
    return this.rest.getParams();
  }

  /** QCAI-assisted profile suggestion, with a documented fallback to `defi`. */
  suggestProfile(useCase: string, opts?: { fallback?: ProfileName }): Promise<ProfileSuggestion> {
    return suggestProfile(useCase, this.qor, opts);
  }

  /** Connect a signing tx client at the consensus RPC endpoint. */
  connectTx(signer: OfflineSigner, opts?: RdkTxClientConnectOptions): Promise<RdkTxClient> {
    return RdkTxClient.connect(this.network.endpoints.rpc, signer, opts);
  }
}

/** Create an {@link RdkClient}. Defaults to the public testnet. */
export function createRdkClient(options: CreateRdkClientOptions = {}): RdkClient {
  return new RdkClient(options);
}
