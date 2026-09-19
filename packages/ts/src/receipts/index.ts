/**
 * Quantum-Safe Settlement Receipts.
 *
 * A settlement receipt is a portable record that a rollup's settlement batch
 * was anchored to the QoreChain Main Chain under a post-quantum
 * (ML-DSA-87 / Dilithium-5) signature.
 *
 * A receipt is a **claim, not evidence** — every field in it is supplied by
 * whoever hands it to you. {@link verifySettlementReceipt} therefore re-reads
 * the claim from live chain state (the rollup's layer, the batch's state root,
 * the anchor, and the creator's registered key) and only then reports it valid.
 * Checking the signature alone, against a key you were handed, proves that
 * someone signed those bytes — not that QoreChain anchored anything.
 *
 * Canonical anchor message (matches the chain's `anchorSignBytes`):
 *   layer_id || layer_height(8-byte big-endian) || state_root || validator_set_hash
 */
import { pqcVerify } from "@qorechain/sdk";
import type { RdkClient } from "../client/rdk-client";
import type { AnchorView, RollupView } from "../client/views";
import { bytesToHex, decodeWireBytes, hexToBytes } from "../utils/bytes";

/** The post-quantum algorithm the anchor signature uses. */
export const RECEIPT_ALGORITHM = "ML-DSA-87";

/** Current receipt schema version. */
export const RECEIPT_VERSION = 1 as const;

/** A portable settlement receipt. Verify it with {@link verifySettlementReceipt}. */
export interface SettlementReceipt {
  version: typeof RECEIPT_VERSION;
  rollupId: string;
  layerId: string;
  batchIndex: number;
  /** The layer creator — the registered signer of the anchor's PQC signature. */
  creator: string;
  algorithm: string;
  /** The anchored state root (hex). */
  stateRoot: string;
  layerHeight: number;
  validatorSetHash: string;
  mainChainHeight: number;
  anchoredAt: number;
  /** The Dilithium-5 anchor signature (hex). */
  pqcSignature: string;
  /**
   * The state root read from the settlement batch (hex) when the receipt was
   * built. Informational only — verification compares the receipt against the
   * chain's batch, never against this copy of it.
   */
  batchStateRoot: string;
}

/**
 * How a receipt was checked.
 *
 * - `chain` — every field was reproduced from live chain state. Only this mode
 *   can yield `valid: true`.
 * - `signature-only` — the ML-DSA-87 signature was checked against a key the
 *   caller supplied. This proves that whoever holds that key signed these bytes;
 *   it does **not** prove the anchor exists on QoreChain. Always `valid: false`.
 */
export type ReceiptVerificationMode = "chain" | "signature-only";

/** The outcome of verifying a receipt. */
export interface ReceiptVerification {
  /** True only when the receipt was reproduced from live chain state. */
  valid: boolean;
  /** Which check was actually performed. */
  mode: ReceiptVerificationMode;
  checks: {
    /** The chain says `rollupId` belongs to the receipt's `layerId`. */
    rollupLayerBinding: boolean;
    /** The chain's batch carries the receipt's state root. */
    batchStateRoot: boolean;
    /** An anchor with this state root, height and signature exists on chain. */
    anchorOnChain: boolean;
    /** The signing key was resolved from chain, not taken from the receipt. */
    creatorAuthority: boolean;
    /** The Dilithium-5 signature over the canonical message verified. */
    pqcSignature: boolean;
  };
  reason?: string;
}

const NO_CHECKS: ReceiptVerification["checks"] = {
  rollupLayerBinding: false,
  batchStateRoot: false,
  anchorOnChain: false,
  creatorAuthority: false,
  pqcSignature: false,
};

