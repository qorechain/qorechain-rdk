import { bech32 } from "bech32";
import { ACCOUNT_PREFIX } from "../constants";

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
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

/** Decode a bech32 address to a `0x`-prefixed hex string of its data bytes. */
export function bech32ToHex(address: string): string {
  const decoded = bech32.decode(address);
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
  return `0x${bytesToHex(bytes)}`;
}

/** Encode hex data bytes as a bech32 address with the given prefix. */
export function hexToBech32(hex: string, prefix: string = ACCOUNT_PREFIX): string {
  const words = bech32.toWords(hexToBytes(hex));
  return bech32.encode(prefix, words);
}

/** Return the human-readable prefix of a bech32 address. */
export function bech32Prefix(address: string): string {
  return bech32.decode(address).prefix;
}
