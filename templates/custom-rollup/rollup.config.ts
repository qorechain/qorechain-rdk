import { presets, type RollupConfigBuilder } from "@qorechain/rdk";
import { ROLLUP_ID } from "./src/client.js";

/**
 * The custom profile is fully overridable. It starts from optimistic settlement,
 * a dedicated sequencer, native DA, standard gas, and an EVM, then lets you
 * `.set({ ... })` any field. `.validate()` (called in `src/create.ts`) enforces
 * the compatibility matrix — see the note at the bottom.
 */
export function buildConfig(): RollupConfigBuilder {
  return presets.custom({ rollupId: ROLLUP_ID }).set({
    // How the rollup settles to the Main Chain.
    // "optimistic" | "zk" | "based" | "sovereign".
    settlement: "optimistic",

    // Who orders the rollup's transactions.
    // "dedicated" | "shared" | "based".
    sequencer: "dedicated",

    // Where rollup data is made available.
    // "native" | "celestia" | "both". (celestia is planned / not yet active.)
    da: "native",

    // The proof a settlement batch carries. Must satisfy the matrix below.
    // "fraud" | "snark" | "none". ("stark" is paused on the network.)
    proofSystem: "fraud",

    // The fee / gas model the rollup charges end users.
    // "standard" | "eip1559" | "flat" | "subsidized".
    gasModel: "standard",

    // The execution environment the rollup exposes.
    // "evm" | "cosmwasm" | "svm" | "custom".
    vmType: "evm",

    // Target block time, in milliseconds.
    blockTimeMs: 1000,

    // Maximum transactions per rollup block.
    maxTxPerBlock: 10000,

    // From chain v3.2.8 a new optimistic rollup runs the qledger-v1 execution
    // model (its fraud proof re-executes the batch) and is based: anyone posts
    // data, and batches consume the inbox in order. Clear both if you switch
    // to zk, based or sovereign settlement.
    executionVm: "qledger-v1",
    sequencing: "based",
  });

  // Compatibility matrix enforced by `.validate()` / `.build()`:
  //   optimistic → fraud
  //   zk         → snark  (stark is paused on the network)
  //   optimistic also needs executionVm "qledger-v1" and sequencing "based"
  //   based      → none  (and requires the based sequencer mode)
  //   sovereign  → none
  // Pick a `settlement` and a matching `proofSystem`, or validation throws a
  // RollupConfigError describing the mismatch.
}
