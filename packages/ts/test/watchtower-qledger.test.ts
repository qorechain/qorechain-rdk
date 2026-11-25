import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  QledgerLedger,
  bytesToHex,
  checkQledgerFraud,
  createRdkClient,
  executeQledger,
  hexToBytes,
  inboxRangeHash,
  qledgerAccumulate,
  qledgerFraudProofForBatch,
  qledgerValidator,
  transitionRootValidator,
  validatorForRollup,
  type BatchView,
  type QledgerEntry,
  type QledgerEntryReader,
} from "../src";
import { mockFetch } from "./mock-fetch";

// The fixture's qledger batch: 11 inbox entries (sequences 4 to 14), settled
// from the empty ledger, with the roots the chain accepted.
const q = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/v328.json", import.meta.url)), "utf8"),
).qledger;
const env = { chainId: q.chainId as string, rollupId: q.rollupId as string };
const strip = (h: string): string => h.replace(/^0x/, "").toLowerCase();
const entries: QledgerEntry[] = q.entries.map(
  (e: { height: number; poster: string; payload: string }) => ({
    height: e.height,
    poster: e.poster,
    payload: hexToBytes(e.payload),
  }),
);
const START: number = q.batch.inboxStart;
const END: number = q.batch.inboxEnd;

/** Entries `from + 1` to `to`, as a node's transaction index would return them. */
const reader =
  (list: QledgerEntry[] = entries): QledgerEntryReader =>
  async ({ from, to }) =>
    list.slice(Number(from) - START, Number(to) - START);

interface RawBatch {
  batch_index: number;
  status: string;
  prev_state_root: string;
  state_root: string;
  withdrawals_root: string;
  data_hash: string;
  tx_count: number;
  inbox_start: number;
  inbox_end: number;
  submitted_at: number;
  withdrawals_bound: boolean;
}

const honestBatch: RawBatch = {
  batch_index: 0,
  status: "submitted",
  prev_state_root: strip(q.emptyRoot),
  state_root: strip(q.batch.stateRoot),
  withdrawals_root: strip(q.batch.withdrawalsRoot),
  data_hash: strip(q.batch.dataHash),
  tx_count: entries.length,
  inbox_start: START,
  inbox_end: END,
  submitted_at: 100,
  withdrawals_bound: true,
};

/** A node serving one qledger-v1 rollup: its batches and the inbox accumulator after each post. */
function node(batches: RawBatch[], accs: Record<number, string>, executionVm = "qledger-v1") {
  const { fetch, calls } = mockFetch((call) => {
    const u = new URL(call.url);
    if (u.pathname.includes("/rollup/"))
      return {
        json: { rollup: { rollup_id: env.rollupId, execution_vm: executionVm, status: "active" } },
      };
    if (u.pathname.includes("/batches/")) return { json: { batches, next_index: 0 } };
    const posted = /\/posted_data\/[^/]+\/(\d+)$/.exec(u.pathname);
    if (posted) {
      const acc = accs[Number(posted[1])];
      return acc
        ? { json: { posted_data: { sequence: posted[1], inbox_acc: acc } } }
        : { ok: false, status: 404, json: { code: 5, message: "not found" } };
    }
    if (u.pathname.includes("/applied_plan/")) return { json: { height: "1" } };
    return { json: {} };
  });
  const client = createRdkClient({
    endpoints: { rest: "https://r", rpc: "https://rpc" },
    network: "testnet",
    fetch,
  });
  return { client, calls };
}

const accsOneBatch = { [START]: strip(q.batch.accFrom) };

async function batchView(client: ReturnType<typeof node>["client"], index = 0): Promise<BatchView> {
  const b = (await client.rest.listBatches(env.rollupId)).find((x) => x.batchIndex === index);
  if (!b) throw new Error(`no batch ${index}`);
  return b;
}

