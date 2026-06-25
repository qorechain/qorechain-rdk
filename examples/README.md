# `@qorechain/rdk` examples

Short, focused, runnable examples for the QoreChain Rollup Development Kit —
one file per capability. Every file type-checks against the real
`@qorechain/rdk` API in CI (`pnpm typecheck`), so the snippets stay accurate.

## Running

From this directory:

```sh
pnpm install            # at the workspace root
pnpm tsx src/<file>.ts  # run a single example
```

Examples that talk to a node read their endpoints from `QORE_*` environment
variables, and examples that build or broadcast transactions read signing
material from `QORE_OPERATOR_PRIVATE_KEY_HEX` or `QORE_MNEMONIC`. Copy
`.env.example` to `.env` (or export the variables in your shell) and fill in
your own values:

```sh
cp .env.example .env
# then export them, e.g.:
export $(grep -v '^#' .env | xargs)
pnpm tsx src/connect-and-read-params.ts
```

Several examples run end-to-end **without** a node — they print local results
and skip (or guard) any network calls when the relevant `QORE_*` variable is
unset.

### Environment variables

| Variable | Purpose |
|---|---|
| `QORE_NETWORK` | Network preset: `testnet` (default) or `mainnet`. |
| `QORE_REST_URL` | Cosmos REST (LCD) endpoint — rollup/batch/DA/params reads. |
| `QORE_RPC_URL` | Consensus RPC endpoint — transaction broadcast. |
| `QORE_EVM_RPC_URL` | EVM + `qor_` JSON-RPC endpoint — the `qor_*` methods. |
| `QORE_OPERATOR_PRIVATE_KEY_HEX` | Hex private key for signing (or use a mnemonic). |
| `QORE_MNEMONIC` | Mnemonic for signing (alternative to the hex key). |

## Gallery

| Example | What it shows | Run |
|---|---|---|
| `connect-and-read-params.ts` | Build an `RdkClient` from the environment and read the live `rdk` module parameters via `client.params()`. | `pnpm tsx src/connect-and-read-params.ts` |
| `suggest-profile.ts` | Ask the QCAI-assisted advisory for a preset with `client.suggestProfile("high-frequency DeFi DEX")`; print the profile and its source (advisory vs. fallback). | `pnpm tsx src/suggest-profile.ts` |
| `create-from-presets.ts` | Build a config from each preset (`defi`/`gaming`/`nft`/`enterprise`/`custom`) and print `validationResult()` validity + warnings. No node required. | `pnpm tsx src/create-from-presets.ts` |
| `validate-custom-config.ts` | Override `presets.custom(...)` with an invalid settlement/proof pair and read `validationResult().errors`, then show a valid variant. No node required. | `pnpm tsx src/validate-custom-config.ts` |
| `submit-batch-paths.ts` | Build a `submitBatch` message for every settlement path (optimistic, zk, based, sovereign) and optionally broadcast it via a signing tx client. | `pnpm tsx src/submit-batch-paths.ts` |
| `challenge-and-resolve.ts` | Challenge an optimistic batch with `tx.challengeBatch(...)` and document `tx.resolveChallenge(...)`. | `pnpm tsx src/challenge-and-resolve.ts` |
| `native-da-blob.ts` | Assemble a native DA blob with `buildDaBlob(...)`, print its `dataHash`/`size`, query a stored blob via `client.rest.getBlob(...)`, and guard non-native backends with `assertDaBackendAvailable`. | `pnpm tsx src/native-da-blob.ts` |
| `list-rollups-and-events.ts` | List rollups via `client.rest.listRollups()` and decode lifecycle events with `decodeRdkEvents(...)` / `findRdkEvent(...)`. | `pnpm tsx src/list-rollups-and-events.ts` |
| `read-status-jsonrpc.ts` | Read rollup/batch/DA-blob status through the `qor_` JSON-RPC namespace (`client.qor.getRollupStatus`, `getSettlementBatch`, `getDABlobStatus`). | `pnpm tsx src/read-status-jsonrpc.ts` |

## Notes

- The five preset profiles, the settlement → proof compatibility matrix, and
  the module parameters all mirror the on-chain `rdk` module. Treat documented
  defaults as reference only and read live values with `client.params()`.
- Celestia data availability is selectable but not yet active; examples surface
  this as a validation warning and guard live use with `assertDaBackendAvailable`.
