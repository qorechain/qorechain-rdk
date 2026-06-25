import { DEFAULT_RDK_PARAMS } from "../constants";

function toBigInt(value: string | bigint, label: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  const t = value.trim();
  if (!/^\d+$/.test(t)) {
    throw new Error(`${label} must be a non-negative integer string, got "${value}"`);
  }
  return BigInt(t);
}

/**
 * Multiply an integer amount by a non-negative decimal (e.g. `"0.01"`), flooring
 * the result. Pure integer math — no floating point — so the result is exact.
 */
export function mulDecimalFloor(amount: bigint, decimal: string): bigint {
  if (!/^\d+(\.\d+)?$/.test(decimal.trim())) {
    throw new Error(`invalid decimal: "${decimal}"`);
  }
  const [whole, frac = ""] = decimal.trim().split(".");
  const scale = 10n ** BigInt(frac.length);
  const numerator = BigInt(`${whole}${frac}` || "0");
  return (amount * numerator) / scale;
}

/** The cost breakdown of creating a rollup. All amounts are uqor strings. */
export interface CreationCost {
  /** The stake you commit, in uqor. */
  stakeUqor: string;
  /** The amount burned on creation, in uqor. */
  burnUqor: string;
  /** The stake remaining after the burn, in uqor. */
  netStakeUqor: string;
  /** The total leaving your wallet (equal to the committed stake), in uqor. */
  totalRequiredUqor: string;
  /** The burn rate applied, as a decimal string. */
  burnRate: string;
}

/**
 * Estimate the cost of creating a rollup: the burn taken from the committed
 * stake and the net stake remaining. Defaults to the documented burn rate; pass
 * the live `rollup_creation_burn_rate` from `rdk.params()` for an exact figure.
 */
export function estimateCreationCost(opts: {
  stakeUqor: string | bigint;
  burnRate?: string;
}): CreationCost {
  const stake = toBigInt(opts.stakeUqor, "stakeUqor");
  const burnRate = opts.burnRate ?? DEFAULT_RDK_PARAMS.rollupCreationBurnRate;
  const burn = mulDecimalFloor(stake, burnRate);
  return {
    stakeUqor: stake.toString(),
    burnUqor: burn.toString(),
    netStakeUqor: (stake - burn).toString(),
    totalRequiredUqor: stake.toString(),
    burnRate,
  };
}
