import { describe, it, expect } from "vitest";
import { createRdkClient, watchBatches, type BatchDeadline } from "../src/index";
import type { ChainTip } from "../src/lifecycle/state-machine";
import { mockFetch } from "./mock-fetch";

// The watchtower had no tests before 0.6.0, which is how three bugs in it
// survived: a block height read as a Unix timestamp, a deadline alert that
// fired for windows long closed, and a read of only the first page of batches.

interface Chain {
  batches: Array<Record<string, unknown>>;
  rollup?: Record<string, unknown>;
}

/** A node serving `batches` through the paged Batches query, 50 per page. */
function node(chain: Chain) {
  return mockFetch((call) => {
    const u = new URL(call.url);
    if (u.pathname.includes("/params")) return { json: { params: { default_challenge_window: 604800 } } };
    if (u.pathname.includes("/rollup/"))
      return { json: { rollup: { status: "active", ...(chain.rollup ?? {}) } } };
    if (u.pathname.includes("/batches/")) {
      const start = Number(u.searchParams.get("start_index") ?? 0);
      const limit = Math.min(Number(u.searchParams.get("limit") ?? 0) || 50, 100);
      const from = chain.batches.filter((b) => Number(b.batch_index) >= start);
      const page = from.slice(0, limit);
      const more = from.length > limit;
      return {
        json: { batches: page, next_index: more ? Number(page[page.length - 1].batch_index) + 1 : 0 },
      };
    }
    return { json: {} };
  });
}

const batch = (i: number, extra: Record<string, unknown> = {}) => ({
  batch_index: i,
  status: "submitted",
  submitted_at: 1000 + i,
  ...extra,
});

/** Run the watchtower for `ticks` polls and collect what it reported. */
async function run(
  chain: Chain,
  tips: ChainTip[],
  opts: { challengeWindowSecs?: number; deadlineWarnBlocks?: number } = {},
) {
  const { fetch, calls } = node(chain);
  const client = createRdkClient({ endpoints: { rest: "https://r", rpc: "https://rpc" }, fetch });
  const seen: number[] = [];
  const deadlines: BatchDeadline[] = [];
  let t = 0;
  await new Promise<void>((resolve) => {
    const handle = watchBatches(client, "d", {
      intervalMs: 1,
      tip: () => tips[Math.min(t, tips.length - 1)],
      challengeWindowSecs: opts.challengeWindowSecs,
      deadlineWarnBlocks: opts.deadlineWarnBlocks,
      onBatch: (b) => seen.push(b.batchIndex),
      onDeadline: (d) => deadlines.push(d),
      onError: (e) => {
        throw e;
      },
    });
    const poll = setInterval(() => {
      t++;
      if (t >= tips.length + 2) {
        clearInterval(poll);
        handle.stop();
        resolve();
      }
    }, 5);
  });
  return { seen, deadlines, calls };
}

describe("watchBatches", () => {
  it("sees every batch of a rollup past the first page", async () => {
    // 130 batches: three pages of the chain's paged query.
    const chain = { batches: Array.from({ length: 130 }, (_, i) => batch(i, { status: "finalized", finalized_at: 1 })) };
    const { seen } = await run(chain, [{ height: 5000, timeSecs: 0 }]);
    expect(new Set(seen).size).toBe(130);
    expect(Math.max(...seen)).toBe(129);
  });

  it("does not raise a deadline alert for a window that is already closed", async () => {
    // Before 0.6.0 every non-finalized batch alerted at once, because the
    // deadline was a height plus seconds compared against the clock.
    const chain = { batches: [batch(0)] };
    const windowSecs = 600; // 100 blocks
    const { deadlines } = await run(chain, [{ height: 1000 + 101, timeSecs: 0 }], {
      challengeWindowSecs: windowSecs,
    });
    expect(deadlines).toHaveLength(0);
  });

  it("alerts once when an open window nears its deadline, judged in blocks", async () => {
    const chain = { batches: [batch(0)] }; // submitted at height 1000
    const { deadlines } = await run(
      chain,
      [
        { height: 1010, timeSecs: 0 }, // 90 blocks left: quiet
        { height: 1060, timeSecs: 0 }, // 40 left: inside the 50-block warning
        { height: 1070, timeSecs: 0 }, // still inside: must not alert again
      ],
      { challengeWindowSecs: 600, deadlineWarnBlocks: 50 },
    );
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].window?.mode).toBe("blocks");
    expect(deadlines[0].window?.open).toBe(true);
    expect(deadlines[0].window?.blocksRemaining).toBe(40);
  });

  it("keeps re-judging a batch it saw early, so the alert comes later", async () => {
    // The bug fixed here would have hidden behind the unit bug: a batch was
    // judged only on first sight, so with correct arithmetic a fresh batch —
    // its deadline far off — would never have been looked at again.
    const chain = { batches: [batch(0)] };
    const { deadlines } = await run(
      chain,
      [
        { height: 1001, timeSecs: 0 },
        { height: 1001, timeSecs: 0 },
        { height: 1095, timeSecs: 0 },
      ],
      { challengeWindowSecs: 600, deadlineWarnBlocks: 10 },
    );
    expect(deadlines).toHaveLength(1);
    // It must be the LATE tip that triggered it (5 blocks left), not the first
    // sight. On 0.5.0 the alert fired instantly from the unit bug, which is
    // why a bare length check passed there by coincidence.
    expect(deadlines[0].window?.blocksRemaining).toBe(5);
  });

  it("uses the rollup's own window over the global default", async () => {
    const chain = { batches: [batch(0)], rollup: { challenge_window_sec: 600 } };
    const { deadlines } = await run(chain, [{ height: 1060, timeSecs: 0 }], { deadlineWarnBlocks: 50 });
    // With the global 604800 s the window would be 100800 blocks and silent.
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].window?.windowBlocks).toBe(100);
  });

  it("judges a timed batch in seconds of block time", async () => {
    const chain = { batches: [batch(0, { submitted_time: 1_700_000_000 })] };
    const { deadlines } = await run(chain, [{ height: 9999, timeSecs: 1_700_000_000 + 600 - 100 }], {
      challengeWindowSecs: 600,
    });
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].window?.mode).toBe("time");
    expect(deadlines[0].secondsRemaining).toBe(100);
  });
});
