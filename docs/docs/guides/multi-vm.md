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
lists its address in the EVM parameter `active_static_precompiles`, which does
**not** list it on either network (checked 27 October 2026). It also reaches only
the targets governance allowlists in the cross-VM parameter
`bridge_allowed_targets` (each `<vm>:<contract>`), which is empty on the testnet.

Until then, **a call to it succeeds and does nothing.** Its address has no code,
and the EVM treats a call to such an address as a success with empty return
data. Check first — see below.
:::

## Will my call reach its target?

```ts
import { crossVmTargetReady, getCrossVmParams } from "@qorechain/rdk";

const status = await crossVmTargetReady("https://api-testnet.qore.host", "qor1…");
console.log(status.ready, status.reason);
// e.g. "cosmwasm:qor1… is not in bridge_allowed_targets; governance must allowlist it"

const params = await getCrossVmParams("https://api-testnet.qore.host");
console.log(params.enabled, params.bridgeAllowedTargets);
```

`crossVmTargetReady` reads `active_static_precompiles` (`/cosmos/evm/vm/v1/params`,
also on its own as `isCrossVmPrecompileActive`) and, from chain v3.2.5, the
cross-VM parameters at `/qorechain/crossvm/v1/params`, and says which condition
blocks the call: the precompile inactive, the bridge disabled, or the target not
allowlisted.

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

## The result, and refusals (chain v3.2.5)

From chain v3.2.5 the precompile answers only
`executeCrossVMCall(uint8,string,bytes) returns (bytes)` (a two-argument call is
refused with "unknown method"), as a plain `CALL` with no value:

- its return data is `abi.encode(bytes)`: the Native contract's response, often
  empty. Decode it with `abi.decode(ret, (bytes))`, or off chain with
  `decodeCrossVmResult`;
- a refusal (target not allowlisted, the Native contract failing, out of gas)
  reverts with `Error(string)`; read it with `decodeRevertReason`;
- the Native contract sees the **calling contract**, as its `qor1` address, as
  the sender, not `tx.origin`.

## The Solidity side

```solidity
address constant CROSS_VM_PRECOMPILE = 0x0000000000000000000000000000000000000901;
uint8 constant TARGET_NATIVE = 1;

function callNative(string calldata nativeContract, bytes calldata msg_)
    external returns (bytes memory result)
{
    bytes memory data = abi.encodeWithSignature(
        "executeCrossVMCall(uint8,string,bytes)", TARGET_NATIVE, nativeContract, msg_
    );
    (bool ok, bytes memory ret) = CROSS_VM_PRECOMPILE.call(data);
    if (!ok) {
        assembly { revert(add(ret, 32), mload(ret)) } // pass the chain's reason through
    }
    // An inactive precompile returns nothing; an active one at least 64 bytes.
    require(ret.length >= 64, "cross-VM precompile inactive: the call reached no contract");
    result = abi.decode(ret, (bytes));
}
```

A `require(ok)` on its own is not enough: against an inactive precompile it
passes, and your contract carries on as if the call had happened. The length
check closes that.

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
