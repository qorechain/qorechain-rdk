/**
 * Quantum-Safe Settlement Receipts.
 *
 * A settlement receipt is a portable, self-contained proof that a rollup's
 * settlement batch was anchored to the QoreChain Main Chain under a
 * post-quantum (ML-DSA-87 / Dilithium-5) signature. It can be verified fully
 * offline: reconstruct the canonical anchor message, fetch (or supply) the
 * layer creator's registered PQC key, and check the Dilithium-5 signature plus
 * the batch↔anchor state-root binding.
 *
 * Canonical anchor message (matches the chain's `anchorSignBytes`):
 *   layer_id || layer_height(8-byte big-endian) || state_root || validator_set_hash
 */
import { pqcVerify } from "@qorechain/sdk";
import type { RdkClient } from "../client/rdk-client";
import type { AnchorView } from "../client/views";
import { bytesToHex, decodeWireBytes, hexToBytes } from "../utils/bytes";

/** The post-quantum algorithm the anchor signature uses. */
export const RECEIPT_ALGORITHM = "ML-DSA-87";

/** Current receipt schema version. */
export const RECEIPT_VERSION = 1 as const;

/** A portable, offline-verifiable settlement receipt. */
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
  /** The state root read from the settlement batch (hex), for the binding check. */
  batchStateRoot: string;
}

/** The outcome of verifying a receipt. */
export interface ReceiptVerification {
  valid: boolean;
  checks: {
    /** The batch's state root equals the anchored state root. */
    stateRootBinding: boolean;
    /** The Dilithium-5 signature over the canonical message verified. */
    pqcSignature: boolean;
    /** A non-empty signature and key were present to check. */
    hasMaterial: boolean;
  };
  reason?: string;
}

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
   * The layer creator's ML-DSA-87 public key (hex). Supply it for a fully
   * offline check. If omitted, `client` is used to fetch it from the chain.
   */
  creatorPublicKey?: string;
  /** A client to resolve the creator's PQC key when `creatorPublicKey` is absent. */
  client?: RdkClient;
}

/**
 * Verify a settlement receipt: the batch↔anchor state-root binding and the
 * Dilithium-5 signature over the canonical anchor message. With
 * `creatorPublicKey` supplied this is fully offline; otherwise `client` fetches
 * the creator's registered post-quantum key.
 */
export async function verifySettlementReceipt(
  receipt: SettlementReceipt,
  options: VerifyReceiptOptions = {},
): Promise<ReceiptVerification> {
  const checks = { stateRootBinding: false, pqcSignature: false, hasMaterial: false };

  checks.stateRootBinding =
    receipt.stateRoot !== "" && receipt.stateRoot === receipt.batchStateRoot;

  let publicKeyHex = options.creatorPublicKey;
  if (!publicKeyHex) {
    if (!options.client) {
      return {
        valid: false,
        checks,
        reason: "no creatorPublicKey supplied and no client to fetch the creator's PQC key",
      };
    }
    const account = await options.client.rest.getPqcAccount(receipt.creator);
    publicKeyHex = account.publicKey;
  }

  checks.hasMaterial = !!publicKeyHex && receipt.pqcSignature !== "";
  if (!checks.hasMaterial) {
    return { valid: false, checks, reason: "missing public key or anchor signature" };
  }

  const message = anchorSignBytes(receipt);
  try {
    checks.pqcSignature = pqcVerify(
      hexToBytes(publicKeyHex),
      message,
      hexToBytes(receipt.pqcSignature),
    );
  } catch (err) {
    return { valid: false, checks, reason: `signature check failed: ${(err as Error).message}` };
  }

  const valid = checks.stateRootBinding && checks.pqcSignature;
  return {
    valid,
    checks,
    reason: valid
      ? undefined
      : !checks.stateRootBinding
        ? "batch state root does not match the anchored state root"
        : "Dilithium-5 anchor signature did not verify",
  };
}
