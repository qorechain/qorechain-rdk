/**
 * Multi-VM tooling — helpers for the EVM→CosmWasm cross-VM precompile.
 *
 * QoreChain exposes a precompile at a fixed address that lets EVM (Solidity)
 * contracts call into CosmWasm contracts. This module builds the EVM calldata
 * for that precompile. The precompile's function signature is chain-defined;
 * the documented default below is used to derive the 4-byte selector, and you
 * can override it to match the exact ABI your node exposes.
 *
 * Note: this is the EVM↔CosmWasm bridge only. SVM cross-calls are separate.
 */
import { keccak256 } from "@cosmjs/crypto";
import { bytesToHex, toBytes } from "../utils/bytes";

/** The fixed address of the cross-VM precompile (EVM→CosmWasm). */
export const CROSS_VM_PRECOMPILE = "0x0000000000000000000000000000000000000901";

/**
 * The documented default precompile signature: a CosmWasm contract address
 * (bech32 string) and the execute message (bytes, typically UTF-8 JSON).
 * Confirm against your node's precompile ABI before relying on the selector.
 */
export const CROSS_VM_DEFAULT_SIGNATURE = "executeCrossVMCall(string,bytes)";

/** Compute the 4-byte EVM function selector (`0x`-prefixed) for a signature. */
export function functionSelector(signature: string): string {
  const hash = keccak256(new TextEncoder().encode(signature));
  return `0x${bytesToHex(hash.slice(0, 4))}`;
}

function u256be(value: number): Uint8Array {
  let v = BigInt(value);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function padRight32(data: Uint8Array): Uint8Array {
  const len = Math.ceil(data.length / 32) * 32;
  const out = new Uint8Array(len);
  out.set(data, 0);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * ABI-encode a tuple of dynamic byte arrays (each a Solidity `string` or
 * `bytes`): a head of 32-byte offsets followed by each item as a 32-byte length
 * plus right-padded data. This covers the `(string,bytes)` cross-VM signature.
 */
export function encodeDynamicTuple(items: Uint8Array[]): Uint8Array {
  const headLen = items.length * 32;
  const offsets: Uint8Array[] = [];
  const tail: Uint8Array[] = [];
  let running = 0;
  for (const item of items) {
    offsets.push(u256be(headLen + running));
    const chunk = concat([u256be(item.length), padRight32(item)]);
    tail.push(chunk);
    running += chunk.length;
  }
  return concat([...offsets, ...tail]);
}

/** A cross-VM call from an EVM context into a CosmWasm contract. */
export interface CrossVmCall {
  /** The target CosmWasm contract (bech32 `qor…` address). */
  contract: string;
  /** The CosmWasm execute message (UTF-8 JSON string or raw bytes). */
  msg: string | Uint8Array;
  /** Override the precompile signature if your node's ABI differs. */
  signature?: string;
}

/**
 * Build the `0x`-prefixed EVM calldata for a cross-VM call: the function
 * selector followed by the ABI-encoded `(string contract, bytes msg)` tuple.
 */
export function encodeCrossVmCalldata(call: CrossVmCall): string {
  const signature = call.signature ?? CROSS_VM_DEFAULT_SIGNATURE;
  const selector = functionSelector(signature).slice(2);
  const contractBytes = new TextEncoder().encode(call.contract);
  const msgBytes = typeof call.msg === "string" ? new TextEncoder().encode(call.msg) : call.msg;
  const args = encodeDynamicTuple([contractBytes, msgBytes]);
  return `0x${selector}${bytesToHex(args)}`;
}

/** Coerce a hex/bytes payload to bytes (re-exported convenience). */
export { toBytes };
