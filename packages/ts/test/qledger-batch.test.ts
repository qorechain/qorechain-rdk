import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BLS12_381_SCALAR_MODULUS,
  QledgerLedger,
  RestClient,
  bytesToHex,
  chooseQledgerBatchEnd,
  decodeQledgerDeposit,
  hexToBytes,
  inboxRangeHash,
  isQledgerCheckpoint,
  planQledgerBatch,
  qledgerAccumulate,
  qledgerBatchErrors,
  qledgerEmptyRoot,
  toCanonicalScalar,
  withdrawalsRootMatches,
  zkPublicInputErrors,
  zkPublicInputs,
  type QledgerEntry,
} from "../src";

const q = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/v328.json", import.meta.url)), "utf8"),
).qledger;
const entries: QledgerEntry[] = q.entries.map((e: { height: number; poster: string; payload: string }) => ({
  height: e.height,
  poster: e.poster,
  payload: hexToBytes(e.payload),
}));

const base = { bond: 2_000_000_000, minBond: 1_000_000_000, pending: 0, endRetained: true };

describe("qledger-v1 admission rules", () => {
  it("checkpoints are non-zero multiples of 64", () => {
    expect([0, 1, 63, 64, 128].map(isQledgerCheckpoint)).toEqual([false, false, false, true, true]);
  });
  it("bond, pending cap, range and size", () => {
    expect(qledgerBatchErrors({ ...base, consumed: 0, head: 10, end: 10 })).toEqual([]);
    expect(qledgerBatchErrors({ ...base, bond: 1, consumed: 0, head: 10, end: 10 }).join()).toMatch(/bond/);
    expect(qledgerBatchErrors({ ...base, pending: 1024, consumed: 0, head: 10, end: 10 }).join()).toMatch(/waiting/);
    expect(qledgerBatchErrors({ ...base, consumed: 5, head: 10, end: 5 }).join()).toMatch(/at least one/);
    expect(qledgerBatchErrors({ ...base, consumed: 0, head: 10, end: 11 }).join()).toMatch(/past the head/);
    expect(qledgerBatchErrors({ ...base, consumed: 0, head: 100, end: 65 }).join()).toMatch(/at most 64/);
    expect(qledgerBatchErrors({ ...base, consumed: 0, head: 100, end: 64 })).toEqual([]);
  });
  it("a short batch before the head stops before a fresh post or at an unretained checkpoint", () => {
    const short = { ...base, consumed: 0, head: 100, end: 10 };
    expect(qledgerBatchErrors({ ...short, nextRetained: true, nextHeight: 990, inclusionHeight: 1000 })).toEqual([]);
    expect(qledgerBatchErrors({ ...short, nextRetained: true, nextHeight: 980, inclusionHeight: 1000 }).join()).toMatch(/post 11 must be in it/);
    expect(qledgerBatchErrors({ ...short, nextRetained: false }).join()).toMatch(/post 11/);
    expect(qledgerBatchErrors({ ...base, consumed: 40, head: 300, end: 64, nextRetained: false })).toEqual([]);
    expect(qledgerBatchErrors({ ...base, consumed: 0, head: 300, end: 20, endRetained: false, nextRetained: false }).join()).toMatch(/no longer retained/);
  });
  it("chooses the end the chain recommends", async () => {
    const all = () => true;
    expect(await chooseQledgerBatchEnd({ consumed: 5, head: 5, retained: all })).toBeUndefined();
    expect(await chooseQledgerBatchEnd({ consumed: 0, head: 10, retained: all })).toBe(10n);
    expect(await chooseQledgerBatchEnd({ consumed: 0, head: 200, retained: all })).toBe(64n);
    // After a long idle period only checkpoints kept their commitments.
    const onlyCheckpoints = (x: bigint) => x % 64n === 0n;
    expect(await chooseQledgerBatchEnd({ consumed: 40, head: 500, retained: onlyCheckpoints })).toBe(64n);
    expect(await chooseQledgerBatchEnd({ consumed: 64, head: 500, retained: onlyCheckpoints })).toBe(128n);
  });
});

