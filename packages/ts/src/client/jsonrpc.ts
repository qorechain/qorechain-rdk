/**
 * Client for the custom `qor_` JSON-RPC namespace (served at the EVM JSON-RPC
 * endpoint): rollup status, batch status, the QCAI-assisted profile suggestion,
 * and DA blob status.
 */
import { defaultFetch, type FetchLike } from "./http";
import type { RawRecord } from "./views";

export interface QorClientOptions {
  fetch?: FetchLike;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

export class QorClient {
  private readonly url: string;
  private readonly fetch: FetchLike;
  private id = 0;

  constructor(url: string, options: QorClientOptions = {}) {
    this.url = url;
    this.fetch = options.fetch ?? defaultFetch;
  }

  /** Make a raw `qor_*` JSON-RPC call. */
  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const res = await this.fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    if (!res.ok) {
      throw new Error(`JSON-RPC ${method} failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as JsonRpcResponse<T>;
    if (body.error) {
      throw new Error(`JSON-RPC ${method} error ${body.error.code}: ${body.error.message}`);
    }
    return body.result as T;
  }

  /** Rollup configuration, status, and settlement mode. */
  getRollupStatus(rollupId: string): Promise<RawRecord> {
    return this.call<RawRecord>("qor_getRollupStatus", [rollupId]);
  }

  /** All registered rollups with a status summary. */
  listRollups(): Promise<RawRecord[] | RawRecord> {
    return this.call<RawRecord[] | RawRecord>("qor_listRollups", []);
  }

  /** Settlement batch details and finalization status. */
  getSettlementBatch(rollupId: string, batchIndex: number | bigint): Promise<RawRecord> {
    return this.call<RawRecord>("qor_getSettlementBatch", [rollupId, Number(batchIndex)]);
  }

  /** QCAI-assisted rollup profile recommendation for a use-case description. */
  suggestRollupProfile(useCase: string): Promise<unknown> {
    return this.call<unknown>("qor_suggestRollupProfile", [useCase]);
  }

  /** Data-availability blob storage status. */
  getDABlobStatus(rollupId: string, blobIndex: number | bigint): Promise<RawRecord> {
    return this.call<RawRecord>("qor_getDABlobStatus", [rollupId, Number(blobIndex)]);
  }
}
