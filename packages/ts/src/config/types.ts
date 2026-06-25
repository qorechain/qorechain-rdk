import type {
  DABackend,
  GasModel,
  ProfileName,
  ProofSystem,
  SequencerMode,
  SettlementParadigm,
  VmType,
} from "./enums";

/**
 * Mode-specific sequencer parameters. Which fields apply depends on the
 * sequencer mode: `dedicated` uses `sequencerAddress`, `shared` uses
 * `sharedSetMinSize`, and `based` uses `inclusionDelay` / `priorityFeeShare`.
 */
export interface SequencerParams {
  /** `dedicated`: the operator address that sequences the rollup. */
  sequencerAddress?: string;
  /** `shared`: minimum size of the shared sequencer set. */
  sharedSetMinSize?: number;
  /** `based`: blocks of inclusion delay for host-chain proposers. */
  inclusionDelay?: number;
  /** `based`: share of priority fees routed to proposers, as a decimal string. */
  priorityFeeShare?: string;
}

/**
 * A fully resolved rollup configuration.
 *
 * On creation the chain derives a rollup's settlement, sequencing, data
 * availability, gas, and timing from its `profile` (and `vmType`). This object
 * captures the resolved configuration for client-side validation, display, and
 * to build {@link https://github.com/qorechain/qorechain-core | MsgCreateRollup}.
 * Field overrides beyond `profile` and `vmType` are used for local validation
 * and clarity; the authoritative configuration is whatever the chain records
 * for the chosen profile.
 */
export interface RollupConfig {
  /** Unique rollup identifier. */
  rollupId: string;
  /** The preset profile this configuration is based on. */
  profile: ProfileName;
  /** Settlement paradigm. */
  settlement: SettlementParadigm;
  /** Sequencer mode. */
  sequencer: SequencerMode;
  /** Mode-specific sequencer parameters. */
  sequencerParams?: SequencerParams;
  /** Data-availability backend. */
  da: DABackend;
  /** Proof system (must be compatible with `settlement`). */
  proofSystem: ProofSystem;
  /** Gas / fee model. */
  gasModel: GasModel;
  /** Execution environment. */
  vmType: VmType;
  /** Target block time, in milliseconds. */
  blockTimeMs: number;
  /** Maximum transactions per rollup block. */
  maxTxPerBlock: number;
  /** Optimistic challenge window, in seconds. */
  challengeWindowSecs?: number;
  /** Optimistic challenge bond, in uqor. */
  challengeBondUqor?: string;
  /** Maximum DA blob size, in bytes. */
  maxDaBlobSize?: number;
  /** Stake committed at creation, in uqor. Required to build a create message. */
  stakeAmountUqor?: string;
}

/** Inputs for an on-chain `MsgCreateRollup`, as the kit submits them. */
export interface CreateRollupMsgInput {
  creator: string;
  rollupId: string;
  profile: ProfileName;
  vmType: VmType;
  stakeAmount: string;
}
