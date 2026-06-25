/**
 * Native data-availability helpers.
 *
 * On QoreChain, a settlement batch commits to its data via the batch's
 * `data_hash`; the native DA backend stores the corresponding blob on-chain.
 * This module assembles a blob (enforcing the size limit) and computes the
 * `data_hash` to put in the batch. Read the live `max_da_blob_size` from
 * `rdk.params()`; the default here is reference only.
 */
import { sha256 } from "@cosmjs/crypto";
import { DEFAULT_RDK_PARAMS } from "../constants";
import type { DABackend } from "../config/enums";
import { bytesToHex, toBytes } from "../utils/bytes";

/** Message shown when a not-yet-active DA backend is selected for live use. */
export const DA_CELESTIA_UNAVAILABLE_MESSAGE =
  "Celestia data availability is selectable but not yet active on the QoreChain " +
  "network. Use the 'native' backend, or wait until Celestia is enabled.";

/** A prepared native DA blob and the commitment to place in a batch. */
export interface DaBlob {
  /** The blob bytes. */
  data: Uint8Array;
  /** SHA-256 of the blob, `0x`-prefixed, for the batch `data_hash`. */
  dataHash: string;
  /** Blob size in bytes. */
  size: number;
}

/**
 * Assemble a native DA blob from raw data, enforcing the maximum blob size, and
 * compute its `data_hash`.
 *
 * @throws if the blob exceeds `maxBlobSize` (defaults to the documented limit).
 */
export function buildDaBlob(input: { data: string | Uint8Array; maxBlobSize?: number }): DaBlob {
  const data = toBytes(input.data);
  const maxBlobSize = input.maxBlobSize ?? DEFAULT_RDK_PARAMS.maxDaBlobSize;
  if (data.length > maxBlobSize) {
    throw new Error(
      `DA blob is ${data.length} bytes, exceeding the maximum of ${maxBlobSize} bytes`,
    );
  }
  return { data, dataHash: `0x${bytesToHex(sha256(data))}`, size: data.length };
}

/** Whether a DA backend is currently active on the network. */
export function isDaBackendAvailable(da: DABackend): boolean {
  return da === "native";
}

/**
 * Throw a clear, user-facing error if a DA backend that the network does not
 * yet serve (Celestia, or `both`) is about to be used for live submission.
 */
export function assertDaBackendAvailable(da: DABackend): void {
  if (!isDaBackendAvailable(da)) {
    throw new Error(DA_CELESTIA_UNAVAILABLE_MESSAGE);
  }
}
