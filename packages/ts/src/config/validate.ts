import { rollupIdError } from "../rules";
import {
  DA_BACKENDS,
  EXECUTION_VMS,
  PAUSED_PROOF_SYSTEMS,
  ROLLUP_PRIVACY_MODES,
  SEQUENCING_MODES,
  GAS_MODELS,
  PROOF_SYSTEMS,
  SEQUENCER_MODES,
  SETTLEMENT_PARADIGMS,
  isVmType,
} from "./enums";
import { isProofCompatible, requiresBasedSequencer, validProofSystems } from "./matrix";
import type { RollupConfig } from "./types";
import { RollupConfigError } from "./errors";

/** The outcome of validating a {@link RollupConfig}. */
export interface ValidationResult {
  /** True when there are no errors (warnings do not affect validity). */
  valid: boolean;
  /** Hard failures that block submission. */
  errors: string[];
  /** Non-fatal notices (e.g. selecting a not-yet-active DA backend). */
  warnings: string[];
}

function isPositiveIntegerString(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

/**
 * Validate a rollup configuration against the on-chain rules: the
 * settlement → proof compatibility matrix, the based-settlement ⇒ based-sequencer
 * constraint, the closed value sets, and basic field sanity.
 *
 * Returns a structured result; callers that prefer to fail fast can use
 * {@link assertValidRollupConfig}.
 */
export function validateRollupConfig(config: RollupConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.rollupId || config.rollupId.trim() === "") {
    errors.push("rollupId must be a non-empty string");
  } else {
    // The chain enforces this at creation from v3.2.2; checking here means a
    // refused id costs nothing instead of a creation fee.
    const idError = rollupIdError(config.rollupId);
    if (idError) errors.push(`rollupId "${config.rollupId}" ${idError}`);
  }

  if (!SETTLEMENT_PARADIGMS.includes(config.settlement)) {
    errors.push(`settlement "${config.settlement}" is not a valid settlement paradigm`);
  }
  if (!SEQUENCER_MODES.includes(config.sequencer)) {
    errors.push(`sequencer "${config.sequencer}" is not a valid sequencer mode`);
  }
  if (!PROOF_SYSTEMS.includes(config.proofSystem)) {
    errors.push(`proofSystem "${config.proofSystem}" is not a valid proof system`);
  }
  if (!DA_BACKENDS.includes(config.da)) {
    errors.push(`da "${config.da}" is not a valid data-availability backend`);
  }
  if (!GAS_MODELS.includes(config.gasModel)) {
    errors.push(`gasModel "${config.gasModel}" is not a valid gas model`);
  }
  if (!isVmType(config.vmType)) {
    errors.push(`vmType "${config.vmType}" is not a valid VM type`);
  }

  // Compatibility matrix (only meaningful once both values are valid).
  if (
    SETTLEMENT_PARADIGMS.includes(config.settlement) &&
    PROOF_SYSTEMS.includes(config.proofSystem) &&
    !isProofCompatible(config.settlement, config.proofSystem)
  ) {
    errors.push(
      `proof system "${config.proofSystem}" is not compatible with "${config.settlement}" ` +
        `settlement (expected one of: ${validProofSystems(config.settlement).join(", ")})`,
    );
  }

  // STARK settlement is refused by the chain from v3.2.8.
  if (PAUSED_PROOF_SYSTEMS.includes(config.proofSystem)) {
    errors.push(
      `proof system "${config.proofSystem}" is paused on the network: the chain refuses STARK keys and ` +
        "STARK batches until it verifies a real rollup statement; use snark (Groth16)",
    );
  }

  // Sequencing, execution VM and privacy (chain v3.2.8+), mirroring the
  // chain's RollupConfig.Validate and its create-time rule.
  errors.push(...rollupModeErrors(config));

  // Based settlement requires the based sequencer mode.
  if (requiresBasedSequencer(config.settlement) && config.sequencer !== "based") {
    errors.push('based settlement requires the "based" sequencer mode');
  }

  if (!Number.isInteger(config.blockTimeMs) || config.blockTimeMs <= 0) {
    errors.push("blockTimeMs must be a positive integer");
  }
  if (!Number.isInteger(config.maxTxPerBlock) || config.maxTxPerBlock <= 0) {
    errors.push("maxTxPerBlock must be a positive integer");
  }

  if (config.stakeAmountUqor !== undefined && !isPositiveIntegerString(config.stakeAmountUqor)) {
    errors.push("stakeAmountUqor must be a positive integer string (base uqor)");
  }
  if (
    config.challengeWindowSecs !== undefined &&
    (!Number.isInteger(config.challengeWindowSecs) || config.challengeWindowSecs <= 0)
  ) {
    errors.push("challengeWindowSecs must be a positive integer");
  }
  if (
    config.maxDaBlobSize !== undefined &&
    (!Number.isInteger(config.maxDaBlobSize) || config.maxDaBlobSize <= 0)
  ) {
    errors.push("maxDaBlobSize must be a positive integer (bytes)");
  }

  // Celestia is a selectable but not-yet-active backend on the network.
  if (config.da === "celestia" || config.da === "both") {
    warnings.push(
      "Celestia data availability is selectable but not yet active on the network; " +
        "batches targeting it will not be served until it is enabled.",
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Validate a configuration and throw {@link RollupConfigError} on any error. */
export function assertValidRollupConfig(config: RollupConfig): void {
  const result = validateRollupConfig(config);
  if (!result.valid) {
    throw new RollupConfigError(result.errors);
  }
}

/**
 * The chain's v3.2.8 rules for `sequencing`, `executionVm` and `privacy` on a
 * new rollup. Returns every violation (empty when the combination is accepted).
 *
 * - A new optimistic rollup needs `executionVm: "qledger-v1"` and
 *   `sequencing: "based"`.
 * - `sequencing: "based"` is allowed for zk with snark, based settlement, and
 *   optimistic with qledger-v1.
 * - `executionVm: "qledger-v1"` needs optimistic settlement, based sequencing,
 *   and no privacy.
 * - `privacy: "encapsulated"` needs zk settlement with snark.
 */
export function rollupModeErrors(config: {
  settlement: string;
  proofSystem: string;
  sequencing?: string;
  executionVm?: string;
  privacy?: string;
}): string[] {
  const errors: string[] = [];
  const sequencing = config.sequencing ?? "";
  const executionVm = config.executionVm ?? "";
  const privacy = config.privacy ?? "";
  if (!(SEQUENCING_MODES as readonly string[]).includes(sequencing)) {
    errors.push(`sequencing "${sequencing}" is not valid (want "based" or empty)`);
  }
  if (!(EXECUTION_VMS as readonly string[]).includes(executionVm)) {
    errors.push(`executionVm "${executionVm}" is not valid (want "qledger-v1" or empty)`);
  }
  if (!(ROLLUP_PRIVACY_MODES as readonly string[]).includes(privacy)) {
    errors.push(`privacy "${privacy}" is not valid (want "encapsulated" or empty)`);
  }
  if (config.settlement === "optimistic" && executionVm === "") {
    errors.push(
      'from chain v3.2.8 a new optimistic rollup needs executionVm "qledger-v1" and sequencing "based" ' +
        "(its fraud proof re-executes the batch)",
    );
  }
  if (sequencing === "based") {
    const eligible =
      (config.settlement === "zk" && config.proofSystem === "snark") ||
      config.settlement === "based" ||
      (config.settlement === "optimistic" && executionVm === "qledger-v1");
    if (!eligible) {
      errors.push(
        `settlement ${config.settlement} with proof system ${config.proofSystem} cannot use based sequencing ` +
          "(zk with snark, based settlement, or optimistic with qledger-v1 only)",
      );
    }
  }
  if (executionVm === "qledger-v1") {
    if (config.settlement !== "optimistic") {
      errors.push(`executionVm qledger-v1 needs optimistic settlement, not ${config.settlement}`);
    }
    if (sequencing !== "based") {
      errors.push('executionVm qledger-v1 needs sequencing "based": its batches consume the inbox');
    }
    if (privacy !== "") errors.push("a qledger-v1 rollup cannot be private: a fraud proof re-executes plaintext");
  }
  if (privacy === "encapsulated" && !(config.settlement === "zk" && config.proofSystem === "snark")) {
    errors.push(`a private rollup must be zk with a snark (Groth16) key, not ${config.settlement}/${config.proofSystem}`);
  }
  return errors;
}
