# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Docs

- Mainnet runs QoreChain v3.2.5 since block 3,906,833 (the testnet since block
  8,890,800): the v3.2.5 settlement, withdrawal and cross-VM behaviour the RDK
  follows from 0.7.0 now applies on both networks. No code change was needed;
  the clients read the applied upgrade from the chain.

## 0.8.0

### Fixed

- **The Python, Go, Rust and Java clients could not send a transaction the
  networks accept.** They signed classical-only (secp256k1), and both mainnet
  and testnet require a hybrid ML-DSA-87 + secp256k1 signature on native-lane
  transactions, so only their reads worked. Each now signs hybrid when given a
  post-quantum keypair, through its own published QoreChain SDK (0.10.x), with
  the sign-bytes form (v1/v2) resolved from the chain. Every client produces
  byte-identical transactions to the TypeScript client for the same input: the
  shared golden fixture holds four hybrid transactions (v1 and v2, with and
  without the embedded public key) that each language reproduces exactly.

### Added

- Post-quantum key resolution in every language, matching TypeScript: from a
  mnemonic, the canonical or the legacy derivation, whichever the chain has
  registered (a new account embeds the canonical key on first use); or a
  32-byte seed from `QORE_PQC_SEED_HEX`, checked against the registered key.
  Python `resolve_pqc_keypair` / `pqc_keypair_from_env`, Go
  `ResolvePqcKeypair` / `PqcKeypairFromEnv`, Rust `resolve_pqc_keypair` /
  `pqc_keypair_from_env`, Java `Accounts.resolvePqcKeypair` /
  `pqcKeypairFromEnv`.

### Changed

- **Java 21 is required** (was 17), as the QoreChain Java SDK it depends on is.
- New dependencies: `qorechain-sdk` 0.10.x on PyPI, Go
  `github.com/qorechain/qorechain-sdk/packages/go` v0.10.0, crates.io
  `qorechain-sdk` 0.10, Maven `io.github.qorechain:qorechain-sdk` [0.10.0,0.11).
  Rust moves to `cosmrs` 0.22 (shared with the SDK).
- Go: `RdkTxClient.Sign` returns `([]byte, error)`, since hybrid signing can fail.
- The templates pin `@qorechain/rdk ^0.8.0`.

## 0.7.1

### Fixed

- **Every `qorollup` transaction command was refused.** `create`, `pause`,
  `resume`, `stop` and `withdraw` signed classical-only, and both networks
  require a hybrid (ML-DSA-87 + secp256k1) signature on native-lane
  transactions. The CLI now signs hybrid, resolving the post-quantum key as the
  templates do: derived from `--mnemonic` / `QORE_MNEMONIC` and matched against
  the chain, or `--pqc-seed` / `QORE_PQC_SEED_HEX` alongside `--key`. Without one
  it refuses to send instead of paying for a refused transaction.
- **Python lacked `transition_root_version_for_batch`** (and
  `RestClient.get_applied_plan_height` and `BatchView.withdrawals_bound`). The
  0.6.1 notes said the per-batch helper was in all five languages; it was in
  four. It is now in Python too.
- The README and the install page listed 0.4.4 as the current version.
- `SECURITY.md` gave the wrong reporting address; it is
  **security@qore.network**.

## 0.7.0

Ready for QoreChain v3.2.5, which the testnet runs since block 8,890,800. New
byte formats are tested against vectors produced by the chain's own code, and
every withdrawal proof in those vectors is accepted by the chain's verifier.

### Fixed

- **Withdrawal proofs never verified on chain.** The Merkle and withdrawal
  helpers defaulted to SHA-256 and re-hashed each leaf; the chain hashes nodes
  with SHAKE-256 and builds its leaves from the withdrawal itself. New in all
  five languages: `withdrawalsTree` builds a batch's withdrawals root and every
  proof exactly as the chain does, with v1 leaves, or v2 leaves (chain v3.2.5,
  `rdk-withdrawals-binding`) that also name the chain id; `withdrawalLeafV1` /
  `withdrawalLeafV2`; `assembleWithdrawalProof` now builds the chain's tree by
  default; the generic Merkle helpers default to SHAKE-256. Breaking for code
  that relied on the SHA-256 defaults; pass `hash` explicitly to keep them.
