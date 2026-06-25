/**
 * Rollup manifest — export a resolved config to a portable JSON snapshot and
 * load it back into a builder. No node required.
 *
 * Run: pnpm tsx src/manifest-roundtrip.ts
 */
import { presets, toManifest, stringifyManifest, parseManifest, fromManifest } from "@qorechain/rdk";

export async function main(): Promise<void> {
  const config = presets.gaming({ rollupId: "my-game", stakeAmountUqor: "10000000000" }).build();

  const manifest = toManifest(config, {
    network: "testnet",
    chainId: "qorechain-diana",
    addresses: { creator: "qor1creator" },
  });

  const json = stringifyManifest(manifest);
  console.log(json);

  const loaded = fromManifest(parseManifest(json));
  console.log(`Loaded rollup "${loaded.get().rollupId}" (profile ${loaded.get().profile})`);
  console.log(loaded.validationResult().valid ? "Config valid." : "Config invalid.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