/** Encode a uint64 as 8 big-endian bytes. */
function u64be(value: number | bigint): Uint8Array {
  let v = BigInt(value);
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

const enc = new TextEncoder();

/**
 * Reconstruct the canonical message the chain signs for a state anchor:
 * `layer_id || layer_height(8B BE) || state_root || validator_set_hash`.
 * Inputs are taken in hex (state_root, validator_set_hash) and a numeric height.
 */
export function anchorSignBytes(input: {
  layerId: string;
  layerHeight: number | bigint;
  stateRoot: string;
  validatorSetHash: string;
}): Uint8Array {
  const layerId = enc.encode(input.layerId);
  const height = u64be(input.layerHeight);
  const stateRoot = hexToBytes(input.stateRoot);
  const vsh = hexToBytes(input.validatorSetHash);
  const out = new Uint8Array(layerId.length + height.length + stateRoot.length + vsh.length);
  let o = 0;
  out.set(layerId, o); o += layerId.length;
  out.set(height, o); o += height.length;
  out.set(stateRoot, o); o += stateRoot.length;
  out.set(vsh, o);
  return out;
}

function receiptFromParts(
  rollupId: string,
  layerId: string,
  batchIndex: number,
  creator: string,
  anchor: AnchorView,
  batchStateRootHex: string,
): SettlementReceipt {
  return {
    version: RECEIPT_VERSION,
    rollupId,
    layerId,
    batchIndex,
    creator,
    algorithm: RECEIPT_ALGORITHM,
    stateRoot: anchor.stateRoot,
    layerHeight: anchor.layerHeight,
    validatorSetHash: anchor.validatorSetHash,
    mainChainHeight: anchor.mainChainHeight,
    anchoredAt: anchor.anchoredAt,
    pqcSignature: anchor.pqcSignature,
    batchStateRoot: batchStateRootHex,
  };
}

/**
 * Build a settlement receipt for `rollupId`'s batch `batchIndex`: resolve the
 * rollup's layer, read the batch's state root, and find the state anchor that
 * commits that root to the Main Chain. Throws if the rollup has no layer, the
 * batch is missing, or no anchor covers the batch's state root yet.
 */
export async function buildSettlementReceipt(
  client: RdkClient,
  rollupId: string,
  batchIndex: number,
): Promise<SettlementReceipt> {
  const rollup = await client.rest.getRollup(rollupId);
  if (!rollup.layerId) {
    throw new Error(`rollup "${rollupId}" has no layer_id — it is not anchored to a multilayer layer`);
  }
  const batch = await client.rest.getBatch(rollupId, batchIndex);
  const batchStateRootHex = batch.stateRoot
    ? bytesToHex(decodeWireBytes(batch.stateRoot))
    : "";

  const anchors = await client.rest.getAnchors(rollup.layerId);
  const covering = anchors.find((a) => a.stateRoot && a.stateRoot === batchStateRootHex);
  const anchor = covering ?? (await client.rest.getLatestAnchor(rollup.layerId));
  if (!anchor.stateRoot) {
    throw new Error(`no state anchor found for layer "${rollup.layerId}"`);
  }
  if (!covering) {
    throw new Error(
      `no anchor commits batch ${batchIndex}'s state root yet (latest anchored height ${anchor.layerHeight}); the batch may not be anchored to the Main Chain`,
    );
  }
  return receiptFromParts(rollupId, rollup.layerId, batchIndex, rollup.creator, anchor, batchStateRootHex);
}

/** Options for {@link verifySettlementReceipt}. */
export interface VerifyReceiptOptions {
  /**
   * A client for the network the receipt claims to come from. **Required for a
   * real verification** — every field is re-read from chain state, so a
   * fabricated receipt cannot pass.
   */
  client?: RdkClient;
  /**
   * Signature-only mode: check the ML-DSA-87 signature against a key you
   * obtained out-of-band. This proves only that the holder of that key signed
   * these bytes — **never** that QoreChain anchored the batch — so the result
   * is always `valid: false` with `mode: "signature-only"`. Ignored when
   * `client` is supplied.
   */
  creatorPublicKey?: string;
}

function signatureOver(receipt: SettlementReceipt, publicKeyHex: string): boolean {
  if (!publicKeyHex || receipt.pqcSignature === "") return false;
  try {
    return pqcVerify(
      hexToBytes(publicKeyHex),
      anchorSignBytes(receipt),
      hexToBytes(receipt.pqcSignature),
    );
  } catch {
    return false;
  }
}

/**
 * Verify a settlement receipt against live chain state.
 *
 * A receipt is a *claim*, not evidence: every field in it is supplied by
 * whoever hands it to you. Verification therefore re-reads the claim from the
 * chain — the rollup's layer, the batch's state root, the anchor itself, and
 * the signing key — and reports `valid: true` only when the receipt reproduces
 * what the chain actually holds. Pass `client` for this.
 *
 * Without a `client` you can still check the signature (`creatorPublicKey`),
 * but that is `mode: "signature-only"` and never `valid`: a signature proves
 * someone signed these bytes, not that the anchor exists.
 */
export async function verifySettlementReceipt(
  receipt: SettlementReceipt,
  options: VerifyReceiptOptions = {},
): Promise<ReceiptVerification> {
  const checks = { ...NO_CHECKS };

  if (!options.client) {
    if (!options.creatorPublicKey) {
      return {
        valid: false,
        mode: "signature-only",
        checks,
        reason:
          "no client supplied — pass `client` to verify against chain state; a receipt on its own proves nothing",
      };
    }
    checks.pqcSignature = signatureOver(receipt, options.creatorPublicKey);
    return {
      valid: false,
      mode: "signature-only",
      checks,
      reason: checks.pqcSignature
        ? "signature is valid for the supplied key, but nothing was checked against the chain — pass `client` to verify settlement"
        : "signature did not verify against the supplied key",
    };
  }

  const rest = options.client.rest;
  const fail = (reason: string): ReceiptVerification => ({ valid: false, mode: "chain", checks, reason });

  // 1. The rollup must exist on chain and belong to the layer the receipt names.
  let rollup: RollupView;
  try {
    rollup = await rest.getRollup(receipt.rollupId);
  } catch (err) {
    return fail(`rollup "${receipt.rollupId}" not found on chain: ${(err as Error).message}`);
  }
  checks.rollupLayerBinding = !!rollup.layerId && rollup.layerId === receipt.layerId;
  if (!checks.rollupLayerBinding) {
    return fail(
      `rollup "${receipt.rollupId}" is anchored to layer "${rollup.layerId || "(none)"}", not "${receipt.layerId}"`,
    );
  }

  // 2. The chain's batch must carry the receipt's state root (not the receipt's own copy).
  try {
    const batch = await rest.getBatch(receipt.rollupId, receipt.batchIndex);
    const onChainRoot = batch.stateRoot ? bytesToHex(decodeWireBytes(batch.stateRoot)) : "";
    checks.batchStateRoot = onChainRoot !== "" && onChainRoot === receipt.stateRoot;
  } catch (err) {
    return fail(`batch ${receipt.batchIndex} not found on chain: ${(err as Error).message}`);
  }
  if (!checks.batchStateRoot) {
    return fail("the chain's batch does not carry the receipt's state root");
  }

  // 3. An anchor matching this receipt must actually exist on chain.
  try {
    const anchors = await rest.getAnchors(receipt.layerId);
    checks.anchorOnChain = anchors.some(
      (a) =>
        a.stateRoot === receipt.stateRoot &&
        a.layerHeight === receipt.layerHeight &&
        a.validatorSetHash === receipt.validatorSetHash &&
        a.pqcSignature === receipt.pqcSignature,
    );
  } catch (err) {
    return fail(`could not read anchors for layer "${receipt.layerId}": ${(err as Error).message}`);
  }
  if (!checks.anchorOnChain) {
    return fail("no anchor on chain matches this receipt — it is fabricated or superseded");
  }

  // 4. The signing key is resolved from the chain, never taken from the receipt.
  let publicKeyHex = "";
  try {
    const account = await rest.getPqcAccount(rollup.creator);
    publicKeyHex = account.publicKey;
  } catch (err) {
    return fail(`could not resolve the creator's post-quantum key: ${(err as Error).message}`);
  }
  if (receipt.creator !== rollup.creator) {
    return fail(
      `receipt names creator "${receipt.creator}" but the chain says the rollup's creator is "${rollup.creator}"`,
    );
  }
  checks.creatorAuthority = publicKeyHex !== "";
  if (!checks.creatorAuthority) {
    return fail(`no post-quantum key is registered for creator ${rollup.creator}`);
  }

  // 5. Finally the post-quantum signature over the canonical anchor message.
  checks.pqcSignature = signatureOver(receipt, publicKeyHex);
  return checks.pqcSignature
    ? { valid: true, mode: "chain", checks }
    : fail("Dilithium-5 anchor signature did not verify against the creator's registered key");
}