- **`buildDaBlob`'s commitment** is now the chain's (SHAKE-256), not SHA-256.
- **The Watchtower missed a batch resubmitted at a rejected index.** From chain
  v3.2.5 an upheld fraud rejects the batch and every later unfinalized one, and
  the sequencer resubmits under the same indexes; the Watchtower told batches
  apart by index only. It now uses index and state root, and never validates a
  rejected batch.
- **The defi template paid a fee for a batch the chain always refuses.** No chain
  release up to v3.2.5 can register a ZK verification key, so every zk batch is
  refused (code 21). The template now stops before sending, and its README and
  the docs say plainly that zk settlement cannot be used yet (key registration is
  planned for chain v3.2.7). `RollupView.hasVerificationKey` reads the field that
  release is to add.

### Added

- **Chain v3.2.5 settlement** (`rdk-challenge-settlement`): `getRollupHealth`
  reports `heldBackBy` when the latest batch could finalize on its own window
  but an earlier batch is still submitted or challenged (batches finalize in
  order), and `qorollup status` prints it; `stopRollupError` and a pre-check in
  `stopRollup` (TypeScript, Rust), since a rollup with an unsettled latest batch
  cannot be stopped; `MAX_PENDING_OPTIMISTIC_BATCHES` (4,096);
  `withdrawalsRootError` (empty or 32 bytes), checked before every
  `MsgSubmitBatch` in all five languages. Any account can now resolve a
  challenge; the docs say so.
- **Watchtower helpers:** `transitionRootValidator` (a `validate` predicate that
  applies the chain's fraud rule) and `fraudProofForBatch` (the proof that wins,
  or none for an honest batch); `qorollup watchtower --canonical` reports
  batches a challenge would win.
- **Cross-VM, chain v3.2.5:** `getCrossVmParams` (the allowlist, at
  `/qorechain/crossvm/v1/params`), `crossVmTargetReady` (precompile active,
  bridge enabled, target allowlisted, with the blocking reason),
  `decodeCrossVmResult` (`abi.decode(ret, (bytes))`) and `decodeRevertReason`
  (`Error(string)`), checked against encodings Solidity produced. The
  `multivm-rollup` contract decodes the result, requires the 64-byte minimum an
  active precompile returns, and passes the chain's refusal reason through.
- **`qorollup withdraw`** takes the batch's withdrawals, builds the proof under
  the batch's own binding, and refuses before paying a fee when the result is
  not the batch's on-chain `withdrawals_root`.
- **`decodeRdkTxError`** and `RDK_ERRORS`: the `rdk` module's codes (2 to 36),
  with what to do about the ones an operator meets.
- `qorehash` (SHAKE-256, 32 bytes) in all five languages;
  `FEATURE_RDK_CHALLENGE_SETTLEMENT`.

### Changed

- `@qorechain/sdk ^0.10.0` (was `^0.9.0`).
- The templates pin `@qorechain/rdk ^0.7.0`.

## 0.6.2

### Fixed

- **`qorollup` installed from npm did nothing.** The CLI ran only when
  `process.argv[1]` equalled its own file path, but npm starts a package's bin
  through a symlink in `node_modules/.bin`, so a local, global or `npx` install
  exited 0 without output; only `node .../dist/index.js` worked. It now compares
  real paths.
- **`qorollup --version` printed `0.4.1` and `create-qorechain-rollup
  --version` printed `0.2.0`.** Both now read their version from their own
  `package.json`.

No library changes: the other packages are released as 0.6.2 so every
registry stays on one version.

## 0.6.1

### Security

