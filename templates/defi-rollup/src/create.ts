import "dotenv/config";
import { estimateCreationCost, uqorToQor } from "@qorechain/rdk";
import { buildConfig } from "../rollup.config.js";
import { getClient, GAS_PRICE, ROLLUP_ID } from "./client.js";
import { getSigner } from "./signer.js";

async function main(): Promise<void> {
  // Validate the configuration against the compatibility matrix before anything.
  const config = buildConfig().validate();
  const { warnings } = config.validationResult();
  warnings.forEach((w) => console.warn(`note: ${w}`));

  const client = getClient();

  // Read the live module parameters; never hardcode the stake or burn rate.
  const params = await client.params();
  const cost = estimateCreationCost({
    stakeUqor: params.minStakeForRollup,
    burnRate: params.rollupCreationBurnRate,
  });
  console.log(`Creating rollup "${ROLLUP_ID}" (profile: defi)`);
  console.log(
    `Stake: ${uqorToQor(cost.stakeUqor)} QOR — burned on creation: ${uqorToQor(cost.burnUqor)} QOR`,
  );

  const signer = await getSigner();
  const tx = await client.connectTx(signer, { gasPrice: GAS_PRICE });
  const msg = config.toCreateMsg(tx.address, { stakeAmount: params.minStakeForRollup });

  const res = await tx.createRollup({
    rollupId: msg.rollupId,
    profile: msg.profile,
    vmType: msg.vmType,
    stakeAmount: msg.stakeAmount,
  });
  console.log(`Submitted: ${res.transactionHash} (code ${res.code})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
