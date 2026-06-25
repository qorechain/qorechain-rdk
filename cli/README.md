# create-qorechain-rollup

Scaffold a new QoreChain rollup project from an official starter template.

## Usage

```sh
npm create qorechain-rollup my-rollup
# or
npx create-qorechain-rollup my-rollup
```

Interactive by default; pass flags for non-interactive / CI use:

```sh
npx create-qorechain-rollup my-rollup --template defi-rollup --network testnet --yes
```

## Templates

| Template | Profile | Summary |
| --- | --- | --- |
| `defi-rollup` | defi | zk-SNARK / dedicated / native / EIP-1559 / EVM (with a reference SNARK prover) |
| `gaming-rollup` | gaming | based / based / native / flat gas / custom VM |
| `nft-rollup` | nft | optimistic / dedicated / CosmWasm (challenge flow + Celestia notice) |
| `enterprise-rollup` | enterprise | based / based / native / subsidized gas / EVM |
| `custom-rollup` | custom | fully parameterized, every field documented |

## Options

```
  -t, --template <name>      Template id (see the table above).
      --network <name>       testnet | mainnet (default: testnet).
      --package-manager <pm> pnpm | npm | yarn (default: pnpm).
  -y, --yes                  Skip prompts, use defaults.
      --no-install           Do not install dependencies.
      --local                Rewrite @qorechain/* deps to local file: links
                             (for use inside this monorepo before publish).
  -h, --help                 Show help.
  -v, --version              Print version.
```

After scaffolding, the CLI prints the documented stake and creation-burn cost and
the next steps to create your rollup and read its status.

## License

Apache-2.0
