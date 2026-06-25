import { presets, type RollupConfigBuilder } from "@qorechain/rdk";
import { ROLLUP_ID } from "./src/client.js";

/**
 * The DeFi profile: zk-SNARK settlement, dedicated sequencer, native DA,
 * EIP-1559 gas, EVM. Override fields via `.set({ ... })` if needed; the
 * compatibility matrix is enforced on `.validate()` / `.build()`.
 */
export function buildConfig(): RollupConfigBuilder {
  return presets.defi({ rollupId: ROLLUP_ID });
}
