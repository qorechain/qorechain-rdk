/**
 * Multi-VM tooling — helpers for the EVM→QoreChain Native cross-VM precompile.
 *
 * QoreChain's full build compiles a precompile at a fixed address that lets EVM
 * (Solidity) contracts call into QoreChain Native (Wasm) contracts. This module
 * builds the EVM calldata for it and checks whether it is actually live.
 *
 * **Read this before relying on it.** The precompile is **not active on
 * qorechain-vladi (mainnet) or qorechain-diana (testnet)** today: it runs only
 * once governance lists its address in the EVM parameter
 * `active_static_precompiles`, which does not include it on either network
 * (checked 27 October 2026). From chain
 * v3.2.3 it also reaches only the targets governance allowlists in the
 * cross-VM parameter `bridge_allowed_targets`; an empty list keeps it shut.
 *
 * Until it is active, **a call to it succeeds and returns empty data** — the
 * ordinary EVM behaviour for an address with no code. A `success` check alone
 * therefore reports a call that never happened. Check
 * {@link isCrossVmPrecompileActive} first; see that function for the reason an
 * in-contract check cannot settle this on its own.
 *
 * From chain v3.2.5 (`crossvm-bridge-abi`) the precompile checks the selector,
 * answers only `executeCrossVMCall(uint8,string,bytes) returns (bytes)` with
 * `targetVM` 1 (QoreChain Native), and ABI-encodes its result: decode it with
 * {@link decodeCrossVmResult} (Solidity: `abi.decode(ret, (bytes))`). A
 * refusal reverts with `Error(string)` ({@link decodeRevertReason}). The
 * Native contract sees the CALLER of `0x…0901` as its sender, not
 * `tx.origin`. The allowlist is served at `/qorechain/crossvm/v1/params`
 * ({@link getCrossVmParams}).
 *
 * Note: this is the EVM↔QoreChain Native bridge only. SVM cross-calls are separate.
 */
import { keccak256 } from "@cosmjs/crypto";
import { bytesToHex, toBytes } from "../utils/bytes";

/** The fixed address of the cross-VM precompile (EVM→QoreChain Native). */
export const CROSS_VM_PRECOMPILE = "0x0000000000000000000000000000000000000901";

/**
 * The precompile's signature, as the chain decodes it:
 * `executeCrossVMCall(uint8 targetVM, string targetContract, bytes payload)`.
 *
 * Releases before 0.6.0 used `executeCrossVMCall(string,bytes)`, which is a
 * different function selector: no call they encoded would ever have reached
 * the precompile, even on a network that had activated it.
 */
export const CROSS_VM_DEFAULT_SIGNATURE = "executeCrossVMCall(uint8,string,bytes)";

/**
 * The `targetVM` values the precompile accepts. Any other value is refused.
 * EVM→EVM is accepted by the decoder but refused by the chain from v3.2.3,
 * which rejects a call whose source lane equals its target lane.
 */
export const CROSS_VM_TARGET = {
  EVM: 0,
  NATIVE: 1,
} as const;

/** A `targetVM` value the precompile accepts. */
export type CrossVmTarget = (typeof CROSS_VM_TARGET)[keyof typeof CROSS_VM_TARGET];

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
 * plus right-padded data.
 *
 * `headWords` is the number of 32-byte words that precede the offsets in the
 * head (static arguments placed before the dynamic ones), which the offsets
 * must account for.
 */