- **Settlement-receipt verification now binds every field of the receipt.**
  Reported through the Break QoreChain bug bounty. Verification matched the
  chain's anchor on its state root, layer height, validator-set hash and
  signature, but never compared the receipt's `mainChainHeight`, `anchoredAt`,
  `algorithm` or `version`, nor, on a version-2 receipt, its
  `transactionCount` and `compressedStateProof`; `batchStateRoot` was also only
  informational. A genuine receipt with those fields altered still verified, and
  `qorollup receipt verify` said every field had been reproduced from chain.
  The settlement claim itself was always bound (state root, anchor signature,
  creator key), so no settlement could be forged; what a relying party could
  not trust was the metadata shown next to it. Now, in all five languages:
  - every anchor field the receipt states must equal the chain's anchor, and a
    mismatch names the field;
  - `batchStateRoot` must equal the chain's batch root;
  - a receipt with an unknown `version` or an `algorithm` other than `ML-DSA-87`
    is refused before anything is read from chain, and a version-2 receipt must
    carry `chainId` (and, where the language can tell, `transactionCount` and
    `compressedStateProof`);
  - the result carries the chain's matched `anchor` and, when valid, a
    `verifiedReceipt` rebuilt from chain state (`verified_receipt` in Python and
    Rust, `VerifiedReceipt` in Go);
  - `qorollup receipt verify --json` returns that chain-read receipt as
    `receipt` (`null` when not valid) instead of echoing the file, and the
    success line names the fields that were checked.

  Version-1 receipts, which predate the transaction count and proof, still
  verify; those two fields are compared on them only when present.

### Fixed

- **The rollup templates submitted batches the chain refuses.** All six
  starter templates put a `dataHash` on their batches, but every rollup profile
  uses `native` data availability, where the chain accepts a non-empty
  `data_hash` only when a matching blob is stored on chain, and no transaction
  stores one. Every template batch was refused, after paying the fee. The
  templates now leave `dataHash` empty, and the data-availability docs (which
  said the chain stores the blob) are corrected.
- **`RdkTxClient.submitBatch` refuses such a batch before broadcasting** when it
  can read the rollup (a hybrid client with a REST endpoint).

- **The optimistic templates published a provably fraudulent state root.**
  `custom`, `multivm` and `nft` submitted a fixed placeholder root. The chain
  judges an optimistic batch by its canonical transition root, so anyone could
  challenge such a batch and win, and from chain v3.2.5 any account can resolve
  that challenge and be paid from the rollup's escrow. They now publish the
  canonical root (see *Added*), under the binding the chain applies at the
  moment of submission, and no longer send a placeholder proof. The `nft`
  template's `challenge.ts`, which sent a one-byte placeholder proof that could
  never win, now reads the batch from chain and challenges only a batch whose
  root is provably wrong, with the proof the chain's verifier reads.

### Added

- **Transition roots**, in all five languages, tested against vectors
  generated by calling the chain's own `BatchTransitionRoot`:
  `batchTransitionRootV1`, `batchTransitionRootV2` (chain v3.2.5's
  `rdk-withdrawals-binding`, which also binds the chain id, the rollup id and
  the withdrawals root), `transitionRootVersionFor` (which binding a batch
  submitted now gets), `transitionRootVersionForBatch` (which binding an
  existing batch is judged by: its own flag when the node serves one, otherwise
  whether it was included at or above the height v3.2.5 was applied at) and
  `fraudProof` (`prev_state_root || correct_root`).
- `RestClient.getProtocolFeatures`, `isProtocolFeatureEnabled` (a chain without
  the route reads as "not enabled") and `getAppliedPlanHeight`, in all five
  languages; `BatchView.withdrawalsBound`.
- `dataHashError` (`data_hash_error`, `DataHashError`, `Rules.dataHashError`):
  the native/both data-hash rule, in all five languages.
- `receiptSchemaError` and `SUPPORTED_RECEIPT_VERSIONS` in all five languages.

### Changed

- `SubmitBatchInput.dataHash` is optional in TypeScript; omitted means empty.
- The templates pin `@qorechain/rdk ^0.6.1`.
- `@qorechain/rdk` depends on `@noble/hashes` directly (SHAKE-256 for the
  transition root); it was already installed through `@qorechain/sdk`.

## 0.6.0

Ready for QoreChain v3.2.2 through v3.2.4. Every finding below was checked
against the chain's own code or the live networks, not just reasoned about; the
new byte formats are tested against vectors generated by calling the chain's
own implementation.

### Fixed

- **Settlement-receipt verification could not succeed against a real node.**
  All five clients requested the creator's post-quantum key from
  `/qorechain/pqc/v1/accounts/`; the chain serves `/qorechain/pqc/v1/account/`.
  That lookup is a required step, so every genuine receipt failed. (It failed
  closed: forgeries were still refused.) Every test suite had mocked the same
  wrong path, which is why it went unnoticed.
