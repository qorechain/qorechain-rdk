import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "overview",
    "install",
    "quickstart",
    {
      type: "category",
      label: "Concepts",
      items: [
        "concepts/rollups-and-anchoring",
        "concepts/settlement-paradigms",
      ],
    },
    {
      type: "category",
      label: "Guides",
      items: [
        "guides/zero-to-rollup",
        "guides/profiles",
        "guides/sequencer-modes",
        "guides/proof-systems",
        "guides/data-availability",
        "guides/gas-models",
        "guides/lifecycles",
        "guides/stake-and-burn",
        "guides/keys-and-funding",
        "guides/monitoring",
        "guides/withdrawals",
        "guides/local-and-dry-run",
        "guides/qcai-copilot",
        "guides/settlement-receipts",
        "guides/multi-vm",
        "guides/watchtower",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: [
        "reference/network",
        "reference/cli",
        "reference/cli-qorollup",
        "reference/api",
      ],
    },
    "faq",
    "troubleshooting",
  ],
};

export default sidebars;
