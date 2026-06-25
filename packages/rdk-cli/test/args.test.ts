import { describe, it, expect } from "vitest";
import { parseCli, flagStr, flagBool } from "../src/args";

describe("parseCli", () => {
  it("parses command, positionals, and value flags", () => {
    const p = parseCli(["create", "my-roll", "--profile", "defi", "--rollup-id=r1"]);
    expect(p.command).toBe("create");
    expect(p.positionals).toEqual(["my-roll"]);
    expect(flagStr(p.flags, "profile")).toBe("defi");
    expect(flagStr(p.flags, "rollup-id")).toBe("r1");
  });

  it("treats known flags as booleans", () => {
    const p = parseCli(["create", "--dry-run", "--json", "-y"]);
    expect(flagBool(p.flags, "dry-run")).toBe(true);
    expect(flagBool(p.flags, "json")).toBe(true);
    expect(flagBool(p.flags, "yes")).toBe(true);
  });

  it("handles help and version", () => {
    expect(parseCli(["--help"]).help).toBe(true);
    expect(parseCli(["-v"]).version).toBe(true);
    expect(parseCli([]).command).toBeUndefined();
  });

  it("does not consume the next token for a trailing value flag at EOL", () => {
    const p = parseCli(["status", "r1", "--json"]);
    expect(p.positionals).toEqual(["r1"]);
    expect(flagBool(p.flags, "json")).toBe(true);
  });
});
