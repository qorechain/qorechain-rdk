---
id: qcai-copilot
title: QCAI Rollup Copilot
sidebar_position: 12
---

# QCAI Rollup Copilot

The QCAI Rollup Copilot gathers everything the network's advisory services know
about one rollup and folds it into a single, plain-language read: a live fee
estimate, network recommendations, any fraud investigations that reference the
rollup, the reinforcement-learning agent's status, and a short list of
suggestions you can act on.

It is **best-effort**. The advisory services are optional infrastructure — if one
is unreachable, the Copilot degrades gracefully, dropping that section and
recording a warning instead of failing the whole call. You always get a result.

## One call: `getRollupAdvice`

```ts
import { createRdkClient, getRollupAdvice } from "@qorechain/rdk";

const rdk = createRdkClient({
  endpoints: {
    rest: "https://rest.testnet.example",
    evmRpc: "https://evm.testnet.example", // qor_ JSON-RPC for RL agent reads
  },
});

const advice = await getRollupAdvice(rdk, "my-roll");

console.log(advice.feeEstimate);            // live fee estimate (if reachable)
console.log(advice.networkRecommendations); // tuning recommendations
console.log(advice.fraudInvestigations);    // investigations referencing this rollup
console.log(advice.rlAgentStatus);          // RL agent status (qor_ JSON-RPC)
console.log(advice.suggestions);            // plain-language, actionable
console.log(advice.warnings);               // services that were unreachable
```

## The underlying reads

`getRollupAdvice` aggregates a set of read-only methods you can also call
directly. The advisory REST methods live under `/qorechain/ai/v1/...`:

- `getFeeEstimate(...)` — current fee estimate.
- `getNetworkRecommendations(...)` — network-level tuning recommendations.
- `getFraudInvestigations(...)` / `getFraudInvestigation(id)` — open
  investigations and a single investigation by id.
- `getCircuitBreakers(...)` — advisory circuit-breaker state.

The reinforcement-learning reads use the `qor_*` JSON-RPC namespace:

- `getRLAgentStatus()` — the agent's current status.
- `getRLObservation()` — the latest observation.
- `getRLReward()` — the latest reward signal.

Because these are all reads, the Copilot needs only a REST endpoint (and an EVM
/ `qor_` JSON-RPC endpoint for the RL reads) — no signer.

## CLI

```bash
qorollup advise my-roll
qorollup advise my-roll --json
```

`advise` prints the aggregated advice, with unreachable services surfaced as
warnings rather than errors. See the
[qorollup reference](../reference/cli-qorollup.md).
