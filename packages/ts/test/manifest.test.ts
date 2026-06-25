import { describe, it, expect } from "vitest";
import {
  presets,
  toManifest,
  fromManifest,
  parseManifest,
  stringifyManifest,
  type RollupManifest,
} from "../src/index";

describe("rollup manifest", () => {
  it("round-trips config through a manifest", () => {
    const config = presets.defi({ rollupId: "d", stakeAmountUqor: "10000000000" }).build();
    const manifest = toManifest(config, {
      network: "testnet",
      chainId: "qorechain-diana",
      endpoints: { rest: "https://rest.example" },
      addresses: { creator: "qor1creator" },
      createdAt: "2026-06-25T00:00:00Z",
    });
    expect(manifest.schema).toBe("qorechain-rdk/rollup-manifest");

    const json = stringifyManifest(manifest);
    const parsed = parseManifest(json);
    const builder = fromManifest(parsed);
    expect(builder.get().rollupId).toBe("d");
    expect(builder.get().settlement).toBe("zk");
    expect(parsed.addresses?.creator).toBe("qor1creator");
  });

  it("rejects a non-manifest object", () => {
    expect(() => fromManifest({ schema: "nope" } as unknown as RollupManifest)).toThrow(
      /not a qorechain-rdk rollup manifest/,
    );
  });
});
