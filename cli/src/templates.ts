/**
 * Template registry.
 *
 * Each entry maps to a starter project in the monorepo's `templates/<dir>`
 * directory (copied into this package at build time). The ids match the five
 * preset profiles.
 */

/** A scaffoldable rollup starter template. */
export interface TemplateInfo {
  /** Registry id and on-disk directory name under `templates/`. */
  id: string;
  /** The preset profile the template is built around. */
  profile: "defi" | "gaming" | "nft" | "enterprise" | "custom";
  /** Short human label shown in the interactive picker. */
  label: string;
  /** One-line description. */
  hint: string;
}

/** All templates the CLI can scaffold. */
export const TEMPLATES: readonly TemplateInfo[] = [
  {
    id: "defi-rollup",
    profile: "defi",
    label: "DeFi",
    hint: "zk-SNARK / dedicated / native / EIP-1559 / EVM. Includes a reference SNARK prover.",
  },
  {
    id: "gaming-rollup",
    profile: "gaming",
    label: "Gaming",
    hint: "based / based / native / flat gas / custom VM. High throughput, low latency.",
  },
  {
    id: "nft-rollup",
    profile: "nft",
    label: "NFT",
    hint: "optimistic / dedicated / CosmWasm. Includes the challenge flow and Celestia notice.",
  },
  {
    id: "enterprise-rollup",
    profile: "enterprise",
    label: "Enterprise",
    hint: "based / based / native / subsidized gas / EVM. Permissioned-friendly.",
  },
  {
    id: "custom-rollup",
    profile: "custom",
    label: "Custom",
    hint: "Fully parameterized config with every field documented and validated.",
  },
] as const;

/** Look up a template by id, or `undefined` if unknown. */
export function findTemplate(id: string): TemplateInfo | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Comma-separated list of valid template ids, for error messages. */
export function templateIdList(): string {
  return TEMPLATES.map((t) => t.id).join(", ");
}