- **The anchor message changed in v3.2.2, and 0.5.0 knew only the old one.**
  Verification now supports both forms and picks by the anchor's height — never
  by trying both, because the old form carries no chain id and is valid on every
  chain. See *Added*.
- **The health monitor and the Watchtower read a block height as a Unix
  timestamp.** A batch's `submitted_at` is a height, so every batch age and
  challenge deadline they reported was wrong, and the Watchtower raised its
  "window closing" alert at once for every batch. Both now apply the chain's own
  rules (see *Added*), using each rollup's own window rather than the global
  default.
- **The latest-batch read used a route the chain does not serve**
  (`/batches/{id}?latest=true`); the node answered with the first page of the
  list, read as one empty batch, so health reported "no batches yet" for every
  rollup. It now uses `/latest_batch/{id}`. All five clients.
- **Batch lists stopped at the first page.** The chain's `Batches` query is
  paged (50 per page), so the Watchtower never saw a batch past #49. Lists now
  follow every page, and the Watchtower polls forward from the oldest batch whose
  window is still open — so it also keeps re-judging a batch as its deadline
  approaches, instead of judging it once on first sight.
- **Cross-VM calls used the wrong function.** The RDK encoded
  `executeCrossVMCall(string,bytes)`; the chain's precompile decodes
  `executeCrossVMCall(uint8,string,bytes)`. The selectors differ, so no call
  encoded by an earlier release could reach the precompile, even on a network
  that had activated it. The new encoding round-trips through the chain's own
  decoder.
- **The `multivm-rollup` template reported success for calls that never
  happened.** It checked only the call's `success` flag, and a call to an
  inactive precompile succeeds with empty data. It now requires a non-empty
  acknowledgement from the target.
- **The rollup templates could not create a rollup on either network.** They
  signed classical-only, which both networks refuse, and their READMEs said to
  "swap in the SDK's signer", which cannot work. They now sign hybrid (see
  *Added*).
- **The Go and Java monitors reported their own shutdown as an error.**
  Stopping a watcher mid-request surfaced a spurious `context canceled` to
  `OnError`.
- The `qorechain-pqc` dependency of the Python, Go, Rust and Java clients was
  bounded below 0.2, so they could not receive its exact-length ML-DSA-87
  verification. They now take the 0.2 line.

### Added

- **Anchor sign-bytes v2** (`anchorSignBytesV2`, `anchorSignBytesVersionFor`) in
  all five languages, alongside v1. The v2 message is length-prefixed, binds the
  chain id, and for a rollup batch commits the **batch index** — so an anchor can
  no longer be relabelled between batches or networks.
- **Receipt schema v2** records `chainId`; verification refuses a receipt
  checked against a node for another chain, and reports `signBytesVersion` and a
  `chainBinding` check. Version-1 receipts still verify.
- **Anchored batches.** `MsgSubmitBatch` gains `anchor_signature` and
  `validator_set_hash` (fields 10 and 11). `RdkTxClient.submitBatch` signs the
  anchor when this client is the rollup's creator and signs hybrid — the only
  case in which the chain will accept it — and otherwise submits unanchored as
  before; `anchor: "require"` refuses instead. `anchorSignBytesForBatch` builds
  the bytes for a creator signing out of band.
- **Challenge windows measured as the chain measures them**
  (`batchChallengeWindow`): seconds of block time for a batch with a recorded
  submission time (v3.2.4+), `window / 6` blocks from the submission height
  otherwise. Reports `open` and `finalizable` separately, since for one block on
  the block-count path a batch is both. Judged against the chain tip
  (`getChainTip`), not the local clock. All five languages.
- **Post-quantum key resolution** (`resolvePqcKeypair`, `pqcKeypairFromEnv`):
  derives both the canonical and the legacy ML-DSA-87 key from a mnemonic and
  returns the one the account has registered on chain; refuses rather than
  guesses when the account holds a different key. `QORE_PQC_SEED_HEX` supplies
  a seed for operators who sign with a raw private key. The templates use it.
