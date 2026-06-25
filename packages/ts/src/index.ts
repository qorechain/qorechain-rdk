/**
 * `@qorechain/rdk` public API.
 *
 * The Rollup Development Kit drives the on-chain `rdk` module on the QoreChain
 * network: rollup configuration and creation, the rollup and settlement-batch
 * lifecycles, native data availability, and the read surface (REST, gRPC, and
 * the `qor_` JSON-RPC namespace), plus a QCAI-assisted profile recommendation.
 *
 * The exports below are the deliberate, supported surface. Internal helpers are
 * not exported.
 */

/** RDK package version. */
export const VERSION = "0.1.0";

// Network and module constants (documented defaults; read live values from the chain).
export * from "./constants";

// Configuration: enums, types, the compatibility matrix, validation, and the builder.
export * from "./config/enums";
export * from "./config/types";
export * from "./config/matrix";
export * from "./config/validate";
export { RollupConfigError } from "./config/errors";
export { RollupConfigBuilder } from "./config/builder";

// Preset profiles.
export { presets, PRESET_DEFAULTS } from "./presets";

// Utilities: denom conversion, creation-cost economics, and address encoding.
export * from "./utils/denom";
export * from "./utils/economics";
export * from "./utils/bech32";
