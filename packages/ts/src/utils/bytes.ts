/** Byte/hex helpers used across the tx, DA, and event layers. */

/** Convert bytes to a lowercase hex string (no `0x` prefix). */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/** Parse a hex string (with or without a `0x` prefix) into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) {
    throw new Error(`invalid hex string: "${hex}"`);
  }
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Coerce a hex string or byte array into bytes. */
export function toBytes(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? hexToBytes(input) : input;
}
