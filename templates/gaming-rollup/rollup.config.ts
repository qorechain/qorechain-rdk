import { presets, type RollupConfigBuilder } from "@qorechain/rdk";
import { ROLLUP_ID } from "./src/client.js";

/**
 * The gaming profile: based settlement, based sequencer, native DA, flat gas,
 * custom VM. Tuned for high throughput (50,000 tx/block, 200ms blocks). Override
 * fields via `.set({ ... })` if needed; the compatibility matrix is enforced on
 * `.validate()` / `.build()` (based settlement requires the `none` proof system
 * and the based sequencer mode).
 */
export function buildConfig(): RollupConfigBuilder {
  return presets.gaming({ rollupId: ROLLUP_ID });
}
