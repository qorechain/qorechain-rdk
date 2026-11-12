import { Registry, type GeneratedType } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import {
  MsgBondRollupSubmitter,
  MsgChallengeBatch,
  MsgCreateRollup,
  MsgDepositToRollup,
  MsgExecuteWithdrawal,
  MsgPauseRollup,
  MsgPostRollupData,
  MsgRegisterKEMKey,
  MsgResolveChallenge,
  MsgResumeRollup,
  MsgSetRollupMembers,
  MsgSetRollupSequencing,
  MsgSetVerificationKey,
  MsgStopRollup,
  MsgSubmitBatch,
  MsgUnbondRollupSubmitter,
  MsgUpdateVerificationKey,
} from "./codecs";

/** The `rdk` module message types, paired with their wire type URLs. */
export const RDK_TYPES: ReadonlyArray<[string, GeneratedType]> = [
  [MsgCreateRollup.typeUrl, MsgCreateRollup as GeneratedType],
  [MsgSubmitBatch.typeUrl, MsgSubmitBatch as GeneratedType],
  [MsgChallengeBatch.typeUrl, MsgChallengeBatch as GeneratedType],
  [MsgResolveChallenge.typeUrl, MsgResolveChallenge as GeneratedType],
  [MsgPauseRollup.typeUrl, MsgPauseRollup as GeneratedType],
  [MsgResumeRollup.typeUrl, MsgResumeRollup as GeneratedType],
  [MsgStopRollup.typeUrl, MsgStopRollup as GeneratedType],
  [MsgExecuteWithdrawal.typeUrl, MsgExecuteWithdrawal as GeneratedType],
  // chain v3.2.7+
  [MsgSetVerificationKey.typeUrl, MsgSetVerificationKey as GeneratedType],
  [MsgUpdateVerificationKey.typeUrl, MsgUpdateVerificationKey as GeneratedType],
  // chain v3.2.8+
  [MsgPostRollupData.typeUrl, MsgPostRollupData as GeneratedType],
  [MsgSetRollupSequencing.typeUrl, MsgSetRollupSequencing as GeneratedType],
  [MsgDepositToRollup.typeUrl, MsgDepositToRollup as GeneratedType],
  [MsgBondRollupSubmitter.typeUrl, MsgBondRollupSubmitter as GeneratedType],
  [MsgUnbondRollupSubmitter.typeUrl, MsgUnbondRollupSubmitter as GeneratedType],
  [MsgSetRollupMembers.typeUrl, MsgSetRollupMembers as GeneratedType],
  // x/pqc KEM registry (chain v3.2.5+), for private-rollup members.
  [MsgRegisterKEMKey.typeUrl, MsgRegisterKEMKey as GeneratedType],
];

/**
 * Build a `@cosmjs` {@link Registry} containing the default Cosmos SDK types and
 * the `rdk` module types. Pass this to `SigningStargateClient.connectWithSigner`
 * so `rdk` messages encode correctly.
 */
export function createRdkRegistry(): Registry {
  return new Registry([...defaultRegistryTypes, ...RDK_TYPES]);
}
