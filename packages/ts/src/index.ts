/**
 * `@qorechain/rdk` public API.
 *
 * The Rollup Development Kit drives the on-chain `rdk` module on the QoreChain
 * network: rollup configuration and creation, the rollup and settlement-batch
 * lifecycles, native data availability, and the read surface (REST, gRPC, and
 * the `qor_` JSON-RPC namespace), plus a QCAI-assisted profile recommendation.
 *
 * This is the package entry point. The typed configuration builder, preset
 * profiles, lifecycle and batch clients, and read clients are exported here as
 * they are implemented. Internal helpers are not exported.
 */

/** RDK package version. */
export const VERSION = "0.1.0";
