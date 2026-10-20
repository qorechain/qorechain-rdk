# Releasing

The RDK ships to five registries from one tag. Each step below exists because
skipping it has, at some point, shipped something broken.

## 1. Before you tag

- **Bump every version together.** `packages/ts/package.json`,
  `packages/rdk-cli/package.json`, `cli/package.json`, `packages/py/pyproject.toml`
  and `src/qorrdk/__init__.py`, `packages/rust/Cargo.toml`, `packages/jvm/pom.xml`,
  the Go `Version` constant in `packages/go/constants.go`, and the TypeScript
  `VERSION` export in `packages/ts/src/index.ts`.
- **Bump the templates' `@qorechain/rdk` pin.** A caret on a `0.x` version is
  locked to that minor: `^0.5.0` never resolves `0.6.0`. A template left on the
  old pin scaffolds every new project onto the old release, whatever has shipped
  since.
- **Check every `0.x` dependency pin the same way** (`@qorechain/sdk`,
  `@qorechain/evm`, `qorechain-pqc` in all four non-TS packages). The registry
  having a newer version does not mean the RDK can reach it.
- **Sync the golden fixture.** `packages/_fixtures/golden.json` is copied into
  each package's tests; all five copies must be identical.

## 2. Verify

- Run every suite: `pnpm -r test`, `pytest`, `go test ./...`, `cargo test`, and
  `mvn test`.
- **Check Maven's exit code, and delete `target/surefire-reports` first.** If
  test compilation fails, surefire never runs, and the reports from the previous
  run still read as a pass.
- Build the docs site: `pnpm -C docs build`.
- **Scan for forbidden terms and secrets.** Quote every glob passed to `grep`
  (`--exclude="*.log"`, not `--exclude=*.log`): under zsh an unquoted glob that
  matches nothing aborts the command, and an `echo "clean"` after it then reports
  a scan that never ran. Read the hit count, not the message.

## 3. Publish

Publish from a **clean git worktree at the tag**, never from a working tree
that may already hold the next release's work:

```bash
git worktree add ../qorechain-rdk-vX.Y.Z vX.Y.Z
```

- **npm — always `pnpm publish`, never `npm publish`.** `@qorechain/rdk-cli` and
  `create-qorechain-rollup` depend on `@qorechain/rdk` as `workspace:*`; pnpm
  rewrites that to the concrete version, npm uploads it literally and breaks
  every install.
- **Go** publishes by tag, and the module lives in a subdirectory, so it needs
  its own tag: `packages/go/vX.Y.Z` in addition to `vX.Y.Z`.
- **Maven Central** deploys outlast a two-minute command timeout; run
  `mvn -B deploy -DskipTests` in the background. If it is interrupted, the
  Portal deployment usually carries on server-side: the **first** deploymentId is
  the real one, and a retry fails as a duplicate.
- **crates.io** and **PyPI** as usual.

## 4. After publishing

- **Read each registry back** rather than trusting the publish output: npm
  version and `dist-tags.latest` (and that `workspace:*` became a concrete
  version), PyPI, the crates.io sparse index, Maven `maven-metadata.xml`, and
  `proxy.golang.org`.
- **Push `main` together with the publish, not ahead of it.** The docs site
  deploys on every push touching `docs/**`, so docs describing a fix go live the
  moment they are pushed.
- Create the GitHub release from the tag. Public release notes carry no internal
  report identifiers and no reporter details.
