/**
 * Offline flow — exercise the full create → lifecycle path with no node, using
 * MockTxClient. Great for learning the API and for tests.
 *
 * Run: pnpm tsx src/offline-mock.ts
 */
import { MockTxClient, RdkTxClient, presets } from "@qorechain/rdk";

export async function main(): Promise<void> {
  const mock = new MockTxClient();
  const tx = RdkTxClient.fromClient(mock, "qor1operator");

  const config = presets.defi({ rollupId: "demo" }).validate().build();

  await tx.createRollup({
    rollupId: config.rollupId,
    profile: config.profile,
    vmType: config.vmType,
    stakeAmount: "10000000000",
  });
  await tx.pauseRollup({ rollupId: config.rollupId, reason: "demo", currentStatus: "active" });
  await tx.resumeRollup({ rollupId: config.rollupId, currentStatus: "paused" });
  await tx.stopRollup({ rollupId: config.rollupId, currentStatus: "active" });

  console.log("Submitted (offline):");
  for (const call of mock.calls) {
    console.log(`  ${call.messages[0].typeUrl}`);
  }
  const gas = await tx.simulate(mock.calls[0].messages);
  console.log(`Simulated gas for the first message: ${gas}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
