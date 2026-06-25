/**
 * Rollup manifest — a portable JSON snapshot of a rollup's resolved
 * configuration, target network, endpoints, and key addresses. The
 * `rollup.json`/`node-config` equivalent for this kit: save it, share it, and
 * load it back into a config builder.
 */
import type { Endpoints } from "../config/networks";
import type { NetworkName } from "../constants";
import { RollupConfigBuilder } from "../config/builder";
import type { RollupConfig } from "../config/types";

export const MANIFEST_SCHEMA = "qorechain-rdk/rollup-manifest";

export interface RollupManifest {
  schema: typeof MANIFEST_SCHEMA;
  version: 1;
  network: NetworkName;
  chainId?: string;
  endpoints?: Partial<Endpoints>;
  config: RollupConfig;
  /** Named addresses (e.g. creator, sequencer). */
  addresses?: Record<string, string>;
  /** Caller-stamped ISO timestamp (the kit does not read the clock). */
  createdAt?: string;
  notes?: string[];
}

export interface ToManifestOptions {
  network: NetworkName;
  chainId?: string;
  endpoints?: Partial<Endpoints>;
  addresses?: Record<string, string>;
  createdAt?: string;
  notes?: string[];
}

/** Build a manifest from a resolved config. */
export function toManifest(config: RollupConfig, options: ToManifestOptions): RollupManifest {
  return {
    schema: MANIFEST_SCHEMA,
    version: 1,
    network: options.network,
    chainId: options.chainId,
    endpoints: options.endpoints,
    config,
    addresses: options.addresses,
    createdAt: options.createdAt,
    notes: options.notes,
  };
}

/** Load a manifest into a {@link RollupConfigBuilder}. */
export function fromManifest(manifest: RollupManifest): RollupConfigBuilder {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA) {
    throw new Error("not a qorechain-rdk rollup manifest");
  }
  return new RollupConfigBuilder(manifest.config);
}

/** Parse a manifest from JSON text. */
export function parseManifest(json: string): RollupManifest {
  return JSON.parse(json) as RollupManifest;
}

/** Serialize a manifest to pretty JSON (trailing newline). */
export function stringifyManifest(manifest: RollupManifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}
