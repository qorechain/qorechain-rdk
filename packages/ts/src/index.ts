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
export const VERSION = "0.2.0";

// Network and module constants (documented defaults; read live values from the chain).
export * from "./constants";

// Configuration: enums, types, networks, the compatibility matrix, validation, and the builder.
export * from "./config/enums";
export * from "./config/types";
export * from "./config/networks";
export * from "./config/matrix";
export * from "./config/validate";
export { RollupConfigError } from "./config/errors";
export { RollupConfigBuilder } from "./config/builder";

// Preset profiles.
export { presets, PRESET_DEFAULTS } from "./presets";

// Utilities: denom conversion, creation-cost economics, and address/byte encoding.
export * from "./utils/denom";
export * from "./utils/economics";
export * from "./utils/bech32";
export * from "./utils/bytes";

// Transactions: the rdk registry, friendly message builders, and the tx client.
export { RDK_TYPES, createRdkRegistry } from "./tx/registry";
export * from "./tx/messages";
export {
  RdkTxClient,
  type TxFee,
  type TxOptions,
  type RdkTxClientConnectOptions,
  type SignAndBroadcastCapable,
} from "./tx/client";

// Lifecycle: rollup/batch state-machine awareness and challenge-window math.
export * from "./lifecycle/state-machine";

// Data availability: native blob assembly and the Celestia "planned" guard.
export * from "./da/native";

// Events: typed decoding of the rdk module's events.
export * from "./events/decode";

// Read clients: REST, the qor_ JSON-RPC namespace, typed views, and the facade.
export * from "./client/http";
export * from "./client/views";
export { RestClient, type RestClientOptions } from "./client/rest";
export { QorClient, type QorClientOptions } from "./client/jsonrpc";
export {
  RdkClient,
  createRdkClient,
  type CreateRdkClientOptions,
} from "./client/rdk-client";

// QCAI-assisted profile suggestion.
export { suggestProfile, type ProfileSuggestion } from "./profiles/suggest";

// Accounts & signing (built on @qorechain/sdk; includes quantum-safe signers).
export * from "./accounts";

// Mock tx backend for offline learning/testing, and gas simulation.
export { MockTxClient, type MockCall, type MockTxClientOptions } from "./tx/mock";
export type { SimulateCapable } from "./tx/client";

// Preflight ("doctor"), rollup health, and live monitoring.
export * from "./preflight";
export * from "./health";
export * from "./monitor";

// Rollup manifest (portable config snapshot) and faucet helper.
export * from "./manifest";
export * from "./faucet";

// Bridge: binary-Merkle utilities and withdrawal-proof assembly.
export * from "./bridge/merkle";
export * from "./bridge/withdrawal";
