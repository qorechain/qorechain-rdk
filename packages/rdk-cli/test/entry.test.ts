import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isEntryPoint, VERSION } from "../src/index";

describe("qorollup entry point", () => {
  // npm runs a bin through node_modules/.bin/<name>, a symlink to the file.
  // Before 0.6.2 the check compared the link with the file and failed, so an
  // npm-installed qorollup did nothing and exited 0.
  it("recognises the bin when node is started through npm's symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "qorollup-entry-"));
    const file = join(dir, "index.js");
    writeFileSync(file, "");
    const link = join(dir, "qorollup");
    symlinkSync(file, link);
    expect(isEntryPoint(link, pathToFileURL(file).href)).toBe(true);
    expect(isEntryPoint(file, pathToFileURL(file).href)).toBe(true);
  });

  it("is false when imported from another script", () => {
    const dir = mkdtempSync(join(tmpdir(), "qorollup-entry-"));
    const file = join(dir, "index.js");
    const other = join(dir, "other.js");
    writeFileSync(file, "");
    writeFileSync(other, "");
    expect(isEntryPoint(other, pathToFileURL(file).href)).toBe(false);
    expect(isEntryPoint(undefined, pathToFileURL(file).href)).toBe(false);
    expect(isEntryPoint(join(dir, "missing"), pathToFileURL(file).href)).toBe(false);
  });

  it("reports the package's own version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});