export function encodeDynamicTuple(items: Uint8Array[], headWords = 0): Uint8Array {
  const headLen = (headWords + items.length) * 32;
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

/** A cross-VM call from an EVM context into another lane. */
export interface CrossVmCall {
  /** The target contract (a bech32 `qor…` address for a QoreChain Native contract). */
  contract: string;
  /** The target's execute message (UTF-8 JSON string or raw bytes). */
  msg: string | Uint8Array;
  /**
   * Which lane to call. Defaults to {@link CROSS_VM_TARGET.NATIVE}, the
   * EVM→QoreChain Native direction this tooling exists for.
   */
  targetVm?: CrossVmTarget;
}

/**
 * Build the `0x`-prefixed EVM calldata for a cross-VM call: the selector of
 * `executeCrossVMCall(uint8,string,bytes)` followed by the ABI-encoded
 * `(targetVM, contract, msg)` tuple, byte-for-byte what the chain's decoder
 * reads.
 *
 * This only builds calldata. Whether the precompile will act on it is a
 * separate question — see {@link isCrossVmPrecompileActive}.
 */
export function encodeCrossVmCalldata(call: CrossVmCall): string {
  const targetVm = call.targetVm ?? CROSS_VM_TARGET.NATIVE;
  if (targetVm !== CROSS_VM_TARGET.EVM && targetVm !== CROSS_VM_TARGET.NATIVE) {
    throw new Error(`unsupported cross-VM target ${String(targetVm)}: the precompile accepts 0 (EVM) or 1 (Native)`);
  }
  const selector = functionSelector(CROSS_VM_DEFAULT_SIGNATURE).slice(2);
  const contractBytes = new TextEncoder().encode(call.contract);
  const msgBytes = typeof call.msg === "string" ? new TextEncoder().encode(call.msg) : call.msg;
  // uint8 is static, so it sits inline as the first head word; the string and
  // bytes are dynamic, so their offsets follow it and their data goes in the tail.
  const head = u256be(targetVm);
  const dynamic = encodeDynamicTuple([contractBytes, msgBytes], 1);
  return `0x${selector}${bytesToHex(concat([head, dynamic]))}`;
}

/** Why {@link isCrossVmPrecompileActive} answered as it did. */
export interface CrossVmPrecompileStatus {
  /** True only when the precompile's address is in `active_static_precompiles`. */
  active: boolean;
  /** The list the node reported (lowercase 0x addresses). */
  activePrecompiles: string[];
  reason: string;
}

/**
 * Ask a node whether the cross-VM precompile is live, by reading the EVM
 * parameter `active_static_precompiles` over REST.
 *
 * This is the only reliable check, and it has to happen off-chain. The
 * precompile returns the target's **raw** reply, so a genuine call to a Native
 * contract that returns nothing is also empty — "empty data" cannot by itself
 * tell an inactive precompile from a successful call. A precompile also has no
 * bytecode whether active or not, so `extcodesize` cannot tell either. Inside a
 * contract, the dependable pattern is a target that always returns a non-empty
 * acknowledgement, so that an empty reply can be treated as failure; the
 * `multivm-rollup` template does that.
 *
 * Even when this returns `active: true`, from chain v3.2.3 a call reaches only
 * the targets in the cross-VM parameter `bridge_allowed_targets` (each
 * `<vm>:<contract>`); every other target is refused.
 */
export async function isCrossVmPrecompileActive(
  restBase: string,
  fetchImpl: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> = (u) =>
    fetch(u),
): Promise<CrossVmPrecompileStatus> {
  const url = `${restBase.replace(/\/+$/, "")}/cosmos/evm/vm/v1/params`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    return { active: false, activePrecompiles: [], reason: `could not read EVM params (HTTP ${res.status})` };
  }
  const body = (await res.json()) as { params?: { active_static_precompiles?: unknown } };
  const raw = body.params?.active_static_precompiles;
  const list = Array.isArray(raw) ? raw.map((a) => String(a).toLowerCase()) : [];
  const active = list.includes(CROSS_VM_PRECOMPILE.toLowerCase());
  return {
    active,
    activePrecompiles: list,
    reason: active
      ? "the cross-VM precompile is listed in active_static_precompiles"
      : list.length === 0
        ? "active_static_precompiles is empty on this network, so no QoreChain precompile runs; a call to the address succeeds with empty data and does nothing"
        : `the cross-VM precompile is not among the ${list.length} active precompile(s)`,
  };
}

/** The cross-VM module parameters a node serves (chain v3.2.5 and later). */
export interface CrossVmParams {
  enabled: boolean;
  /** Allowlisted targets, each `<vm>:<contract>` (e.g. `cosmwasm:qor1…`). */
  bridgeAllowedTargets: string[];
  maxMessageSize: number;
}

