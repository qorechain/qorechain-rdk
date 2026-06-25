# QoreChain RDK documentation site

The documentation site for `qorechain-rdk`, built with
[Docusaurus](https://docusaurus.io).

This is a **standalone** project — it is intentionally *not* part of the
monorepo's pnpm workspace. It has its own `package.json` and its own install, so
it never affects `pnpm install` / `pnpm -r build` / `pnpm -r test` at the repo
root.

## Develop

```sh
cd docs
npm install
npm start        # dev server at http://localhost:3000
```

## Build

```sh
cd docs
npm install
npm run build    # production build into docs/build (gitignored)
npm run serve    # preview the production build
```

## API reference (TypeDoc)

The TypeScript RDK ships TSDoc and a TypeDoc config:

```sh
cd docs
npm run docs:api   # generates the API reference into docs/docs/api
```

`docs/typedoc.json` points at the TypeScript package's entry point
(`../packages/ts/src/index.ts`). Generated API output is not committed.
