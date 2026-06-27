# @qorechain/rdk-cli — `qorollup`

The operator command line for creating, operating, and monitoring rollups on the
QoreChain network. Built on [`@qorechain/rdk`](https://www.npmjs.com/package/@qorechain/rdk).

## Install

```sh
npm install -g @qorechain/rdk-cli
# or run without installing:
npx @qorechain/rdk-cli doctor
```

## Configure

`qorollup` reads endpoints and signing material from flags or `QORE_*`
environment variables:

```sh
export QORE_NETWORK=testnet            # or mainnet
export QORE_REST_URL=https://rest...   # Cosmos REST (LCD)
export QORE_RPC_URL=https://rpc...      # consensus RPC (for signing)
export QORE_EVM_RPC_URL=https://evm...  # qor_ JSON-RPC
export QORE_MNEMONIC="..."             # or QORE_OPERATOR_PRIVATE_KEY_HEX
```

## Commands

```
qorollup doctor                     # preflight: endpoints, params, signer, balance, config
qorollup keygen                     # generate an operator key (mnemonic + address)
qorollup create --rollup-id my-roll --profile defi      # validate, show cost, create
qorollup create --rollup-id my-roll --profile defi --dry-run   # no broadcast
qorollup status my-roll             # status + health + challenge-window countdown
qorollup watch my-roll              # live status (Ctrl-C to stop)
qorollup params                     # live module parameters
qorollup suggest "high-frequency DeFi DEX"   # QCAI-assisted profile suggestion
qorollup advise my-roll             # QCAI Rollup Copilot: aggregated advice
qorollup receipt my-roll 7 [--verify] [--out receipt.json]  # quantum-safe settlement receipt
qorollup watchtower my-roll         # auto-challenger framework (optimistic rollups)
qorollup pause|resume|stop my-roll  # lifecycle (creator only)
qorollup manifest export --rollup-id my-roll --out rollup.manifest.json
qorollup manifest import rollup.manifest.json
qorollup withdraw --file withdrawal.json [--dry-run]
qorollup faucet qor1...             # request testnet funds (needs QORE_FAUCET_URL)
```

Global flags: `--network`, `--rest/--rpc/--evm-rpc`, `--mnemonic/--key`,
`--profile`, `--json` (machine-readable), `-y/--yes`, `-h/--help`, `-v/--version`.

Quantum-safe signing is available via `@qorechain/sdk`; the CLI uses any `@cosmjs`
`OfflineSigner`.

## License

Apache-2.0
