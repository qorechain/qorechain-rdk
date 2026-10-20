---
id: multi-vm
title: Multi-VM (cross-VM calls)
sidebar_position: 14
---

# Multi-VM (cross-VM calls)

A multi-VM rollup runs an EVM execution layer that can call into QoreChain Native (Wasm)
contracts through a dedicated **cross-VM precompile**. The RDK ships the
TypeScript tooling to check whether the precompile is live, encode calls to it,
and a scaffold template to start from.

> This tooling covers **EVM → QoreChain Native** only. SVM is a separate runtime and is
> not part of the cross-VM precompile.

:::caution Not yet active on mainnet or testnet
The precompile is built into the validators' binary but runs only once governance
lists its address in the EVM parameter `active_static_precompiles`, which is
**empty on both networks today**. From chain v3.2.3 it also reaches only the
targets governance allowlists in the cross-VM parameter `bridge_allowed_targets`
(each `<vm>:<contract>`); every other target is refused. Activation is planned
for an upcoming release.

Until then, **a call to it succeeds and does nothing.** Its address has no code,
and the EVM treats a call to such an address as a success with empty return
data. Check first — see below.
:::

## Is it live?

```ts
import { isCrossVmPrecompileActive } from "@qorechain/rdk";

const status = await isCrossVmPrecompileActive("https://api.qore.host");
console.log(status.active, status.reason);
```

This reads `GET /cosmos/evm/vm/v1/params` and reports `active: true` only when
the precompile's address is listed in `active_static_precompiles`. It has to be
checked off-chain: the precompile returns the target's **raw** reply, so a
genuine call to a contract that returns nothing is *also* empty, and a
precompile has no bytecode whether active or not, so `extcodesize` cannot tell
either. Neither empty return data nor a code-size check distinguishes "inactive"
from "succeeded" inside a contract.

## Encoding a cross-VM call

The chain decodes `executeCrossVMCall(uint8 targetVM, string targetContract,
bytes payload)`, where `targetVM` is `1` for QoreChain Native.
`encodeCrossVmCalldata` builds exactly those bytes — they are checked against
the chain's own decoder:

```ts
import { encodeCrossVmCalldata, CROSS_VM_TARGET } from "@qorechain/rdk";

const calldata = encodeCrossVmCalldata({
  contract: "qor1nativecontractaddress...",
  msg: JSON.stringify({ transfer: { recipient: "qor1...", amount: "100" } }),
  targetVm: CROSS_VM_TARGET.NATIVE, // the default
});
// to: CROSS_VM_PRECOMPILE (0x…0901), data: calldata
```

:::note Releases before 0.6.0
They encoded a two-argument `executeCrossVMCall(string,bytes)`. That is a
different function selector, which the precompile never matched — so no call
encoded with an older release could have reached it, even on a network that had
activated it. Re-encode with 0.6.0 or later.
:::

## The Solidity side

Call the precompile with the same signature, and guard against the silent
success of an inactive precompile. The dependable in-contract guard is a target
that always returns a non-empty acknowledgement, which you then require:

```solidity
address constant CROSS_VM_PRECOMPILE = 0x0000000000000000000000000000000000000901;
uint8 constant TARGET_NATIVE = 1;

function callNative(string calldata nativeContract, bytes calldata msg_)
    external returns (bytes memory)
{
    bytes memory data = abi.encodeWithSignature(
        "executeCrossVMCall(uint8,string,bytes)", TARGET_NATIVE, nativeContract, msg_
    );
    (bool ok, bytes memory ret) = CROSS_VM_PRECOMPILE.call(data);
    require(ok, "cross-VM call failed");
    require(ret.length > 0, "cross-VM precompile inactive, or no acknowledgement");
    return ret;
}
```

A `require(ok)` on its own is not enough: against an inactive precompile it
passes, and your contract carries on as if the call had happened.

## EVM authorisation windows (chain v3.2.3)

If your EVM transactions are sent under a scoped authorisation window, two of
its options affect cross-VM calls:

- `native_only: true` narrows the window to plain transfers of native QOR and
  refuses any calldata — a cross-VM call included.
- A non-empty `allowed_targets` admits only transactions to the listed
  addresses, so it must include `0x0000000000000000000000000000000000000901`.

## Scaffold a multi-VM rollup

The `multivm-rollup` template scaffolds an EVM rollup wired to call QoreChain
Native (Wasm), with the live check, the encoder, and `CrossVmCaller.sol`:

```bash
npm create qorechain-rollup my-app -- --template multivm-rollup
```

See the [scaffolding CLI reference](../reference/cli.md) for all templates.
