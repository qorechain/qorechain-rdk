/**
 * Build the EVM calldata for a cross-VM call: from an EVM (Solidity) context on
 * your rollup, invoke a CosmWasm contract through QoreChain's cross-VM
 * precompile at 0x…0901.
 *
 * This script only *encodes* the calldata — send it from your Solidity contract
 * (see ../contracts/CrossVmCaller.sol) or from an EVM tx whose `to` is the
 * precompile address. The EVM↔CosmWasm bridge is the supported cross-VM path;
 * SVM cross-calls are separate.
 *
 * Run: npm run crossvm-call
 */
import {
  CROSS_VM_PRECOMPILE,
  CROSS_VM_DEFAULT_SIGNATURE,
  encodeCrossVmCalldata,
  functionSelector,
} from "@qorechain/rdk";

// The CosmWasm contract you want to call, and its execute message (JSON).
const cosmwasmContract = process.env.QORE_CW_CONTRACT ?? "qor1examplecontractxxxxxxxxxxxxxxxxxxxxxxx";
const executeMsg = JSON.stringify({ increment: {} });

const calldata = encodeCrossVmCalldata({
  contract: cosmwasmContract,
  msg: executeMsg,
});

console.log("Cross-VM precompile :", CROSS_VM_PRECOMPILE);
console.log("Signature           :", CROSS_VM_DEFAULT_SIGNATURE);
console.log("Selector            :", functionSelector(CROSS_VM_DEFAULT_SIGNATURE));
console.log("Target CosmWasm     :", cosmwasmContract);
console.log("Execute msg         :", executeMsg);
console.log("EVM calldata        :", calldata);
console.log();
console.log("Send an EVM transaction with:");
console.log(`  to:   ${CROSS_VM_PRECOMPILE}`);
console.log("  data: <the calldata above>");
console.log();
console.log("Confirm the precompile's exact ABI signature against your node before relying on the selector.");