- **Chain rules checked before a fee is paid**, in all five languages: the
  v3.2.2 rollup-id grammar (`rollupIdError`) at validation and creation, and the
  v3.2.3 withdrawal checks (`withdrawalErrors`) before broadcast.
- **`isCrossVmPrecompileActive`** — whether the cross-VM precompile is live on a
  network. It is not yet active on mainnet or testnet.
- `RollupView` gains `escrowBalance` and, from v3.2.4, `challengeWindowSec`,
  `challengeBond` and `proofSystem`; `BatchView` gains `submittedTime`.
- `listBatchesPage` / `listBatches({ startIndex })`; typed `msgResponses` are
  forwarded from hybrid broadcasts.
- `RELEASING.md`.

### Changed

- **`@qorechain/sdk` `^0.9.0`** and **`@qorechain/evm` `^0.8.0`**.
- **Breaking:** `encodeCrossVmCalldata` takes `targetVm` and encodes the
  chain's three-argument signature; `CROSS_VM_DEFAULT_SIGNATURE` changed
  accordingly. `RollupHealth` replaces the seconds-based deadline with a
  `challengeWindow` (`batchAgeSecs` is set only when the node records the
  submission time); `BatchDeadline` gains `window`. The Rust `watch_rollup`
  takes a chain-tip source instead of a clock, and Java's
  `verifySettlementReceipt(receipt, RestClient)` now needs the network.
- Templates pin `@qorechain/rdk` `^0.6.0`.
- Docs: the sign-bytes `"auto"` caveat is gone (the resolver recognises both
  plan names); the Multi-VM and Watchtower guides were rewritten; challenge-window
  durations are stated as they really are on each network.

## 0.5.0

### Added

- **`qorollup receipt verify <file>` — verify a receipt somebody handed you.**
  The existing `--verify` flag only ever checked a receipt the same command had
  just built from chain, so the relying party the feature exists for — an
  auditor, an exchange, a counterparty handed a receipt file — had no way to
  check one at all. The new subcommand reads a receipt (file or stdin), verifies
  exactly what was presented without rebuilding it, and reports each check
  individually so a failure says *which* claim did not hold. Exit code is `0`
  only for a genuine receipt, so it works as a CI gate. A malformed or truncated
  file is reported as such, naming the missing fields, so "this file is broken"
  is distinguishable from "this receipt is a lie".
- **Real hybrid (post-quantum) transaction signing in the TypeScript tx client.**
  Passing `pqcKeypair` to `RdkClient.connectTx` / `RdkTxClient.connect` makes the
  client sign and broadcast every transaction through `@qorechain/sdk`'s
  `signAndBroadcastHybrid`, so the ML-DSA-87 half travels as the transaction-body
  extension the chain requires alongside the classical secp256k1 signature.

  This corrects a documented claim that was false. The tx client signed through
  cosmjs's `SigningStargateClient`, which cannot build such a transaction, so the
  RDK's transaction path was **classical-only in every language** — including
  TypeScript, which the README said supported hybrid signing — while mainnet
  (`qorechain-vladi`) and testnet (`qorechain-diana`, since chain v3.1.98) both
  require the hybrid signature on native-lane transactions.

  New `RdkTxClientConnectOptions` fields, all optional and additive (the
  classical path is byte-for-byte unchanged when `pqcKeypair` is absent):

  | Option | Meaning |
  | --- | --- |
  | `pqcKeypair` | ML-DSA-87 keypair. Present ⇒ the client signs hybrid. |
  | `rest` | REST/LCD base URL used by `signBytesVersion: "auto"`. |
  | `signBytesVersion` | `"auto"` (default), or `"v1"` / `"v2"` to force a form. |
  | `includePqcPublicKey` | Embed the PQC public key so the chain can register it on first use. |

  `RdkClient.connectTx` defaults `rest` to the resolved network's REST endpoint,
  so `"auto"` works out of the box; an explicit `rest` or `signBytesVersion` from
  the caller wins. The signer must be an `OfflineDirectSigner` (SIGN_MODE_DIRECT)
  — an amino-only signer is rejected with an explicit error. Fees are resolved to
  an explicit `StdFee`: an `StdFee` passes through, a number is priced as a gas
  limit, and `"auto"` simulates and applies the 1.4 multiplier; with no gas price
  and no explicit fee the client throws rather than guess. The tx methods keep
  returning the same `DeliverTxResponse` shape, so no call site changes.

  Also re-exported from `@qorechain/sdk`: `resolveSignBytesVersion`,
  `isHybridSignBytesRejection`, and the `SignBytesVersionOption` / `PqcKeypair`
  types. New: `RdkTxClient.isHybrid`, and an options argument on
  `RdkTxClient.fromClient` for driving the hybrid path against a custom transport.

  *(TypeScript only. The Python, Go, Rust, and Java clients remain
  classical-only in this release and are unsuitable for native-lane transactions
  on mainnet or `qorechain-diana`.)*

