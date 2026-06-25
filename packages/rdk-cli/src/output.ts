/**
 * Output sink. The default writes colored lines to the console; tests use
 * {@link CaptureOutput} to assert on what was printed. `--json` mode routes
 * structured results through {@link Output.json}.
 */
import pc from "picocolors";

export interface Output {
  line(text?: string): void;
  success(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  json(value: unknown): void;
}

export class ConsoleOutput implements Output {
  constructor(private readonly jsonMode = false) {}
  line(text = ""): void {
    if (!this.jsonMode) console.log(text);
  }
  success(text: string): void {
    if (!this.jsonMode) console.log(`${pc.green("✓")} ${text}`);
  }
  warn(text: string): void {
    if (!this.jsonMode) console.log(`${pc.yellow("!")} ${text}`);
  }
  error(text: string): void {
    if (!this.jsonMode) console.error(`${pc.red("✗")} ${text}`);
  }
  json(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
  }
}

/** An in-memory Output for tests. */
export class CaptureOutput implements Output {
  readonly lines: string[] = [];
  readonly errors: string[] = [];
  jsonValue: unknown;
  line(text = ""): void {
    this.lines.push(text);
  }
  success(text: string): void {
    this.lines.push(`✓ ${text}`);
  }
  warn(text: string): void {
    this.lines.push(`! ${text}`);
  }
  error(text: string): void {
    this.errors.push(text);
  }
  json(value: unknown): void {
    this.jsonValue = value;
    this.lines.push(JSON.stringify(value));
  }
  /** All non-error lines joined, for substring assertions. */
  text(): string {
    return this.lines.join("\n");
  }
}
