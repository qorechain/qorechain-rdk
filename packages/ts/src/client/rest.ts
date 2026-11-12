/**
 * Typed read client over the `rdk` REST (LCD) routes. This is the gRPC-gateway
 * HTTP surface, so it mirrors the gRPC query service one-to-one.
 */
import { defaultFetch, type FetchLike } from "./http";
import {
  mapAnchorView,
  mapBatchView,
  mapInboxView,
  mapKemKeyView,
  mapParamsView,
  mapPostedDataView,
  mapPqcAccountView,
  mapRollupView,
  mapSubmitterBondView,
  type AnchorView,
  type BatchView,
  type InboxView,
  type KemKeyView,
  type ParamsView,
  type PostedDataView,
  type PqcAccountView,
  type RawRecord,
  type RollupView,
  type SubmitterBondView,
} from "./views";

/** One protocol switch as the chain reports it. */
export interface ProtocolFeature {
  name: string;
  enabled: boolean;
}

export interface RestClientOptions {
  fetch?: FetchLike;
}

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" ? (value as RawRecord) : {};
}

function asArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? (value as RawRecord[]) : [];
}

/** An HTTP error from a REST read, with its status (404 = the chain has no such record). */
export class RestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RestError";
  }
}

/** Whether `err` is a REST 404: the record does not exist (or is no longer retained). */
export function isRestNotFound(err: unknown): boolean {
  return err instanceof RestError && err.status === 404;
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
      throw new RestError(`REST GET ${path} failed: ${res.status} ${res.statusText}`, res.status);
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

  /**
   * One page of a rollup's settlement batches, in index order, starting at
   * `startIndex`. The chain returns at most `limit` (default 50, capped at
   * 100) and a `nextIndex` that is `0` when there is no further page.
   */
  async listBatchesPage(
    rollupId: string,
    opts: { startIndex?: number | bigint; limit?: number } = {},
  ): Promise<{ batches: BatchView[]; nextIndex: number }> {
    const q = new URLSearchParams();
    if (opts.startIndex !== undefined) q.set("start_index", String(opts.startIndex));
    if (opts.limit !== undefined) q.set("limit", String(opts.limit));
    const qs = q.toString();
    const body = await this.get(
      `/qorechain/rdk/v1/batches/${encodeURIComponent(rollupId)}${qs ? `?${qs}` : ""}`,
    );
    return {
      batches: asArray(body.batches).map(mapBatchView),
      nextIndex: Number(body.next_index ?? body.nextIndex ?? 0),
    };
  }

  /**
   * All settlement batches for a rollup, following every page.
   *
   * The chain's `Batches` query is paged (50 per page by default). Releases
   * before 0.6.0 read only the first page, so a watcher of a rollup past batch
   * #49 never saw a newer batch. Pass `startIndex` to read only from a given
   * batch onwards, which is what a poller should do.
   */
  async listBatches(rollupId: string, opts: { startIndex?: number | bigint } = {}): Promise<BatchView[]> {
    const out: BatchView[] = [];
    let start: number | bigint | undefined = opts.startIndex;
    // Bounded: a page never comes back empty with a non-zero next index on a
    // well-behaved node, but a misbehaving one must not spin us forever.
    for (let pages = 0; pages < 100_000; pages++) {
      const page = await this.listBatchesPage(rollupId, { startIndex: start, limit: 100 });
      out.push(...page.batches);
      if (page.nextIndex === 0 || page.batches.length === 0) break;
      start = page.nextIndex;
    }
    return out;
  }

  /**
   * The latest settlement batch for a rollup (the chain's `LatestBatch`
   * query).
   *
   * Releases before 0.6.0 requested `/batches/{id}?latest=true`, which is not
   * a chain route: the node ignored the parameter and returned the first page
   * of the list, which was then read as a single empty batch. Anything built on
   * it — notably the health monitor — reported "no batches yet" for every
   * rollup.
   */
  async getLatestBatch(rollupId: string): Promise<BatchView> {
    const body = await this.get(
      `/qorechain/rdk/v1/latest_batch/${encodeURIComponent(rollupId)}`,
    );
    return mapBatchView(asRecord(body.batch ?? body));
  }

  /**
   * The chain's protocol switches (`/qorechain/pqc/v1/protocol_features`):
   * each feature's name and whether it is enabled at the current height.
   * Chains before the route existed answer 404 or 501, which this reports as
   * an error; {@link isProtocolFeatureEnabled} treats that as "not enabled".
   */
  async getProtocolFeatures(): Promise<ProtocolFeature[]> {
    const body = await this.get("/qorechain/pqc/v1/protocol_features");
    const list = Array.isArray(body.features) ? body.features : [];
    return list.map((f) => {
      const r = asRecord(f);
      return { name: String(r.name ?? ""), enabled: r.enabled === true };
    });
  }

  /**
   * Whether the chain reports protocol feature `name` as enabled. A chain
   * that does not serve the feature route has none of the features it lists,
   * so an unavailable route reads as `false`; other errors are raised.
   */
  async isProtocolFeatureEnabled(name: string): Promise<boolean> {
    try {
      return (await this.getProtocolFeatures()).some((f) => f.name === name && f.enabled);
    } catch (err) {
      if (/\b(404|501)\b/.test((err as Error).message)) return false;
      throw err;
    }
  }

  /**
   * The height at which upgrade plan `name` was applied on this chain
   * (`/cosmos/upgrade/v1beta1/applied_plan/{name}`), or 0 if it has not been.
   */
  async getAppliedPlanHeight(name: string): Promise<number> {
    const body = await this.get(`/cosmos/upgrade/v1beta1/applied_plan/${encodeURIComponent(name)}`);
    const h = Number(body.height ?? 0);
    return Number.isFinite(h) && h > 0 ? h : 0;
  }

  /**
   * A rollup's inbox (chain v3.2.8+): head, consumed position, and the
   * `data_hash` a based batch ending at `inboxEnd` must carry (0 = the head).
   */
  async getInbox(rollupId: string, inboxEnd: number | bigint = 0): Promise<InboxView> {
    const q = BigInt(inboxEnd) > 0n ? `?inbox_end=${inboxEnd}` : "";
    const body = await this.get(`/qorechain/rdk/v1/inbox/${encodeURIComponent(rollupId)}${q}`);
    return mapInboxView(asRecord(body.inbox ?? body));
  }

  /** One posted-data commitment (chain v3.2.8+). The payload is in the transaction at `height`. */
  async getPostedData(rollupId: string, sequence: number | bigint): Promise<PostedDataView> {
    const body = await this.get(`/qorechain/rdk/v1/posted_data/${encodeURIComponent(rollupId)}/${sequence}`);
    return mapPostedDataView(asRecord(body.posted_data ?? body.postedData ?? body));
  }

  /** A submitter's bond on a qledger-v1 rollup and when it unlocks (chain v3.2.8+). */
  async getSubmitterBond(rollupId: string, submitter: string): Promise<SubmitterBondView> {
    const body = await this.get(
      `/qorechain/rdk/v1/submitter_bond/${encodeURIComponent(rollupId)}/${encodeURIComponent(submitter)}`,
    );
    return mapSubmitterBondView(body);
  }

  /**
   * The key-encapsulation key `address` published (chain v3.2.5+), or
   * `undefined` when it has none.
   */
  async getKemKey(address: string): Promise<KemKeyView | undefined> {
    const body = await this.get(`/qorechain/pqc/v1/kem/${encodeURIComponent(address)}`);
    if (body.found !== true) return undefined;
    return mapKemKeyView(asRecord(body.key));
  }

  /**
   * The recipients a post on private rollup `rollupId` must be sealed to: its
   * members in order, each with its registered ML-KEM-1024 key, and the
   * membership epoch. Throws if a member has no such key (the chain would
   * refuse any envelope).
   */
  async getPrivateRollupRecipients(
    rollupId: string,
  ): Promise<{ epoch: number; recipients: { member: string; encapsulationKey: string }[] }> {
    const rollup = await this.getRollup(rollupId);
    if (rollup.privacy !== "encapsulated") throw new Error(`rollup ${rollupId} is not private`);
    if (rollup.members.length === 0) throw new Error(`rollup ${rollupId} has no members yet`);
    const recipients: { member: string; encapsulationKey: string }[] = [];
    for (const member of rollup.members) {
      const key = await this.getKemKey(member);
      if (!key || key.algorithmId !== 2) throw new Error(`member ${member} has no ML-KEM-1024 key registered`);
      recipients.push({ member, encapsulationKey: key.publicKey });
    }
    return { epoch: rollup.membersEpoch, recipients };
  }

  /** Raw data-availability blob details (status, size, expiry). */
  async getBlob(rollupId: string, blobIndex: number | bigint): Promise<RawRecord> {
    return this.get(`/qorechain/rdk/v1/blob/${encodeURIComponent(rollupId)}/${blobIndex}`);
  }

  /**
   * The latest state anchor a layer committed to the Main Chain (the
   * `x/multilayer` Anchor query). `layerId` is the rollup's `layer_id`.
   */
  async getAnchor(layerId: string): Promise<AnchorView> {
    const body = await this.get(
      `/qorechain/multilayer/v1/anchor/${encodeURIComponent(layerId)}`,
    );
    return mapAnchorView(asRecord(body.anchor ?? body));
  }

  /** Alias for {@link getAnchor} — the chain's Anchor query returns the latest. */
  async getLatestAnchor(layerId: string): Promise<AnchorView> {
    return this.getAnchor(layerId);
  }

  /** All state anchors a layer has committed (newest first). */
  async getAnchors(layerId: string): Promise<AnchorView[]> {
    const body = await this.get(
      `/qorechain/multilayer/v1/anchors/${encodeURIComponent(layerId)}`,
    );
    return asArray(body.anchors).map(mapAnchorView);
  }

  /**
   * An account's post-quantum key record (the `x/pqc` account query). The
   * `publicKey` is the registered ML-DSA-87 (Dilithium-5) verification key.
   */
  async getPqcAccount(address: string): Promise<PqcAccountView> {
    const body = await this.get(
      `/qorechain/pqc/v1/account/${encodeURIComponent(address)}`,
    );
    return mapPqcAccountView(asRecord(body.account ?? body));
  }

  // --- QCAI advisory reads (the `ai` REST surface) ---

  /** QCAI fee estimate; `urgency` is one of `low` | `normal` | `high` (optional). */
  async getFeeEstimate(urgency?: string): Promise<RawRecord> {
    const q = urgency ? `?urgency=${encodeURIComponent(urgency)}` : "";
    return this.get(`/qorechain/ai/v1/fee-estimate${q}`);
  }

  /** QCAI network recommendations (congestion, suggested settings). */
  async getNetworkRecommendations(): Promise<RawRecord> {
    return this.get("/qorechain/ai/v1/network/recommendations");
  }

  /** Open fraud investigations across the network. */
  async getFraudInvestigations(): Promise<RawRecord[]> {
    const body = await this.get("/qorechain/ai/v1/fraud/investigations");
    return asArray(body.investigations ?? body.data ?? body);
  }

  /** A single fraud investigation by id. */
  async getFraudInvestigation(id: string): Promise<RawRecord> {
    return this.get(`/qorechain/ai/v1/fraud/investigations/${encodeURIComponent(id)}`);
  }

  /** Active QCAI circuit breakers (network safety throttles). */
  async getCircuitBreakers(): Promise<RawRecord> {
    return this.get("/qorechain/ai/v1/circuit-breakers");
  }

  /** An account's balance for a single denom (default `uqor`), as an integer string. */
  async getBalance(address: string, denom = "uqor"): Promise<string> {
    const body = await this.get(
      `/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}/by_denom?denom=${encodeURIComponent(denom)}`,
    );
    const balance = asRecord(body.balance);
    return typeof balance.amount === "string" ? balance.amount : String(balance.amount ?? "0");
  }

  /** All of an account's balances as `{ denom, amount }` records. */
  async getAllBalances(address: string): Promise<{ denom: string; amount: string }[]> {
    const body = await this.get(`/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`);
    return asArray(body.balances).map((c) => ({
      denom: String(c.denom ?? ""),
      amount: String(c.amount ?? "0"),
    }));
  }

  /** A transaction by hash (the raw `/cosmos/tx/v1beta1/txs/{hash}` response). */
  async getTx(hash: string): Promise<RawRecord> {
    return this.get(`/cosmos/tx/v1beta1/txs/${encodeURIComponent(hash)}`);
  }

  /** The node's latest block height (`/cosmos/base/node/v1beta1/status`). */
  async getLatestHeight(): Promise<number> {
    const body = await this.get("/cosmos/base/node/v1beta1/status");
    const h = Number(body.height ?? 0);
    if (!Number.isFinite(h) || h <= 0) throw new Error("the node did not report its height");
    return h;
  }

  /**
   * Every transaction matching an event query (for example
   * `rdk_data_posted.rollup_id='my-rollup'`), as raw `tx_responses`, oldest
   * first. Needs a node with transaction indexing on.
   */
  async searchTxs(query: string, opts: { pageLimit?: number; maxPages?: number } = {}): Promise<RawRecord[]> {
    const limit = opts.pageLimit ?? 100;
    const maxPages = opts.maxPages ?? 50;
    const out: RawRecord[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const body = await this.get(
        `/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(query)}&page=${page}&limit=${limit}&order_by=ORDER_BY_ASC`,
      );
      const txs = asArray(body.tx_responses);
      out.push(...txs);
      const total = Number(body.total ?? 0);
      if (txs.length < limit || (total > 0 && out.length >= total)) break;
    }
    return out;
  }
}
