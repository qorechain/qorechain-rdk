# Changesets

This directory is managed by [changesets](https://github.com/changesets/changesets).

When you make a change that affects a published package, add a changeset:

```sh
pnpm changeset
```

Pick the affected packages and the semver bump (patch / minor / major), and write
a short summary. All `@qorechain/*` packages are versioned together (see
`config.json`), so a bump to one bumps them in lockstep.