describe("watching a qledger-v1 rollup", () => {
  it("the transition-root rule reports this honest qledger-v1 batch as invalid (why qledgerValidator exists)", async () => {
    const { client } = node([honestBatch], accsOneBatch);
    expect(await transitionRootValidator(client, env.rollupId)(await batchView(client))).toBe(
      false,
    );
  });

  it("qledgerValidator accepts the honest batch, and there is no proof to send against it", async () => {
    const { client } = node([honestBatch], accsOneBatch);
    const b = await batchView(client);
    expect(await qledgerValidator(client, env.rollupId, { readEntries: reader() })(b)).toBe(true);
    expect(
      await qledgerFraudProofForBatch(client, env.rollupId, b, { readEntries: reader() }),
    ).toBeUndefined();
  });

  it("a wrong state root is rejected, with a proof the chain's own check upholds", async () => {
    const wrong = { ...honestBatch, state_root: "ab".repeat(32) };
    const { client } = node([wrong], accsOneBatch);
    const b = await batchView(client);
    expect(await qledgerValidator(client, env.rollupId, { readEntries: reader() })(b)).toBe(false);
    const proof = await qledgerFraudProofForBatch(client, env.rollupId, b, {
      readEntries: reader(),
    });
    expect(proof).toBeInstanceOf(Uint8Array);
    const claim = {
      inboxStart: START,
      inboxEnd: END,
      dataHash: wrong.data_hash,
      prevStateRoot: wrong.prev_state_root,
      stateRoot: wrong.state_root,
      withdrawalsRoot: wrong.withdrawals_root,
    };
    expect(checkQledgerFraud(env, claim, proof!)).toBe(true);
    // The same proof does not win against the honest roots.
    expect(checkQledgerFraud(env, { ...claim, stateRoot: honestBatch.state_root }, proof!)).toBe(
      false,
    );
  });

  it("a wrong withdrawals root is rejected", async () => {
    const wrong = { ...honestBatch, withdrawals_root: "cd".repeat(32) };
    const { client } = node([wrong], accsOneBatch);
    expect(
      await qledgerValidator(client, env.rollupId, { readEntries: reader() })(
        await batchView(client),
      ),
    ).toBe(false);
  });

  it("entries that do not belong to the batch leave it undecided rather than invalid", async () => {
    const { client } = node([honestBatch], accsOneBatch);
    const short = entries.slice(0, -1);
    await expect(
      qledgerValidator(client, env.rollupId, { readEntries: async () => short })(
        await batchView(client),
      ),
    ).rejects.toThrow(/does not apply/);
  });

  describe("across batches", () => {
    // Split the fixture's entries into two batches and settle them in turn.
    const cut = 5;
    const first = entries.slice(0, cut);
    const second = entries.slice(cut);
    const mid = START + cut;
    const ledger = new QledgerLedger();
    const r1 = executeQledger(env, ledger, first);
    const r2 = executeQledger(env, ledger, second);
    const accMid = qledgerAccumulate({
      ...env,
      from: START,
      to: mid,
      accFrom: q.batch.accFrom,
      entries: first,
    });
    const accEnd = qledgerAccumulate({
      ...env,
      from: mid,
      to: END,
      accFrom: accMid,
      entries: second,
    });
    const dataHash = (from: number, to: number, accFrom: Uint8Array | string, accTo: Uint8Array) =>
      bytesToHex(inboxRangeHash({ ...env, from, to, accFrom, accTo }));
    const b0: RawBatch = {
      ...honestBatch,
      state_root: bytesToHex(r1.stateRoot),
      withdrawals_root: bytesToHex(r1.withdrawalsRoot),
      data_hash: dataHash(START, mid, q.batch.accFrom, accMid),
      tx_count: first.length,
      inbox_end: mid,
    };
    const b1: RawBatch = {
      ...honestBatch,
      batch_index: 1,
      prev_state_root: bytesToHex(r1.stateRoot),
      state_root: bytesToHex(r2.stateRoot),
      withdrawals_root: bytesToHex(r2.withdrawalsRoot),
      data_hash: dataHash(mid, END, accMid, accEnd),
      tx_count: second.length,
      inbox_start: mid,
      submitted_at: 101,
    };
    const accs = { [START]: strip(q.batch.accFrom), [mid]: bytesToHex(accMid) };

    it("rebuilds the parent state by replaying earlier batches", async () => {
      const { client } = node([b0, b1], accs);
      const ranges: string[] = [];
      const read: QledgerEntryReader = async (r) => {
        ranges.push(`${r.from}-${r.to}`);
        return reader()(r);
      };
      const validate = qledgerValidator(client, env.rollupId, { readEntries: read });
      expect(await validate(await batchView(client, 1))).toBe(true);
      expect(ranges).toEqual([`${START}-${mid}`, `${mid}-${END}`]);
      // The state after batch 1 is now known, so judging it again reads only its own entries.
      ranges.length = 0;
      expect(await validate(await batchView(client, 1))).toBe(true);
      expect(ranges).toEqual([`${mid}-${END}`]);
    });

    it("a batch built on a root no honest replay reaches is left undecided; the earlier batch is the one flagged", async () => {
      const bad0 = { ...b0, state_root: "ef".repeat(32) };
      const on0 = { ...b1, prev_state_root: bad0.state_root };
      const { client } = node([bad0, on0], accs);
      const validate = qledgerValidator(client, env.rollupId, { readEntries: reader() });
      expect(await validate(await batchView(client, 0))).toBe(false);
      await expect(validate(await batchView(client, 1))).rejects.toThrow(/no honest replay/);
    });

    it("skips rejected batches while replaying", async () => {
      const rejected = { ...b0, batch_index: 0, status: "rejected", state_root: "ef".repeat(32) };
      const resubmitted = { ...b0, batch_index: 0 };
      const { client } = node([rejected, resubmitted, b1], accs);
      expect(
        await qledgerValidator(client, env.rollupId, { readEntries: reader() })(
          await batchView(client, 1),
        ),
      ).toBe(true);
    });
  });

  it("validatorForRollup picks the rule the chain applies", async () => {
    const qledger = node([honestBatch], accsOneBatch);
    const chosen = await validatorForRollup(qledger.client, env.rollupId, {
      readEntries: reader(),
    });
    expect(chosen.rule).toBe("qledger-v1");
    expect(await chosen.validate(await batchView(qledger.client))).toBe(true);
    const other = node([honestBatch], accsOneBatch, "evm");
    expect((await validatorForRollup(other.client, env.rollupId)).rule).toBe("transition-root");
  });
});