describe("Groth16 withdrawals root modulo r", () => {
  const r = BLS12_381_SCALAR_MODULUS;
  const high = (r + 5n).toString(16).padStart(64, "0");
  const low = "05".padStart(64, "0");
  it("any 32-byte withdrawals root passes the pre-check; the circuit takes it mod r", () => {
    expect(zkPublicInputErrors({ stateRoot: low, withdrawalsRoot: high })).toEqual([]);
    expect(zkPublicInputErrors({ stateRoot: high }).join()).toMatch(/state_root/);
    const ins = zkPublicInputs({ prevStateRoot: low, stateRoot: low, withdrawalsRoot: high });
    expect(ins.map(bytesToHex)).toEqual([low, low, "00".repeat(32), bytesToHex(toCanonicalScalar(high))]);
    expect(bytesToHex(ins[3]!)).toBe(low);
  });
  it("compares mod r only when the chain reduced the stored root", () => {
    expect(withdrawalsRootMatches(low, high, true)).toBe(true);
    expect(withdrawalsRootMatches(low, high, false)).toBe(false);
    expect(withdrawalsRootMatches(high, high, false)).toBe(true);
  });
});

/** A fake node serving a qledger-v1 rollup whose inbox holds the fixture's entries. */
function fakeNode() {
  const chainId = q.chainId;
  const rollupId = q.rollupId;
  const accs: Uint8Array[] = [];
  let acc = new Uint8Array();
  entries.forEach((_, i) => {
    acc = qledgerAccumulate({ chainId, rollupId, from: i, accFrom: acc, entries: [entries[i]!] });
    accs.push(acc);
  });
  const head = entries.length;
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  const posts: unknown[] = [];
  const deposits: unknown[] = [];
  entries.forEach((e, i) => {
    const seq = String(i + 1);
    if (e.poster.startsWith("deposit:")) {
      const d = decodeQledgerDeposit(e.payload)!;
      deposits.push({
        height: String(e.height),
        txhash: `D${seq}`,
        events: [
          {
            type: "rdk_rollup_deposit",
            attributes: [
              { key: "rollup_id", value: rollupId },
              { key: "depositor", value: e.poster.slice(8) },
              { key: "account", value: bytesToHex(d.account) },
              { key: "amount", value: `${d.amount}uqor` },
              { key: "sequence", value: seq },
            ],
          },
        ],
      });
    } else {
      posts.push({
        height: String(e.height),
        txhash: `P${seq}`,
        tx: { body: { messages: [{ "@type": "/qorechain.rdk.v1.MsgPostRollupData", poster: e.poster, rollup_id: rollupId, data: b64(e.payload) }] } },
        events: [
          {
            type: "rdk_data_posted",
            attributes: [
              { key: "rollup_id", value: rollupId },
              { key: "sequence", value: seq },
              { key: "data_hash", value: bytesToHex(new Uint8Array(32)) },
              { key: "poster", value: e.poster },
            ],
          },
        ],
      });
    }
  });
  return { chainId, rollupId, accs, head, posts, deposits };
}

