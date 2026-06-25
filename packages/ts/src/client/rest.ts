/**
 * Typed read client over the `rdk` REST (LCD) routes. This is the gRPC-gateway
 * HTTP surface, so it mirrors the gRPC query service one-to-one.
 */
import { defaultFetch, type FetchLike } from "./http";
import {
  mapBatchView,
  mapParamsView,
  mapRollupView,
  type BatchView,
  type ParamsView,
  type RawRecord,
  type RollupView,
} from "./views";

export interface RestClientOptions {
  fetch?: FetchLike;
}

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" ? (value as RawRecord) : {};
}

function asArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? (value as RawRecord[]) : [];
}

export class RestClient {
  private readonly base: string;
  private readonly fetch: FetchLike;

  constructor(baseUrl: string, options: RestClientOptions = {}) {
    this.base = baseUrl.replace(/\/+$/, "");
    this.fetch = options.fetch ?? defaultFetch;
  }

  private async get(path: string): Promise<RawRecord> {
    const res = await this.fetch(`${this.base}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`REST GET ${path} failed: ${res.status} ${res.statusText}`);
    }
    return asRecord(await res.json());
  }

  /** Live module parameters. */
  async getParams(): Promise<ParamsView> {
    const body = await this.get("/qorechain/rdk/v1/params");
    return mapParamsView(asRecord(body.params ?? body));
  }

  /** A single rollup's configuration and status. */
  async getRollup(rollupId: string): Promise<RollupView> {
    const body = await this.get(`/qorechain/rdk/v1/rollup/${encodeURIComponent(rollupId)}`);
    return mapRollupView(asRecord(body.rollup ?? body));
  }

  /** All registered rollups. */
  async listRollups(): Promise<RollupView[]> {
    const body = await this.get("/qorechain/rdk/v1/rollups");
    return asArray(body.rollups).map(mapRollupView);
  }

  /** A settlement batch by index. */
  async getBatch(rollupId: string, batchIndex: number | bigint): Promise<BatchView> {
    const body = await this.get(
      `/qorechain/rdk/v1/batch/${encodeURIComponent(rollupId)}/${batchIndex}`,
    );
    return mapBatchView(asRecord(body.batch ?? body));
  }

  /** All settlement batches for a rollup. */
  async listBatches(rollupId: string): Promise<BatchView[]> {
    const body = await this.get(`/qorechain/rdk/v1/batches/${encodeURIComponent(rollupId)}`);
    return asArray(body.batches).map(mapBatchView);
  }

  /** The latest settlement batch for a rollup. */
  async getLatestBatch(rollupId: string): Promise<BatchView> {
    const body = await this.get(
      `/qorechain/rdk/v1/batches/${encodeURIComponent(rollupId)}?latest=true`,
    );
    return mapBatchView(asRecord(body.batch ?? body));
  }

  /** Raw data-availability blob details (status, size, expiry). */
  async getBlob(rollupId: string, blobIndex: number | bigint): Promise<RawRecord> {
    return this.get(`/qorechain/rdk/v1/blob/${encodeURIComponent(rollupId)}/${blobIndex}`);
  }
}
