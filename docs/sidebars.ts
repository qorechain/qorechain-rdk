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
        "guides/profiles",
        "guides/sequencer-modes",
        "guides/proof-systems",
        "guides/data-availability",
        "guides/gas-models",
        "guides/lifecycles",
        "guides/stake-and-burn",
      ],
    },
    {
      type: "category",
      label: "Reference",
      items: ["reference/network", "reference/cli", "reference/api"],
    },
    "faq",
    "troubleshooting",
  ],
};

export default sidebars;
