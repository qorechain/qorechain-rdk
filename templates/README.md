# Templates

Runnable starter projects — one per preset profile, plus a multi-VM starter —
cloned by `create-qorechain-rollup`:

- `defi-rollup` — zk-SNARK / dedicated / native / EIP-1559 / EVM
- `gaming-rollup` — based / based / native / flat gas / custom VM
- `nft-rollup` — optimistic / dedicated / CosmWasm (with the Celestia DA
  "planned" notice)
- `enterprise-rollup` — based / based / native / subsidized gas / EVM
- `custom-rollup` — fully parameterized, every field documented
- `multivm-rollup` — an EVM rollup that calls CosmWasm through the cross-VM
  precompile, with a `contracts/CrossVmCaller.sol` snippet (EVM → CosmWasm)

**Status: coming soon.** Each template will run end-to-end against the
`qorechain-diana` testnet (create + query at minimum) with documented
prerequisites and the displayed stake / burn cost.

Templates are intentionally not pnpm workspace members, so their published
`@qorechain/*` version ranges do not affect the monorepo install.
