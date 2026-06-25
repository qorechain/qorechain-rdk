import { DENOM_EXPONENT } from "../constants";

/**
 * Convert a display amount (QOR) to base units (uqor) as an integer string.
 * Uses integer/string math only — never floating point — so values are exact.
 *
 * @throws if the input is not a non-negative decimal or has more than
 * `exponent` fractional digits.
 */
export function qorToUqor(amount: string | number, exponent: number = DENOM_EXPONENT): string {
  const s = typeof amount === "number" ? amount.toString() : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`invalid QOR amount: "${amount}"`);
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > exponent) {
    throw new Error(`QOR amount "${amount}" has more than ${exponent} fractional digits`);
  }
  const combined = `${whole}${frac.padEnd(exponent, "0")}`.replace(/^0+(?=\d)/, "");
  return combined === "" ? "0" : combined;
}

/**
 * Convert base units (uqor) to a display amount (QOR), trimming trailing zeros.
 * Uses BigInt math; accepts an integer string or bigint.
 *
 * @throws if a string input is not a non-negative integer.
 */
export function uqorToQor(amount: string | bigint, exponent: number = DENOM_EXPONENT): string {
  let value: bigint;
  if (typeof amount === "bigint") {
    value = amount;
  } else {
    const t = amount.trim();
    if (!/^\d+$/.test(t)) {
      throw new Error(`invalid uqor amount: "${amount}"`);
    }
    value = BigInt(t);
  }
  if (value < 0n) {
    throw new Error("uqor amount must be non-negative");
  }
  const base = 10n ** BigInt(exponent);
  const whole = value / base;
  const frac = value % base;
  if (frac === 0n) {
    return whole.toString();
  }
  const fracStr = frac.toString().padStart(exponent, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}
