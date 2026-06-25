import { presets, type RollupConfigBuilder } from "@qorechain/rdk";
import { ROLLUP_ID } from "./src/client.js";

/**
 * The NFT profile: optimistic settlement, dedicated sequencer, Celestia DA,
 * standard gas, CosmWasm VM. Override fields via `.set({ ... })` if needed; the
 * compatibility matrix is enforced on `.validate()` / `.build()` (optimistic
 * settlement requires the `fraud` proof system).
 *
 * Note: the profile selects Celestia DA, which is PLANNED — selectable but not
 * yet active on the network. Until it ships, submit batches with the `native`
 * backend (see `src/submit-batch.ts`).
 */
export function buildConfig(): RollupConfigBuilder {
  return presets.nft({ rollupId: ROLLUP_ID });
}