describe("planQledgerBatch", () => {
  it("plans the first batch from the chain and reproduces the chain's roots", async () => {
    const node = fakeNode();
    const { postedDataHash } = await import("../src");
    // Real data hashes in the post events.
    for (const p of node.posts as { events: { attributes: { key: string; value: string }[] }[]; tx: { body: { messages: { data: string }[] } } }[]) {
      const data = Uint8Array.from(atob(p.tx.body.messages[0]!.data), (c) => c.charCodeAt(0));
      p.events[0]!.attributes.find((a) => a.key === "data_hash")!.value = bytesToHex(postedDataHash(data));
    }
    const range = (end: number) =>
      bytesToHex(inboxRangeHash({ chainId: node.chainId, rollupId: node.rollupId, from: 0, to: end, accFrom: new Uint8Array(), accTo: node.accs[end - 1]! }));
    const routes: Record<string, unknown> = {
      [`/qorechain/rdk/v1/rollup/${node.rollupId}`]: { rollup: { rollup_id: node.rollupId, execution_vm: "qledger-v1", sequencing: "based", settlement_mode: "optimistic" } },
      "/qorechain/rdk/v1/params": { params: { min_submitter_bond: "1000000000" } },
      [`/qorechain/rdk/v1/submitter_bond/${node.rollupId}/qor1sub`]: { amount: "1000000000", pending: "0" },
      [`/qorechain/rdk/v1/inbox/${node.rollupId}`]: { inbox: { head_sequence: String(node.head), consumed_sequence: "0", consumed_acc: "00".repeat(32), range_end: String(node.head), range_data_hash: range(node.head) } },
      [`/qorechain/rdk/v1/inbox/${node.rollupId}?inbox_end=${node.head}`]: { inbox: { head_sequence: String(node.head), consumed_sequence: "0", consumed_acc: "00".repeat(32), range_end: String(node.head), range_data_hash: range(node.head) } },
      "/cosmos/base/node/v1beta1/status": { height: "1000" },
      [`/qorechain/rdk/v1/posted_data/${node.rollupId}/${node.head}`]: {
        posted_data: { sequence: String(node.head), inbox_acc: bytesToHex(node.accs[node.head - 1]!), height: "210" },
      },
    };
    const fetch = async (url: string) => {
      const path = url.replace("http://node", "");
      if (path.startsWith("/cosmos/tx/v1beta1/txs?query=")) {
        const query = decodeURIComponent(path.split("query=")[1]!.split("&")[0]!);
        const txs = query.startsWith("rdk_data_posted") ? node.posts : node.deposits;
        return { ok: true, status: 200, statusText: "OK", json: async () => ({ tx_responses: txs, total: String(txs.length) }) };
      }
      if (path in routes) return { ok: true, status: 200, statusText: "OK", json: async () => routes[path] };
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
    };
    const rest = new RestClient("http://node", { fetch });
    const plan = await planQledgerBatch(rest, { chainId: node.chainId, rollupId: node.rollupId, submitter: "qor1sub", ledger: new QledgerLedger() });
    expect(plan.input.inboxEnd).toBe(BigInt(node.head));
    expect(plan.input.batchIndex).toBe(0n);
    expect(bytesToHex(plan.input.prevStateRoot)).toBe(bytesToHex(qledgerEmptyRoot()));
    expect(bytesToHex(plan.input.stateRoot)).toBe(q.batch.stateRoot);
    expect(bytesToHex(plan.input.withdrawalsRoot)).toBe(q.batch.withdrawalsRoot);
    expect(bytesToHex(plan.input.dataHash)).toBe(range(node.head));
    expect(plan.result.withdrawals).toHaveLength(2);

    // A node serving tampered payloads is caught by the accumulator check.
    routes[`/qorechain/rdk/v1/posted_data/${node.rollupId}/${node.head}`] = {
      posted_data: { sequence: String(node.head), inbox_acc: "11".repeat(32), height: "210" },
    };
    await expect(planQledgerBatch(rest, { chainId: node.chainId, rollupId: node.rollupId, submitter: "qor1sub", ledger: new QledgerLedger() })).rejects.toThrow(/accumulator/);

    routes[`/qorechain/rdk/v1/submitter_bond/${node.rollupId}/qor1sub`] = { amount: "5", pending: "0" };
    await expect(planQledgerBatch(rest, { chainId: node.chainId, rollupId: node.rollupId, submitter: "qor1sub", ledger: new QledgerLedger() })).rejects.toThrow(/bond/);
  });
});
