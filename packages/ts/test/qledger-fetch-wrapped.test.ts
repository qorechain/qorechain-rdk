import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RestClient,
  bytesToHex,
  collectPostedPayloads,
  decodeQledgerDeposit,
  fetchQledgerEntries,
  hexToBytes,
  postedDataHash,
  qledgerAccumulate,
  type QledgerEntry,
} from "../src";

// Posts reach a rollup's inbox through every wrapper the chain executes on
// someone's behalf. A watcher that cannot read one back cannot check (or
// challenge) the batch that consumes it, so the fetcher must find every one.

const q = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../_fixtures/v328.json", import.meta.url)), "utf8"),
).qledger;
const entries: QledgerEntry[] = q.entries.map((e: { height: number; poster: string; payload: string }) => ({
  height: e.height,
  poster: e.poster,
  payload: hexToBytes(e.payload),
}));
const chainId: string = q.chainId;
const rollupId: string = q.rollupId;
const POST = "/qorechain.rdk.v1.MsgPostRollupData";
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

type Rec = Record<string, unknown>;
type Shape = "top" | "exec" | "nested" | "mixed" | "group-try" | "group-later" | "lost";

const postMsg = (e: QledgerEntry): Rec => ({ "@type": POST, poster: e.poster, rollup_id: rollupId, data: b64(e.payload) });
const exec = (msgs: Rec[]): Rec => ({ "@type": "/cosmos.authz.v1beta1.MsgExec", grantee: "qor1grantee", msgs });
const send: Rec = {
  "@type": "/cosmos.bank.v1beta1.MsgSend",
  from_address: "qor1x",
  to_address: "qor1y",
  amount: [{ denom: "uqor", amount: "1" }],
};

function postEvent(seq: number, e: QledgerEntry): Rec {
  return {
    type: "rdk_data_posted",
    attributes: [
      { key: "rollup_id", value: rollupId },
      { key: "sequence", value: String(seq) },
      { key: "data_hash", value: bytesToHex(postedDataHash(e.payload)) },
      { key: "poster", value: e.poster },
    ],
  };
}

/** A fake node whose inbox holds the fixture entries, with the posts packed as `shape` says. */
const isDeposit = (e: QledgerEntry) => e.poster.startsWith("deposit:");
const lastPostHeight = entries.filter((e) => !isDeposit(e)).at(-1)!.height;

/** The entries as the chain records them for `shape` (a mixed transaction lands all its posts at one height). */
function effective(shape: Shape): QledgerEntry[] {
  return shape === "mixed" ? entries.map((e) => (isDeposit(e) ? e : { ...e, height: lastPostHeight })) : entries;
}

function fakeNode(shape: Shape) {
  const entries = effective(shape);
  const accs: Uint8Array[] = [];
  let acc = new Uint8Array();
  entries.forEach((_, i) => {
    acc = qledgerAccumulate({ chainId, rollupId, from: i, accFrom: acc, entries: [entries[i]!] });
    accs.push(acc);
  });
  const posts: Rec[] = [];
  const deposits: Rec[] = [];
  const groupSubmits: Rec[] = [];
  const mixedMsgs: Rec[] = [send];
  const mixedEvents: Rec[] = [];
  entries.forEach((e, i) => {
    const seq = i + 1;
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
              { key: "sequence", value: String(seq) },
            ],
          },
        ],
      });
      return;
    }
    const tx = (messages: Rec[]): Rec => ({
      height: String(e.height),
      txhash: `P${seq}`,
      tx: { body: { messages } },
      events: [postEvent(seq, e)],
    });
    switch (shape) {
      case "top":
        posts.push(tx([postMsg(e)]));
        break;
      case "exec":
        posts.push(tx([exec([postMsg(e)])]));
        break;
      case "nested":
        posts.push(tx([exec([exec([exec([postMsg(e)])])])]));
        break;
      case "mixed": {
        // One transaction: a top-level post, posts under one and two MsgExec levels.
        const k = mixedMsgs.length % 3;
        mixedMsgs.push(k === 0 ? postMsg(e) : k === 1 ? exec([postMsg(e)]) : exec([send, exec([postMsg(e)])]));
        mixedEvents.push(postEvent(seq, e));
        break;
      }
      case "group-try":
        posts.push(
          tx([
            {
              "@type": "/cosmos.group.v1.MsgSubmitProposal",
              group_policy_address: "qor1policy",
              proposers: ["qor1member"],
              messages: [postMsg(e)],
              exec: "EXEC_TRY",
            },
          ]),
        );
        break;
      case "group-later": {
        // Submitted (inside a MsgExec) in one transaction, executed by MsgExec of x/group in another.
        const id = String(100 + seq);
        groupSubmits.push({
          id,
          height: String(e.height - 1),
          txhash: `S${seq}`,
          tx: {
            body: {
              messages: [
                exec([
                  {
                    "@type": "/cosmos.group.v1.MsgSubmitProposal",
                    group_policy_address: "qor1policy",
                    proposers: ["qor1member"],
                    messages: [postMsg(e)],
                  },
                ]),
              ],
            },
          },
          events: [],
        });
        posts.push(tx([{ "@type": "/cosmos.group.v1.MsgExec", proposal_id: id, executor: "qor1member" }]));
        break;
      }
      case "lost":
        // The event is there, the bytes are not (a contract or governance post).
        posts.push(tx([{ "@type": "/cosmwasm.wasm.v1.MsgExecuteContract", sender: "qor1s", contract: "qor1c", msg: {} }]));
        break;
    }
  });
  if (shape === "mixed") {
    posts.push({ height: String(lastPostHeight), txhash: "MIXED", tx: { body: { messages: mixedMsgs } }, events: mixedEvents });
  }
  const queries: string[] = [];
  const fetch = async (url: string) => {
    const path = url.replace("http://node", "");
    const ok = (body: unknown) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
    if (path.startsWith("/cosmos/tx/v1beta1/txs?query=")) {
      const query = decodeURIComponent(path.split("query=")[1]!.split("&")[0]!);
      queries.push(query);
      let txs: Rec[] = [];
      if (query.startsWith("rdk_data_posted.")) txs = posts;
      else if (query.startsWith("rdk_rollup_deposit.")) txs = deposits;
      else if (query.startsWith("cosmos.group.v1.EventSubmitProposal.proposal_id=")) {
        const id = /'"(\d+)"'/.exec(query)![1];
        txs = groupSubmits.filter((s) => s.id === id);
      }
      return ok({ tx_responses: txs, total: String(txs.length) });
    }
    if (path === `/qorechain/rdk/v1/posted_data/${rollupId}/${entries.length}`) {
      return ok({ posted_data: { sequence: String(entries.length), inbox_acc: bytesToHex(accs[entries.length - 1]!), height: "210" } });
    }
    // An executed group proposal is pruned: the node answers 500 "not found".
    return { ok: false, status: path.startsWith("/cosmos/group/") ? 500 : 404, statusText: "Error", json: async () => ({}) };
  };
  const rest = new RestClient("http://node", { fetch });
  const read = () => fetchQledgerEntries(rest, { chainId, rollupId, from: 0, to: entries.length, accFrom: new Uint8Array() });
  return { read, queries };
}

