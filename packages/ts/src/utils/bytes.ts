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

/** Decode a standard (RFC 4648) base64 string into bytes; works in Node and browsers. */
export function base64ToBytes(b64: string): Uint8Array {
  if (b64 === "") return new Uint8Array();
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes as a standard (RFC 4648) base64 string; works in Node and browsers. */
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

/**
 * Decode a bytes value as it arrives from the chain's wire surface. Cosmos
 * gRPC-gateway (jsonpb) encodes proto `bytes` as base64; some surfaces send hex.
 * Disambiguated by alphabet and length (a 32-byte root is 64 hex chars vs ~44
 * base64 chars with `+/=`), so both encodings round-trip correctly.
 */
export function decodeWireBytes(value: string): Uint8Array {
  if (value === "") return new Uint8Array();
  const isHex = value.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(value);
  const looksBase64 = /[+/=]/.test(value) || /[g-zG-Z]/.test(value);
  return isHex && !looksBase64 ? hexToBytes(value) : base64ToBytes(value);
}
