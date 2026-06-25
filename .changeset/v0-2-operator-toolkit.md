---
"@qorechain/rdk": minor
"@qorechain/rdk-cli": minor
"create-qorechain-rollup": minor
---

v0.2 — operator toolkit.

- `@qorechain/rdk`: preflight/doctor, rollup health + live monitoring, accounts
  and signing via `@qorechain/sdk` (incl. hybrid post-quantum), rollup manifests,
  binary-Merkle withdrawal-proof assembly, a mock tx backend + gas simulation,
  a configurable faucet helper, and bank balance reads.
- `@qorechain/rdk-cli` (`qorollup`): a new operator command line covering the
  full create/operate/monitor lifecycle.
- `create-qorechain-rollup`: templates upgraded to the 0.2 surface with
  doctor/status scripts, a CI workflow, and `signerFromEnv` signing.