### Security

- **Settlement-receipt verification no longer accepts fabricated receipts**
  (reported through the Break QoreChain bug bounty). `verifySettlementReceipt`
  could be made to return `valid: true` for a receipt that was entirely made up:
  - its "binding" check compared `stateRoot` with `batchStateRoot` — two fields
    of the *same caller-supplied object*, so it proved nothing; and
  - nothing was checked against the chain, so an attacker could generate their
    own ML-DSA-87 keypair, invent a state root, sign the canonical anchor
    message, and produce a receipt that verified.

  A receipt is a **claim, not evidence**. Verification now re-reads the claim
  from live chain state and reports `valid: true` only when the receipt
  reproduces what the chain holds: the rollup really belongs to that layer, the
  chain's batch carries that state root, **an anchor matching the receipt exists
  on chain**, the creator matches the chain's registered creator, and the
  Dilithium-5 signature verifies under the key the *chain* holds for them.

### Changed (breaking)

- `verifySettlementReceipt` now takes `client` for a real verification. The
  result gains `mode: "chain" | "signature-only"`, and `checks` is replaced by
  `rollupLayerBinding`, `batchStateRoot`, `anchorOnChain`, `creatorAuthority`,
  and `pqcSignature` (the old `stateRootBinding` and `hasMaterial` are gone).
- Passing only `creatorPublicKey` is now **`mode: "signature-only"` and never
  `valid`** — by design. It shows that someone signed those bytes; it cannot
  show the anchor exists. Code that relied on offline verification returning
  `valid: true` must pass a `client`.
- Documentation corrected: receipts are **not** "fully offline verifiable". The
  guides now state that chain verification is required, and that your trust
  anchor is the node you query.

Applied in all five language clients.

### Added

- **Real hybrid (post-quantum) transaction signing in the TypeScript tx client.**
  `RdkTxClient` previously signed classical-only through cosmjs, which cannot
  build a hybrid transaction at all — so RDK transactions were refused on every
  network that enforces the post-quantum signature. Pass `pqcKeypair` (and
  `rest`) on connect and the client now signs hybrid through
  `@qorechain/sdk`'s hybrid path. `signBytesVersion` defaults to `"auto"` (the
  REST endpoint from your network preset is supplied for you) and accepts an
  explicit `"v1"`/`"v2"` override for networks whose upgrade plan name differs
  from the one `"auto"` looks up. Re-exports `resolveSignBytesVersion` and
  `isHybridSignBytesRejection`.

### Changed

- **`@qorechain/sdk` bumped to `^0.8.0`** — the release that added the v1/v2
  hybrid sign-bytes resolver. The previous `^0.7.0` pin could not reach it
  (a caret on a `0.x` version is locked to that minor).
- **Scaffolded projects now get the fixed RDK.** Every
  `create-qorechain-rollup` template pinned `@qorechain/rdk` at `^0.2.0`, and a
  caret on a `0.x` version is locked to that minor — so a rollup scaffolded
  today installed **0.2.x**, the release with the broken receipt verifier, no
  matter how many versions had shipped since. All six templates now pin
  `^0.5.0`.
- **Documented what a receipt does *not* prove.** The canonical anchor message
  covers `layer_id`, `layer_height`, `state_root` and `validator_set_hash` — it
  does not name the rollup or the batch, because an anchor is a layer-level
  object. Verification binds `rollupId` and `batchIndex` through chain reads
  instead, so a receipt cannot assert a state root the chain does not hold for
  that batch. The residual case is now stated in the guide: where two batches
  genuinely share a state root on the same layer under the same creator, a
  genuine anchor signature can be relabelled between them. Closing that requires
  the anchor message to commit to the rollup and batch, which is a chain-side
  change.