const hexEntries = (es: QledgerEntry[]) => es.map((e) => ({ height: BigInt(e.height), poster: e.poster, payload: bytesToHex(e.payload) }));

describe("fetchQledgerEntries reads posts through every wrapper", () => {
  for (const shape of ["top", "exec", "nested", "mixed", "group-try", "group-later"] as const) {
    it(`finds posts packed as ${shape}`, async () => {
      const got = await fakeNode(shape).read();
      expect(hexEntries(got)).toEqual(hexEntries(effective(shape)));
    });
  }

  it("matches every post of a mixed transaction to its payload", () => {
    const posts = entries.filter((e) => !e.poster.startsWith("deposit:"));
    const found = collectPostedPayloads([send, postMsg(posts[0]!), exec([postMsg(posts[1]!)]), exec([send, exec([postMsg(posts[2]!)])])]);
    for (const p of posts.slice(0, 3)) {
      expect(bytesToHex(found.payloads.get(bytesToHex(postedDataHash(p.payload)))!)).toBe(bytesToHex(p.payload));
    }
    expect(found.payloads.size).toBe(3);
  });

  it("asks the node only for the sequences it needs", async () => {
    const node = fakeNode("top");
    await node.read();
    expect(node.queries).toContain(
      `rdk_data_posted.rollup_id='${rollupId}' AND rdk_data_posted.sequence>0 AND rdk_data_posted.sequence<=${entries.length}`,
    );
    expect(node.queries).toContain(
      `rdk_rollup_deposit.rollup_id='${rollupId}' AND rdk_rollup_deposit.sequence>0 AND rdk_rollup_deposit.sequence<=${entries.length}`,
    );
  });

  it("refuses a post whose bytes are in no transaction", async () => {
    await expect(fakeNode("lost").read()).rejects.toThrow(/cannot be read back/);
  });

  it("refuses messages nested past the bound instead of skipping them", () => {
    let m: Rec = postMsg(entries.find((e) => !e.poster.startsWith("deposit:"))!);
    for (let i = 0; i < 40; i++) m = exec([m]);
    expect(() => collectPostedPayloads([m])).toThrow(/nest deeper/);
  });
});

describe("RestClient.searchTxs", () => {
  it("throws instead of returning a partial list", async () => {
    const fetch = async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ tx_responses: Array.from({ length: 2 }, (_, i) => ({ txhash: String(i) })), total: "10" }),
    });
    const rest = new RestClient("http://node", { fetch });
    await expect(rest.searchTxs("x.y='z'", { pageLimit: 2, maxPages: 3 })).rejects.toThrow(/more than 6/);
    const all = await rest.searchTxs("x.y='z'", { pageLimit: 2, maxPages: 5 });
    expect(all).toHaveLength(10);
  });
});
