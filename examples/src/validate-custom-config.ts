/**
 * Override a custom configuration and inspect validation errors, then show a
 * valid variant — all locally, no node required.
 *
 * The compatibility matrix the chain enforces pairs each settlement paradigm
 * with specific proof systems: `optimistic → fraud`, `zk → snark | stark`,
 * `based → none`, `sovereign → none`. Here we deliberately set an INVALID
 * combination (`settlement: "zk"` with `proofSystem: "fraud"`) and read the
 * `errors` from `validationResult()`. Then we fix it to a compatible pair and
 * confirm it validates.
 *
 * Run:
 *   pnpm tsx src/validate-custom-config.ts
 */
import { presets } from "@qorechain/rdk";

export async function main(): Promise<void> {
  // 1) Invalid: zk settlement cannot carry a fraud proof.
  const invalid = presets
    .custom({ rollupId: "custom-invalid" })
    .set({ settlement: "zk", proofSystem: "fraud" });

  const invalidResult = invalid.validationResult();
  console.log("invalid config:");
  console.log(`  valid: ${invalidResult.valid}`);
  invalidResult.errors.forEach((e) => console.log(`  error: ${e}`));
  console.log();

  // 2) Valid: zk settlement with a snark proof is a compatible pair.
  const valid = presets
    .custom({ rollupId: "custom-valid" })
    .set({ settlement: "zk", proofSystem: "snark" });

  const validResult = valid.validationResult();
  console.log("valid config:");
  console.log(`  valid: ${validResult.valid}`);
  validResult.warnings.forEach((w) => console.log(`  warning: ${w}`));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
