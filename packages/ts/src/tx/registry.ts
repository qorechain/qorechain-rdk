import { Registry, type GeneratedType } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import {
  MsgChallengeBatch,
  MsgCreateRollup,
  MsgExecuteWithdrawal,
  MsgPauseRollup,
  MsgResolveChallenge,
  MsgResumeRollup,
  MsgStopRollup,
  MsgSubmitBatch,
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
];

/**
 * Build a `@cosmjs` {@link Registry} containing the default Cosmos SDK types and
 * the `rdk` module types. Pass this to `SigningStargateClient.connectWithSigner`
 * so `rdk` messages encode correctly.
 */
export function createRdkRegistry(): Registry {
  return new Registry([...defaultRegistryTypes, ...RDK_TYPES]);
}
