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

/**
 * Current receipt schema version.
 *
 * v2 adds `chainId`. The v2 anchor message binds the signature to one network,
 * and a receipt shown to a third party should say which network it is for
 * rather than leave them to assume. Version-1 receipts still verify.
 */
export const RECEIPT_VERSION = 2 as const;

/** The receipt schema versions this release can verify. */
export const SUPPORTED_RECEIPT_VERSIONS: readonly number[] = [1, 2];

/** A portable settlement receipt. Verify it with {@link verifySettlementReceipt}. */
export interface SettlementReceipt {
  /** Schema version: 2 carries `chainId`, 1 does not. */
  version: number;
  /**
   * The chain the receipt was built on (e.g. `qorechain-vladi`). Bound into
   * the v2 anchor signature, and cross-checked against the node being queried
   * so a mainnet receipt cannot be passed off as a testnet one or vice versa.
   * Absent on version-1 receipts.
   */
  chainId?: string;
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
   * built. Verification requires it to equal the chain's batch root.
   */
  batchStateRoot: string;
  /**
   * The anchor's transaction count, covered by the v2 signature. Required on a
   * version-2 receipt; verification requires it to equal the chain's anchor.
   */
  transactionCount?: number;
  /**
   * The anchor's compressed state proof (hex), covered by the v2 signature.
   * Empty for a settlement batch. Required on a version-2 receipt;
   * verification requires it to equal the chain's anchor.
   */
  compressedStateProof?: string;
}

/**
 * How a receipt was checked.
 *
 * - `chain` — every receipt field was checked against live chain state. Only this mode
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
    /**
     * An anchor exists on chain that matches every anchor field of the
     * receipt: state root, layer height, validator-set hash, signature, Main
     * Chain height, anchor time, and (when present) transaction count and
     * compressed state proof.
     */
    anchorOnChain: boolean;
    /** The signing key was resolved from chain, not taken from the receipt. */
    creatorAuthority: boolean;
    /** The Dilithium-5 signature over the canonical message verified. */
    pqcSignature: boolean;
    /**
     * The receipt names the chain that was actually queried. A version-1
     * receipt carries no chain id and passes on the strength of the anchor
     * having been found on this chain.
     */
    chainBinding: boolean;
  };
  /**
   * Which canonical anchor message the signature was checked against: `v2`
   * from the chain's `rdk-integrity` height, `v1` below it.
   */
  signBytesVersion?: AnchorSignBytesVersion;
  /**
   * The chain's own anchor that the receipt was matched to, once one was
   * found. Read facts from this, not from the receipt you were handed.
   */
  anchor?: AnchorView;
  /**
   * The receipt rebuilt from chain state, present only when `valid` is true.
   * Every field of it was read from the node you queried.
   */
  verifiedReceipt?: SettlementReceipt;
  reason?: string;
}

