---
"@qorechain/rdk": minor
"create-qorechain-rollup": minor
---

Initial public release of the QoreChain Rollup Development Kit.

- `@qorechain/rdk`: typed rollup configuration with the settlement → proof
  compatibility matrix and the based-sequencer constraint enforced client-side;
  the five preset profiles; the rollup and settlement-batch lifecycles; native
  data availability with the Celestia "planned" guard; REST and `qor_` JSON-RPC
  read clients; a QCAI-assisted `suggestProfile` with a documented fallback; and
  denomination, economics, and address utilities.
- `create-qorechain-rollup`: an interactive scaffolder for the five profile
  templates, runnable against the public testnet.
