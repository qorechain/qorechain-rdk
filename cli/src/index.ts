/**
 * `create-qorechain-rollup` entry point.
 *
 * Parses flags (non-interactive / CI mode) and falls back to interactive prompts
 * for any missing inputs. Scaffolding side effects are delegated to the pure
 * {@link scaffold} function. After scaffolding it prints the estimated stake and
 * creation burn so the cost is clear before the developer creates a rollup.
 */
import { existsSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

import { cancel, intro, isCancel, log, note, outro, select, text } from "@clack/prompts";
import pc from "picocolors";
import { DEFAULT_RDK_PARAMS, estimateCreationCost, uqorToQor } from "@qorechain/rdk";

import { ArgError, helpText, parseArgs } from "./args.js";
import { scaffold, type Network, type PackageManager } from "./scaffold.js";
import { findTemplate, TEMPLATES, templateIdList } from "./templates.js";

const VERSION = "0.1.0";

function isEmptyOrMissing(dir: string): boolean {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

function defaultProjectName(dir: string): string {
  const base = basename(resolve(dir));
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9-~._]/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-+/g, "-") || "qorechain-rollup"
  );
}

async function promptDir(initial?: string): Promise<string> {
  if (initial) return initial;
  const value = await text({
    message: "Where should we create your rollup project?",
    placeholder: "./my-rollup",
    defaultValue: "./my-rollup",
    validate: (v) => {
      const dir = v || "./my-rollup";
      if (!isEmptyOrMissing(resolve(dir))) {
        return `Directory ${dir} already exists and is not empty.`;
      }
      return undefined;
    },
  });
  if (isCancel(value)) bail();
  return (value as string) || "./my-rollup";
}

async function promptTemplate(initial?: string): Promise<string> {
  if (initial) {
    if (!findTemplate(initial)) {
      cancel(`Unknown template "${initial}". Available: ${templateIdList()}.`);
      process.exit(1);
    }
    return initial;
  }
  const value = await select({
    message: "Pick a rollup profile",
    options: TEMPLATES.map((t) => ({ value: t.id, label: t.label, hint: t.hint })),
  });
  if (isCancel(value)) bail();
  return value as string;
}

async function promptNetwork(initial?: Network): Promise<Network> {
  if (initial) return initial;
  const value = await select({
    message: "Which network?",
    options: [
      { value: "testnet", label: "testnet", hint: "qorechain-diana (recommended)" },
      { value: "mainnet", label: "mainnet", hint: "qorechain-vladi" },
    ],
    initialValue: "testnet",
  });
  if (isCancel(value)) bail();
  return value as Network;
}

async function promptPackageManager(initial?: PackageManager): Promise<PackageManager> {
  if (initial) return initial;
  const value = await select({
    message: "Package manager?",
    options: [
      { value: "pnpm", label: "pnpm" },
      { value: "npm", label: "npm" },
      { value: "yarn", label: "yarn" },
    ],
    initialValue: "pnpm",
  });
  if (isCancel(value)) bail();
  return value as PackageManager;
}

function bail(): never {
  cancel("Operation cancelled.");
  process.exit(0);
}

function nextSteps(dir: string, pm: PackageManager, installed: boolean): string {
  const lines: string[] = [`cd ${dir}`];
  if (!installed) lines.push(`${pm} install`);
  const run = pm === "npm" ? "npm run" : pm;
  lines.push("# set QORE_* endpoints and your operator key in .env (see README)");
  lines.push(`${run} create         # create the rollup on the selected network`);
  lines.push(`${run} query-status   # read its config and latest batch`);
  return lines.join("\n");
}

function costNote(): string {
  const cost = estimateCreationCost({ stakeUqor: DEFAULT_RDK_PARAMS.minStakeForRollup });
  return (
    `Creating a rollup requires a stake (default ${uqorToQor(cost.stakeUqor)} QOR) and burns ` +
    `${uqorToQor(cost.burnUqor)} QOR on creation (${Number(cost.burnRate) * 100}%).\n` +
    "These are documented defaults — the project reads the live values from the chain before submitting."
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof ArgError) {
      console.error(pc.red(err.message));
      console.error(`\nRun ${pc.cyan("create-qorechain-rollup --help")} for usage.`);
      process.exit(1);
    }
    throw err;
  }

  if (parsed.help) {
    console.log(helpText());
    return;
  }
  if (parsed.version) {
    console.log(VERSION);
    return;
  }

  intro(pc.bgCyan(pc.black(" create-qorechain-rollup ")));

  const dir = parsed.dir ?? (parsed.yes ? "./my-rollup" : await promptDir());
  const template = parsed.template ?? (parsed.yes ? TEMPLATES[0].id : await promptTemplate());
  if (!findTemplate(template)) {
    cancel(`Unknown template "${template}". Available: ${templateIdList()}.`);
    process.exit(1);
  }
  const network = parsed.network ?? (parsed.yes ? "testnet" : await promptNetwork());
  const packageManager = parsed.packageManager ?? (parsed.yes ? "pnpm" : await promptPackageManager());

  const projectName = defaultProjectName(dir);
  const install = parsed.install;

  try {
    log.step(install ? "Scaffolding and installing dependencies…" : "Scaffolding…");

    const result = scaffold({
      template,
      targetDir: dir,
      projectName,
      packageManager,
      network,
      install,
      local: parsed.local,
    });

    if (parsed.local) {
      note(
        "Dependencies were rewritten to local file: links into this monorepo.\n" +
          "Build the workspace packages first (pnpm -r build at the repo root).",
        "Local mode",
      );
    }

    note(costNote(), "Stake & burn");
    note(nextSteps(dir, packageManager, result.installed), "Next steps");
    outro(pc.green(`Done! Created ${projectName} at ${result.targetDir}`));
  } catch (err) {
    cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
