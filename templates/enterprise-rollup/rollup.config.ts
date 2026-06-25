import { presets, type RollupConfigBuilder } from "@qorechain/rdk";
import { ROLLUP_ID } from "./src/client.js";

/**
 * The enterprise profile: based settlement, based sequencer, native DA,
 * subsidized gas, EVM. Permissioned-friendly with subsidized end-user fees
 * (20,000 tx/block). Override fields via `.set({ ... })` if needed; the
 * compatibility matrix is enforced on `.validate()` / `.build()` (based
 * settlement requires the `none` proof system and the based sequencer mode).
 */
export function buildConfig(): RollupConfigBuilder {
  return presets.enterprise({ rollupId: ROLLUP_ID });
}