- **The CLI no longer ships two stale packages.** `@qorechain/sdk` and
  `@qorechain/evm` were runtime dependencies of `@qorechain/rdk-cli` but imported
  nowhere in its source, so every install pulled them and forced a second, older
  copy of the SDK into the tree. The SDK moved to `devDependencies` at `^0.8.0`
  (only the test suite uses it), leaving one SDK version resolved.
- **Corrected a false claim in the README.** It stated that the TypeScript path
  supported hybrid signing while Python, Go, Rust and Java were classical-only.
  In fact no language signed hybrid. TypeScript now genuinely does; the other
  four remain classical-only and are not suitable for native-lane transactions
  on a network that requires the post-quantum signature.

## 0.4.4

### Changed

- **Bumped `@qorechain/sdk` to `^0.7.0`** — the SDK's "authenticator lanes"
  release (chain v3.1.85). Purely additive: a linked external key (Phantom
  ed25519 or a MetaMask secp256k1 key) can spend from the one canonical
  PQC-required account through a relayer under least-privilege, spending-limited,
  revocable terms (`MsgExecuteEVM`/`MsgExecuteCosmos`), plus same-algorithm PQC
  key rotation (`MsgRotatePQCKey`) and Phantom/MetaMask execute builders. No RDK
  API change — the new capabilities are available to TypeScript users directly
  through `@qorechain/sdk`. `@qorechain/evm` stays `^0.5.1` (the SDK 0.7.x line
  still uses it). All packages version-aligned to 0.4.4.

## 0.4.3

### Fixed

- **Hybrid-signature transaction encoding** — bumped the `@qorechain/sdk`
  dependency from `^0.5.1` to `^0.6.1`, which carries the fix for a
  consensus-critical bug: the `/qorechain.pqc.v1.PQCHybridSignature` tx-body
  extension was serialized as JSON into `Any.value` instead of protobuf, so the
  chain rejected every hybrid-signed transaction at CheckTx (the leading `0x7b`
  `{` was misread as protobuf field 15 `start_group`). With `@qorechain/sdk`
  ≥ 0.6.1 the extension is protobuf-encoded (value begins `0x08`) and hybrid
  transactions are accepted. Affects only the TypeScript hybrid-signing path
  (`HybridSigner`); the Python, Go, Rust, and Java clients sign classical-only
  and were never impacted (version-aligned to 0.4.3 only).

## 0.4.2

### Added

- **Public network endpoints in the presets.** The `mainnet` and `testnet`
  presets now ship the live `qore.host` / `*-testnet.qore.host` endpoints, so
  `createRdkClient({ network })` reaches the chain out of the box. Localhost
  defaults remain available (`LOCALHOST_ENDPOINTS`) for local nodes. (All five
  language clients.)
- **`native` VM type** — the QoreChain Native (Wasm) runtime. New helpers
  `isVmType`, `vmTypeWireValue`, and `vmTypeLabel`. (All five clients.)

### Changed

- **Rebrand to "QoreChain Native".** The Wasm rollup VM is now `native`
  throughout the docs, labels, and the `nft` preset. `cosmwasm` remains an
  accepted legacy alias, and both `native` and `cosmwasm` map to `cosmwasm` on
  the wire (the chain, explorer, and dashboard are unchanged). Multi-VM tooling
  now reads as "EVM → QoreChain Native"; the cross-VM precompile ABI
  (`executeCrossVMCall`) is unchanged.
- Documented unified-key / Phantom compatibility: a single unified key
  (qor1/0x/svm) signs RDK operator transactions like any signer (chain v3.1.83).

## 0.4.1

### Changed

- Raised all gas-price defaults and examples from `0.025uqor` to `0.15uqor`
  (the chain now enforces a fee floor of 0.1uqor per gas unit on both
  networks): `qorollup` CLI default, scaffold templates, examples, and docs.
- Docs, templates, and examples now reference the live public endpoints
  (`rpc/api/evm/svm[-testnet].qore.host`, `wss://rpc[-testnet].qore.host/websocket`)
  and the public explorer (explore.qore.network) instead of placeholder hosts.
