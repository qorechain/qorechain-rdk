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
    // "fraud" | "snark" | "stark" | "none".
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
  });

  // Compatibility matrix enforced by `.validate()` / `.build()`:
  //   optimistic → fraud
  //   zk         → snark | stark
  //   based      → none  (and requires the based sequencer mode)
  //   sovereign  → none
  // Pick a `settlement` and a matching `proofSystem`, or validation throws a
  // RollupConfigError describing the mismatch.
}
