---
id: multi-vm
title: Multi-VM (cross-VM calls)
sidebar_position: 14
---

# Multi-VM (cross-VM calls)

A multi-VM rollup runs an EVM execution layer that can call into CosmWasm
contracts through a dedicated **cross-VM precompile**. The RDK ships the
TypeScript tooling to encode those calls and a scaffold template to start from.

> This tooling covers **EVM → CosmWasm** only. SVM is a separate runtime and is
> not part of the cross-VM precompile.

## The precompile

The cross-VM precompile is exposed at a fixed address:

```ts
import { CROSS_VM_PRECOMPILE } from "@qorechain/rdk";

console.log(CROSS_VM_PRECOMPILE); // 0x…0901
```

## Encoding a cross-VM call

`encodeCrossVmCalldata` builds the calldata your EVM contract sends to the
precompile to invoke a CosmWasm contract. `functionSelector` computes the 4-byte
selector for a Solidity function signature.

```ts
import { encodeCrossVmCalldata, functionSelector } from "@qorechain/rdk";

const calldata = encodeCrossVmCalldata({
  contract: "qor1cosmwasmcontractaddress...",
  msg: { transfer: { recipient: "qor1...", amount: "100" } },
});

const selector = functionSelector("callCosmwasm(string,bytes)");
```

## The Solidity side

From an EVM contract you call the precompile address with the encoded calldata.
The `multivm-rollup` template includes a `contracts/CrossVmCaller.sol` snippet
along these lines:

```solidity
// contracts/CrossVmCaller.sol
address constant CROSS_VM_PRECOMPILE = 0x0000000000000000000000000000000000000901;

function callCosmwasm(bytes memory calldata_) internal returns (bytes memory) {
    (bool ok, bytes memory out) = CROSS_VM_PRECOMPILE.call(calldata_);
    require(ok, "cross-vm call failed");
    return out;
}
```

## Scaffold a multi-VM rollup

A new template, `multivm-rollup`, scaffolds an EVM rollup wired to call CosmWasm,
including the `CrossVmCaller.sol` snippet:

```bash
npm create qorechain-rollup my-app -- --template multivm-rollup
```

See the [scaffolding CLI reference](../reference/cli.md) for all templates.