- `@qorechain/sdk` dependency raised to `^0.5.1` (deterministic ML-DSA-87
  hybrid signing, as required by the chain).
- `qorechain-pqc` dependency ranges raised to accept the deterministic 0.1.1
  release: Python `>=0.1.1,<0.2`, Rust `0.1.1`, Go `v0.1.1`, Maven `[0.1.0,0.2)`.

### Documentation

- Added an explicit note to the Python, Go, Rust, and Java (JVM) packages:
  mainnet requires the hybrid PQC signature extension on native-lane
  transactions; those clients currently sign classical-only (SIGN_MODE_DIRECT)
  and should be used on permissive networks or paired with the `qorechain-pqc`
  bindings. The TypeScript path supports hybrid signing via `@qorechain/sdk`.

## 0.3.0

### Added

- Full **Python**, **Go**, and **Rust** clients (each v0.3.1), mirroring the
  TypeScript surface: config builder + validation, the five presets, denom /
  economics / bech32 utilities, binary-Merkle and withdrawal-proof helpers,
  rollup manifests, REST and `qor_` JSON-RPC read clients, preflight / health,
  accounts (mnemonic → secp256k1 → `qor` address), and transaction signing +
  broadcast (SIGN_MODE_DIRECT). All three are verified against shared
  cross-language golden vectors and covered by per-language CI (`ci-py`,
  `ci-go`, `ci-rust`). Live broadcast requires a node endpoint.

## 0.2.0

### Added

- `@qorechain/rdk` 0.2.0 — operator-grade helpers built on the existing surface:
  - `checkPreflight` (the `doctor` engine), `getRollupHealth`, `watchRollup`,
    and `eventsFromTxHash` for readiness checks and live monitoring.
  - Accounts via `@qorechain/sdk`: `signerFromEnv`, `generateMnemonic`,
    `deriveNativeAccount`, and the hybrid post-quantum signer.
  - `toManifest` / `fromManifest` — a portable rollup manifest.
  - Binary-Merkle utilities and `assembleWithdrawalProof` for withdrawals.
  - `MockTxClient` and `RdkTxClient.simulate` for offline flows and dry runs.
  - A configurable faucet helper and bank balance reads.
- `@qorechain/rdk-cli` (`qorollup`) — a new operator command line: `doctor`,
  `create` (+ `--dry-run`), `status`, `watch`, `params`, `suggest`,
  `pause`/`resume`/`stop`, `keygen`, `manifest`, `withdraw`, and `faucet`.
- Documentation: the `qorollup` reference, a zero-to-rollup tutorial, and
  monitoring, withdrawals, keys & funding, and local/dry-run guides.

### Changed

- Templates sign via `signerFromEnv`, depend on `@qorechain/rdk` ^0.2.0, ship
  `doctor`/`status` scripts and a CI workflow, and document the operator CLI.
  `create-qorechain-rollup` is now 0.2.0.

## create-qorechain-rollup 0.1.1

### Changed

- The `defi-rollup` template now ships checked-in Groth16 reference artifacts
  (`circuits/artifacts/`), so the reference SNARK prover generates and locally
  verifies a real proof out of the box. Rebuild them any time with
  `pnpm circuit:build` (requires the `circom` compiler).

## 0.1.0 — Initial release

### Added

- `@qorechain/rdk` (TypeScript): typed rollup configuration with the settlement →
  proof compatibility matrix and the based-sequencer constraint enforced
  client-side; the five preset profiles; the rollup and settlement-batch
  lifecycles; native data availability with the Celestia "planned" guard; REST and
  `qor_` JSON-RPC read clients; a QCAI-assisted `suggestProfile` with a documented
  `defi` fallback; and denomination, economics, and address utilities.
- `create-qorechain-rollup`: an interactive scaffolder for the five profile
  templates (defi/gaming/nft/enterprise/custom), each runnable against the public
  testnet, with a reference SNARK prover in the defi template.
- Python, Go, and Rust package scaffolds mirroring the TypeScript conceptual
  surface, marked "coming soon".
- A documentation site, a runnable examples gallery, and CI with a
  forbidden-term / secret security-scan gate.
