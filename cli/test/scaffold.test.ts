import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "../src/scaffold";

let root: string;
let templatesRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rdk-cli-"));
  templatesRoot = join(root, "templates");
  // A minimal fake template.
  const tpl = join(templatesRoot, "defi-rollup", "src");
  mkdirSync(tpl, { recursive: true });
  writeFileSync(
    join(templatesRoot, "defi-rollup", "package.json"),
    JSON.stringify(
      { name: "template", dependencies: { "@qorechain/rdk": "^0.1.0" } },
      null,
      2,
    ),
  );
  writeFileSync(join(templatesRoot, "defi-rollup", ".env.example"), "QORE_NETWORK=testnet\n");
  writeFileSync(join(tpl, "create.ts"), "export const x = 1;\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scaffold", () => {
  it("copies the template, renames the package, and writes .env", () => {
    const target = join(root, "out");
    const res = scaffold({
      template: "defi-rollup",
      targetDir: target,
      projectName: "my-rollup",
      templatesRoot,
      install: false,
    });
    expect(res.files).toContain("package.json");
    expect(res.files).toContain("src/create.ts");
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-rollup");
    expect(existsSync(join(target, ".env"))).toBe(true);
    // Without --local, the published dependency range is preserved.
    expect(pkg.dependencies["@qorechain/rdk"]).toBe("^0.1.0");
  });

  it("rewrites @qorechain/* deps to file: links in local mode", () => {
    const target = join(root, "out2");
    scaffold({
      template: "defi-rollup",
      targetDir: target,
      projectName: "my-rollup",
      templatesRoot,
      monorepoRoot: "/repo",
      local: true,
      install: false,
    });
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    expect(pkg.dependencies["@qorechain/rdk"]).toBe("file:/repo/packages/ts");
  });

  it("throws on an unknown template", () => {
    expect(() =>
      scaffold({ template: "nope", targetDir: join(root, "o3"), projectName: "p", templatesRoot }),
    ).toThrow(/Unknown template/);
  });

  it("refuses a non-empty target directory", () => {
    const target = join(root, "full");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "keep.txt"), "x");
    expect(() =>
      scaffold({ template: "defi-rollup", targetDir: target, projectName: "p", templatesRoot }),
    ).toThrow(/not empty/);
  });
});
