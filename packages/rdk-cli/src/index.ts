/**
 * `qorollup` entry point: parse args, build the runtime context, dispatch to a
 * command handler, and return its exit code.
 */
import { fileURLToPath } from "node:url";
import { flagBool, parseCli } from "./args";
import { ConsoleOutput } from "./output";
import { buildContext } from "./context";
import * as cmd from "./commands";

export const VERSION = "0.4.1";

export const HELP = `qorollup — operate QoreChain rollups.

Usage: qorollup <command> [args] [--flags]

Commands:
  doctor                     Preflight checks (endpoints, params, signer, balance, config)
  create --rollup-id <id>    Create a rollup (--profile, --stake-uqor, --dry-run)
  status <id>                Rollup status + health
  watch <id>                 Live status (--interval <ms>)
  advise <id>                QCAI Copilot advice (fees, network, fraud, RL agent)
  receipt <id> <batch>       Quantum-safe settlement receipt (--verify, --out <file>)
  watchtower <id>            Auto-challenger: watch batches + challenge deadlines
  params                     Live module parameters
  suggest "<use case>"       QCAI-assisted profile suggestion
  pause|resume|stop <id>     Lifecycle transitions (creator only)
  keygen                     Generate a new operator key (mnemonic + address)
  manifest export|import     Export/import a rollup manifest (--out <file> / <file>)
  withdraw --file <json>     Assemble + submit a withdrawal (--dry-run)
  faucet <address>           Request testnet funds (needs a faucet URL)

Global flags:
  --network testnet|mainnet      default testnet
  --rest/--rpc/--evm-rpc <url>   endpoint overrides (or QORE_*_URL)
  --mnemonic/--key <value>       signer (or QORE_MNEMONIC / QORE_OPERATOR_PRIVATE_KEY_HEX)
  --profile <name>               defi|gaming|nft|enterprise|custom
  --json                         machine-readable output
  -y, --yes                      skip confirmations
  -h, --help / -v, --version
`;

export async function run(argv: readonly string[]): Promise<number> {
  const parsed = parseCli(argv);
  if (parsed.version) {
    console.log(VERSION);
    return 0;
  }
  if (parsed.help || !parsed.command) {
    console.log(HELP);
    return 0;
  }

  const out = new ConsoleOutput(flagBool(parsed.flags, "json"));
  const ctx = buildContext({ flags: parsed.flags, out });

  try {
    switch (parsed.command) {
      case "doctor":
        return await cmd.cmdDoctor(ctx, parsed);
      case "create":
        return await cmd.cmdCreate(ctx, parsed);
      case "status":
        return await cmd.cmdStatus(ctx, parsed);
      case "watch":
        return await cmd.cmdWatch(ctx, parsed);
      case "advise":
        return await cmd.cmdAdvise(ctx, parsed);
      case "receipt":
        return await cmd.cmdReceipt(ctx, parsed);
      case "watchtower":
        return await cmd.cmdWatchtower(ctx, parsed);
      case "params":
        return await cmd.cmdParams(ctx);
      case "suggest":
        return await cmd.cmdSuggest(ctx, parsed);
      case "pause":
        return await cmd.cmdLifecycle(ctx, parsed, "pause");
      case "resume":
        return await cmd.cmdLifecycle(ctx, parsed, "resume");
      case "stop":
        return await cmd.cmdLifecycle(ctx, parsed, "stop");
      case "keygen":
        return await cmd.cmdKeygen(ctx);
      case "manifest":
        return await cmd.cmdManifest(ctx, parsed);
      case "withdraw":
        return await cmd.cmdWithdraw(ctx, parsed);
      case "faucet":
        return await cmd.cmdFaucet(ctx, parsed);
      default:
        out.error(`unknown command: ${parsed.command}`);
        console.log(HELP);
        return 1;
    }
  } catch (e) {
    out.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

// Entry point when executed directly as the bin (not when imported by tests).
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : err);
      process.exit(1);
    },
  );
}
