import {
  DA_BACKENDS,
  GAS_MODELS,
  PROOF_SYSTEMS,
  SEQUENCER_MODES,
  SETTLEMENT_PARADIGMS,
  VM_TYPES,
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
  if (!VM_TYPES.includes(config.vmType)) {
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
