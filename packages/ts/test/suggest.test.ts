import { describe, it, expect } from "vitest";
import { suggestProfile, type QorClient } from "../src/index";

function fakeQor(impl: (useCase: string) => Promise<unknown>): QorClient {
  return { suggestRollupProfile: impl } as unknown as QorClient;
}

describe("suggestProfile", () => {
  it("accepts a bare profile-name string from the advisory", async () => {
    const res = await suggestProfile("a fast game", fakeQor(async () => "gaming"));
    expect(res).toMatchObject({ profile: "gaming", source: "advisory" });
  });

  it("accepts an object with a profile field", async () => {
    const res = await suggestProfile("nft market", fakeQor(async () => ({ profile: "nft" })));
    expect(res.profile).toBe("nft");
    expect(res.source).toBe("advisory");
  });

  it("falls back to defi on an unrecognized response", async () => {
    const res = await suggestProfile("???", fakeQor(async () => ({ profile: "nonsense" })));
    expect(res).toMatchObject({ profile: "defi", source: "fallback" });
  });

  it("falls back to defi (configurable) when the advisory throws", async () => {
    const res = await suggestProfile(
      "x",
      fakeQor(async () => {
        throw new Error("unavailable");
      }),
      { fallback: "enterprise" },
    );
    expect(res).toMatchObject({ profile: "enterprise", source: "fallback" });
  });
});
