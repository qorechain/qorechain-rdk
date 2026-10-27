/**
 * Build the EVM calldata for a cross-VM call — from an EVM (Solidity) context on
 * your rollup into a QoreChain Native contract, through QoreChain's cross-VM
 * precompile at 0x…0901 — after checking that the precompile is actually live.
 *
 * Read this first: the precompile is not active on mainnet or testnet today. It
 * runs only once governance lists its address in the EVM parameter
 * `active_static_precompiles`, and it reaches only targets governance
 * allowlists in `bridge_allowed_targets`. Until then a call to it succeeds with
 * empty data and does nothing, so this script checks both first. From chain
 * v3.2.5 the result is ABI-encoded bytes (decode with `decodeCrossVmResult`)
 * and a refusal reverts with a reason (`decodeRevertReason`).
 *
 * If you send through a scoped EVM authorisation window (chain v3.2.3), note
 * that `native_only: true` refuses any calldata — a cross-VM call included —
 * and a non-empty `allowed_targets` must list the precompile's address.
 *
 * Run: npm run crossvm-call
 */
import {
  CROSS_VM_PRECOMPILE,
  CROSS_VM_DEFAULT_SIGNATURE,
  CROSS_VM_TARGET,
  crossVmTargetReady,
  encodeCrossVmCalldata,
  functionSelector,
} from "@qorechain/rdk";
import { getClient } from "./client.js";

const client = getClient();

// The QoreChain Native contract you want to call, and its execute message (JSON).
const nativeContract = process.env.QORE_CW_CONTRACT ?? "qor1examplecontractxxxxxxxxxxxxxxxxxxxxxxx";
const executeMsg = JSON.stringify({ increment: {} });

const status = await crossVmTargetReady(client.network.endpoints.rest, nativeContract);
console.log(`Cross-VM call to ${nativeContract} on ${client.network.chainId}: ${status.ready ? "READY" : "NOT READY"}`);
console.log(`  ${status.reason}`);
if (!status.ready) {
  console.log("  A call sent now would not reach the contract.");
}
console.log();

const calldata = encodeCrossVmCalldata({
  contract: nativeContract,
  msg: executeMsg,
  targetVm: CROSS_VM_TARGET.NATIVE,
});

console.log("Cross-VM precompile :", CROSS_VM_PRECOMPILE);
console.log("Signature           :", CROSS_VM_DEFAULT_SIGNATURE);
console.log("Selector            :", functionSelector(CROSS_VM_DEFAULT_SIGNATURE));
console.log("Target              :", nativeContract, "(QoreChain Native)");
console.log("Execute msg         :", executeMsg);
console.log("EVM calldata        :", calldata);
console.log();
console.log("Send an EVM transaction with:");
console.log(`  to:   ${CROSS_VM_PRECOMPILE}`);
console.log("  data: <the calldata above>");