/**
 * Read the cross-VM parameters, including the allowlist
 * (`/qorechain/crossvm/v1/params`). Chains before v3.2.5 do not serve the route
 * (HTTP 501), which this reports as an error.
 */
export async function getCrossVmParams(
  restBase: string,
  fetchImpl: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> = (u) =>
    fetch(u),
): Promise<CrossVmParams> {
  const res = await fetchImpl(`${restBase.replace(/\/+$/, "")}/qorechain/crossvm/v1/params`);
  if (!res.ok) throw new Error(`could not read cross-VM params (HTTP ${res.status})`);
  const body = (await res.json()) as Record<string, unknown>;
  const p = (body.params ?? body) as Record<string, unknown>;
  const targets = Array.isArray(p.bridge_allowed_targets) ? p.bridge_allowed_targets.map(String) : [];
  return {
    enabled: p.enabled === true,
    bridgeAllowedTargets: targets,
    maxMessageSize: Number(p.max_message_size ?? 0),
  };
}

/**
 * Whether a call to the QoreChain Native contract `contract` would reach it:
 * the precompile is active, the bridge is enabled, and `cosmwasm:<contract>`
 * is allowlisted. Says which condition failed.
 */
export async function crossVmTargetReady(
  restBase: string,
  contract: string,
  fetchImpl?: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
): Promise<{ ready: boolean; reason: string }> {
  const precompile = await isCrossVmPrecompileActive(restBase, fetchImpl);
  if (!precompile.active) return { ready: false, reason: precompile.reason };
  let params: CrossVmParams;
  try {
    params = await getCrossVmParams(restBase, fetchImpl);
  } catch (err) {
    return { ready: false, reason: (err as Error).message };
  }
  if (!params.enabled) return { ready: false, reason: "the cross-VM bridge is disabled on this network" };
  const target = `cosmwasm:${contract}`;
  return params.bridgeAllowedTargets.includes(target)
    ? { ready: true, reason: `${target} is allowlisted and the precompile is active` }
    : { ready: false, reason: `${target} is not in bridge_allowed_targets; governance must allowlist it` };
}

const readWord = (b: Uint8Array, at: number): bigint => {
  let v = 0n;
  for (let i = 0; i < 32; i++) v = (v << 8n) | BigInt(b[at + i]);
  return v;
};

/**
 * Decode the precompile's return data, `abi.encode(bytes)`, into the Native
 * contract's response bytes (often empty). Throws on empty or malformed data:
 * from chain v3.2.5 an active precompile always returns at least 64 bytes, so
 * empty data means the call reached nothing.
 */
export function decodeCrossVmResult(ret: string | Uint8Array): Uint8Array {
  const b = toBytes(ret);
  if (b.length === 0) {
    throw new Error("empty return data: the cross-VM precompile is not active, so the call did nothing");
  }
  if (b.length < 64) throw new Error(`cross-VM return data is ${b.length} bytes; abi.encode(bytes) is at least 64`);
  const offset = Number(readWord(b, 0));
  if (offset + 32 > b.length) throw new Error("cross-VM return data has an out-of-range offset");
  const len = Number(readWord(b, offset));
  if (offset + 32 + len > b.length) throw new Error("cross-VM return data is shorter than its length word");
  return b.slice(offset + 32, offset + 32 + len);
}

/**
 * The reason string of a revert encoded as `Error(string)` (selector
 * `0x08c379a0`), which is how the precompile reports a refusal, or `undefined`
 * if `data` is not one.
 */
export function decodeRevertReason(data: string | Uint8Array): string | undefined {
  const b = toBytes(data);
  if (b.length < 4 + 64 || bytesToHex(b.slice(0, 4)) !== "08c379a0") return undefined;
  const body = b.slice(4);
  const offset = Number(readWord(body, 0));
  if (offset + 32 > body.length) return undefined;
  const len = Number(readWord(body, offset));
  if (offset + 32 + len > body.length) return undefined;
  return new TextDecoder().decode(body.slice(offset + 32, offset + 32 + len));
}

/** Coerce a hex/bytes payload to bytes (re-exported convenience). */
export { toBytes };
