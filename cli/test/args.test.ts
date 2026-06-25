import { describe, it, expect } from "vitest";
import { parseArgs, ArgError } from "../src/args";

describe("parseArgs", () => {
  it("parses a positional dir and template", () => {
    const a = parseArgs(["my-rollup", "--template", "defi-rollup"]);
    expect(a.dir).toBe("my-rollup");
    expect(a.template).toBe("defi-rollup");
    expect(a.install).toBe(true);
  });

  it("supports --flag=value form and aliases", () => {
    const a = parseArgs(["d", "-t", "nft-rollup", "--network=mainnet", "--pm=npm", "-y"]);
    expect(a.template).toBe("nft-rollup");
    expect(a.network).toBe("mainnet");
    expect(a.packageManager).toBe("npm");
    expect(a.yes).toBe(true);
  });

  it("handles --no-install and --local", () => {
    const a = parseArgs(["d", "--no-install", "--local"]);
    expect(a.install).toBe(false);
    expect(a.local).toBe(true);
  });

  it("rejects invalid network and package manager", () => {
    expect(() => parseArgs(["--network", "devnet"])).toThrow(ArgError);
    expect(() => parseArgs(["--pm", "bun"])).toThrow(ArgError);
  });

  it("rejects unknown options and extra positionals", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(ArgError);
    expect(() => parseArgs(["a", "b"])).toThrow(ArgError);
  });
});
