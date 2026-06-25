/**
 * Build a rollup configuration from each of the five preset profiles and
 * validate it locally — no node and no broadcast required.
 *
 * Each preset (`presets.defi`, `presets.gaming`, `presets.nft`,
 * `presets.enterprise`, `presets.custom`) returns a `RollupConfigBuilder`
 * pre-filled with that profile's documented defaults. Calling
 * `.validationResult()` runs the configuration through the on-chain rules (the
 * settlement → proof matrix, the based-settlement constraint, value-set and
 * field checks) and returns `{ valid, errors, warnings }` without touching the
 * network. The `nft` preset uses Celestia DA, which is selectable but not yet
 * active, so it surfaces a non-fatal warning.
 *
 * Run:
 *   pnpm tsx src/create-from-presets.ts
 */
import { presets } from "@qorechain/rdk";
import type { ProfileName } from "@qorechain/rdk";

const PROFILES: ProfileName[] = ["defi", "gaming", "nft", "enterprise", "custom"];

export async function main(): Promise<void> {
  for (const profile of PROFILES) {
    const rollupId = `${profile}-demo`;
    const builder = presets[profile]({ rollupId });
    const result = builder.validationResult();

    console.log(`profile "${profile}" (rollupId: ${rollupId})`);
    console.log(`  valid:    ${result.valid}`);
    if (result.errors.length > 0) {
      result.errors.forEach((e) => console.log(`  error:    ${e}`));
    }
    if (result.warnings.length > 0) {
      result.warnings.forEach((w) => console.log(`  warning:  ${w}`));
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
