/**
 * Tiny dependency-free argv parser: `qorollup <command> [positionals] [--flags]`.
 */
export interface ParsedCli {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
  help: boolean;
  version: boolean;
}

const BOOLEAN_FLAGS = new Set(["json", "yes", "dry-run", "help", "version"]);

export function parseCli(argv: readonly string[]): ParsedCli {
  const out: ParsedCli = { positionals: [], flags: {}, help: false, version: false };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "-h" || token === "--help") {
      out.help = true;
      continue;
    }
    if (token === "-v" || token === "--version") {
      out.version = true;
      continue;
    }
    if (token === "-y") {
      out.flags.yes = true;
      continue;
    }
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        out.flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (BOOLEAN_FLAGS.has(body)) {
        out.flags[body] = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          out.flags[body] = next;
          i++;
        } else {
          out.flags[body] = true;
        }
      }
      continue;
    }
    if (out.command === undefined) {
      out.command = token;
    } else {
      out.positionals.push(token);
    }
  }

  if (out.flags.help) out.help = true;
  if (out.flags.version) out.version = true;
  return out;
}

/** Read a string flag, or undefined. */
export function flagStr(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

/** Read a boolean flag. */
export function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}