const NO_CHECKS: ReceiptVerification["checks"] = {
  rollupLayerBinding: false,
  batchStateRoot: false,
  anchorOnChain: false,
  creatorAuthority: false,
  pqcSignature: false,
  chainBinding: false,
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

/** Domain tag of the v2 anchor sign bytes (chain v3.2.2 and above). */
export const ANCHOR_SIGN_DOMAIN_V2 = "qorechain-multilayer-anchor-v2";

/** Which canonical anchor message a signature covers. */
export type AnchorSignBytesVersion = "v1" | "v2";

/**
 * The **pre-v3.2.2** canonical anchor message:
 * `layer_id || layer_height(8B BE) || state_root || validator_set_hash`.
 *
 * Kept because anchors written before the chain's `FeatureRDKIntegrity` switch
 * are signed this way and stay valid forever. Do not use it for new work: it
 * carries no length prefixes, so field boundaries are ambiguous, and no chain
 * id, so a signature is valid on **every** chain. Both are why v2 exists.
 */
export function anchorSignBytesV1(input: {
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

/**
 * The **v3.2.2 and later** canonical anchor message. Every variable-length
 * field carries an 8-byte big-endian length, the chain id binds the signature
 * to one network, and the transaction count and compressed state proof are
 * covered too, because the chain computes its anchor fraud check from them:
 *
 * ```text
 * "qorechain-multilayer-anchor-v2"
 *  | BE64 len(chain_id)               chain_id
 *  | BE64 len(layer_id)               layer_id
 *  | BE64                             layer_height
 *  | BE64 len(state_root)             state_root
 *  | BE64 len(validator_set_hash)     validator_set_hash
 *  | BE64                             transaction_count
 *  | BE64 len(compressed_state_proof) compressed_state_proof
 * ```
 *
 * For a settlement batch the chain maps these as: `layer_id` is the rollup's
 * layer id, `layer_height` is the **batch index**, `state_root` is the batch
 * state root, `transaction_count` is the batch's transaction count, and
 * `compressed_state_proof` is empty.
 */
export function anchorSignBytesV2(input: {
  chainId: string;
  layerId: string;
  layerHeight: number | bigint;
  stateRoot: string;
  validatorSetHash: string;
  transactionCount: number | bigint;
  compressedStateProof?: string;
}): Uint8Array {
  const parts: Uint8Array[] = [enc.encode(ANCHOR_SIGN_DOMAIN_V2)];
  const lengthPrefixed = (b: Uint8Array): void => {
    parts.push(u64be(b.length), b);
  };
  lengthPrefixed(enc.encode(input.chainId));
  lengthPrefixed(enc.encode(input.layerId));
  parts.push(u64be(input.layerHeight));
  lengthPrefixed(hexToBytes(input.stateRoot));
  lengthPrefixed(hexToBytes(input.validatorSetHash));
  parts.push(u64be(input.transactionCount));
  lengthPrefixed(hexToBytes(input.compressedStateProof ?? ""));

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
 * The canonical anchor message in the requested form.
 *
 * `v2` needs `chainId` and `transactionCount`; omitting them throws rather than
 * silently signing a different message than the chain verified.
 */
export function anchorSignBytes(
  input: {
    layerId: string;
    layerHeight: number | bigint;
    stateRoot: string;
    validatorSetHash: string;
    chainId?: string;
    transactionCount?: number | bigint;
    compressedStateProof?: string;
  },
  version: AnchorSignBytesVersion = "v1",
): Uint8Array {
  if (version === "v1") return anchorSignBytesV1(input);
  if (!input.chainId) {
    throw new Error("v2 anchor sign bytes need `chainId` — it is bound into the message");
  }
  if (input.transactionCount === undefined) {
    throw new Error("v2 anchor sign bytes need `transactionCount` — it is covered by the signature");
  }
  return anchorSignBytesV2({
    chainId: input.chainId,
    layerId: input.layerId,
    layerHeight: input.layerHeight,
    stateRoot: input.stateRoot,
    validatorSetHash: input.validatorSetHash,
    transactionCount: input.transactionCount,
    compressedStateProof: input.compressedStateProof,
  });
}

function receiptFromParts(
  rollupId: string,
  layerId: string,
  batchIndex: number,
  creator: string,
  anchor: AnchorView,
  batchStateRootHex: string,
  chainId: string,
): SettlementReceipt {
  return {
    version: RECEIPT_VERSION,
    chainId,
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
    transactionCount: anchor.transactionCount,
    compressedStateProof: anchor.compressedStateProof,
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
  return receiptFromParts(
    rollupId,
    rollup.layerId,
    batchIndex,
    rollup.creator,
    anchor,
    batchStateRootHex,
    client.network.chainId,
  );
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

/**
 * Why `receipt` cannot be verified at all, or `undefined` when its version,
 * algorithm and required fields are acceptable. Checked before anything is
 * read from chain: an unknown version or algorithm is refused, never guessed.
 */
export function receiptSchemaError(receipt: SettlementReceipt): string | undefined {
  if (!Number.isInteger(receipt.version) || !SUPPORTED_RECEIPT_VERSIONS.includes(receipt.version)) {
    return `unsupported receipt version ${JSON.stringify(receipt.version)} (this release verifies versions ${SUPPORTED_RECEIPT_VERSIONS.join(" and ")})`;
  }
  if (receipt.algorithm !== RECEIPT_ALGORITHM) {
    return `unsupported algorithm ${JSON.stringify(receipt.algorithm)}: QoreChain anchors are signed with ${RECEIPT_ALGORITHM}`;
  }
  if (receipt.version === 2) {
    if (!receipt.chainId) return "a version-2 receipt must name its chain (chainId)";
    if (receipt.transactionCount === undefined) return "a version-2 receipt must carry transactionCount";
    if (receipt.compressedStateProof === undefined) return "a version-2 receipt must carry compressedStateProof";
  }
  return undefined;
}

/**
 * The first anchor field on which `receipt` and the chain's `anchor` differ, or
 * `undefined` when they agree on all of them. Fields a version-1 receipt may
 * omit are compared whenever the receipt carries them.
 */
function anchorFieldMismatch(receipt: SettlementReceipt, anchor: AnchorView): string | undefined {
  const fields: Array<[string, unknown, unknown]> = [
    ["validatorSetHash", receipt.validatorSetHash, anchor.validatorSetHash],
    ["mainChainHeight", receipt.mainChainHeight, anchor.mainChainHeight],
    ["anchoredAt", receipt.anchoredAt, anchor.anchoredAt],
  ];
  if (receipt.transactionCount !== undefined) {
    fields.push(["transactionCount", receipt.transactionCount, anchor.transactionCount]);
  }
  if (receipt.compressedStateProof !== undefined) {
    fields.push([
      "compressedStateProof",
      receipt.compressedStateProof.toLowerCase(),
      anchor.compressedStateProof.toLowerCase(),
    ]);
  }
  for (const [name, claimed, onChain] of fields) {
    if (claimed !== onChain) {
      return `receipt's ${name} ${JSON.stringify(claimed)} does not match the chain's anchor (${JSON.stringify(onChain)})`;
    }
  }
  return undefined;
}

/**
 * Which anchor message a given anchor was signed over: the form in force at
 * the Main Chain height the anchor was recorded at.
 *
 * Deciding by height rather than trying both forms matters. A v1 signature
 * covers no chain id, so it is valid on *every* chain; accepting v1 where v2 is
 * in force would re-admit exactly the weakness v2 was introduced to close.
 */
export function anchorSignBytesVersionFor(
  anchorMainChainHeight: number,
  v2Height: number,
): AnchorSignBytesVersion {
  return anchorMainChainHeight >= v2Height ? "v2" : "v1";
}

/**
 * Verify the anchor's post-quantum signature.
 *
 * Every signed field is taken from the **chain's** anchor, never from the
 * receipt — the receipt only says which anchor to go and look for. `chainId`
 * likewise comes from the network being queried.
 */
function signatureOver(
  anchor: AnchorView,
  publicKeyHex: string,
  chainId: string,
  version: AnchorSignBytesVersion,
): boolean {
  if (!publicKeyHex || anchor.pqcSignature === "") return false;
  try {
    const message =
      version === "v2"
        ? anchorSignBytesV2({
            chainId,
            layerId: anchor.layerId,
            layerHeight: anchor.layerHeight,
            stateRoot: anchor.stateRoot,
            validatorSetHash: anchor.validatorSetHash,
            transactionCount: anchor.transactionCount,
            compressedStateProof: anchor.compressedStateProof,
          })
        : anchorSignBytesV1({
            layerId: anchor.layerId,
            layerHeight: anchor.layerHeight,
            stateRoot: anchor.stateRoot,
            validatorSetHash: anchor.validatorSetHash,
          });
    return pqcVerify(hexToBytes(publicKeyHex), message, hexToBytes(anchor.pqcSignature));
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

  const schemaError = receiptSchemaError(receipt);
  if (schemaError) {
    return {
      valid: false,
      mode: options.client ? "chain" : "signature-only",
      checks,
      reason: schemaError,
    };
  }

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
    // Without a client there is no chain to read, so the receipt's own copies
    // of the signed fields are all there is — which is exactly why this mode
    // can never be `valid`. Both forms are tried because nothing here can tell
    // us the anchor's height.
    const asAnchor: AnchorView = {
      layerId: receipt.layerId,
      layerHeight: receipt.layerHeight,
      stateRoot: receipt.stateRoot,
      validatorSetHash: receipt.validatorSetHash,
      mainChainHeight: receipt.mainChainHeight,
      anchoredAt: receipt.anchoredAt,
      pqcSignature: receipt.pqcSignature,
      transactionCount: receipt.transactionCount ?? 0,
      compressedStateProof: receipt.compressedStateProof ?? "",
    };
    let version: AnchorSignBytesVersion | undefined;
    if (receipt.chainId && signatureOver(asAnchor, options.creatorPublicKey, receipt.chainId, "v2")) {
      checks.pqcSignature = true;
      version = "v2";
    } else if (signatureOver(asAnchor, options.creatorPublicKey, "", "v1")) {
      checks.pqcSignature = true;
      version = "v1";
    }
    return {
      valid: false,
      mode: "signature-only",
      checks,
      signBytesVersion: version,
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
    checks.batchStateRoot =
      onChainRoot !== "" && onChainRoot === receipt.stateRoot && onChainRoot === receipt.batchStateRoot;
  } catch (err) {
    return fail(`batch ${receipt.batchIndex} not found on chain: ${(err as Error).message}`);
  }
  if (!checks.batchStateRoot) {
    return fail("the chain's batch does not carry the receipt's state root (stateRoot and batchStateRoot)");
  }

  // 3. An anchor matching this receipt must actually exist on chain, and agree
  // with it on every anchor field the receipt states. The matched anchor is
  // kept: it, not the receipt, is what step 6 verifies and what is returned.
  let matched: AnchorView | undefined;
  try {
    const anchors = await rest.getAnchors(receipt.layerId);
    matched = anchors.find(
      (a) =>
        a.stateRoot === receipt.stateRoot &&
        a.layerHeight === receipt.layerHeight &&
        a.pqcSignature === receipt.pqcSignature,
    );
  } catch (err) {
    return fail(`could not read anchors for layer "${receipt.layerId}": ${(err as Error).message}`);
  }
  if (!matched) {
    return fail("no anchor on chain matches this receipt — it is fabricated or superseded");
  }
  const mismatch = anchorFieldMismatch(receipt, matched);
  if (mismatch) {
    return { ...fail(mismatch), anchor: matched };
  }
  checks.anchorOnChain = true;
  const failAt = (reason: string): ReceiptVerification => ({ ...fail(reason), anchor: matched });

  // 4. The signing key is resolved from the chain, never taken from the receipt.
  let publicKeyHex = "";
  try {
    const account = await rest.getPqcAccount(rollup.creator);
    publicKeyHex = account.publicKey;
  } catch (err) {
    return failAt(`could not resolve the creator's post-quantum key: ${(err as Error).message}`);
  }
  if (receipt.creator !== rollup.creator) {
    return failAt(
      `receipt names creator "${receipt.creator}" but the chain says the rollup's creator is "${rollup.creator}"`,
    );
  }
  checks.creatorAuthority = publicKeyHex !== "";
  if (!checks.creatorAuthority) {
    return failAt(`no post-quantum key is registered for creator ${rollup.creator}`);
  }

  // 5. The receipt must name the chain we actually queried. A version-1 receipt
  // carries no chain id; it still verifies, because step 3 already required the
  // anchor to exist on *this* chain, but the binding is the chain read rather
  // than the receipt's own word.
  const chainId = options.client.network.chainId;
  if (receipt.chainId && receipt.chainId !== chainId) {
    return failAt(
      `receipt is for chain "${receipt.chainId}" but this client is connected to "${chainId}" — ` +
        "verify it against a node for its own network",
    );
  }
  checks.chainBinding = true;

  // 6. Finally the post-quantum signature, over the form the chain had in force
  // at the height this anchor was recorded at.
  const version = anchorSignBytesVersionFor(
    matched.mainChainHeight,
    options.client.network.anchorSignV2Height,
  );
  checks.pqcSignature = signatureOver(matched, publicKeyHex, chainId, version);
  return checks.pqcSignature
    ? {
        valid: true,
        mode: "chain",
        checks,
        signBytesVersion: version,
        anchor: matched,
        verifiedReceipt: receiptFromParts(
          receipt.rollupId,
          rollup.layerId,
          receipt.batchIndex,
          rollup.creator,
          matched,
          receipt.batchStateRoot,
          chainId,
        ),
      }
    : {
        valid: false,
        mode: "chain",
        checks,
        signBytesVersion: version,
        anchor: matched,
        reason:
          `Dilithium-5 anchor signature did not verify against the creator's registered key ` +
          `(checked as ${version}, for an anchor at height ${matched.mainChainHeight})`,
      };
}
