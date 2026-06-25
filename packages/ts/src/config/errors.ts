/** Thrown when a rollup configuration fails validation. */
export class RollupConfigError extends Error {
  /** The individual validation failures. */
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Invalid rollup configuration:\n- ${errors.join("\n- ")}`);
    this.name = "RollupConfigError";
    this.errors = errors;
  }
}
