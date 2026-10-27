/**
 * Native data-availability helpers.
 *
 * A settlement batch can commit to its data via the batch's `data_hash`. On
 * QoreChain no transaction posts a blob to the native DA store yet, so on a
 * `native` or `both` rollup the chain refuses a batch whose `data_hash` claims
 * one: leave it empty there (see `dataHashError`). This module assembles a blob
 * (enforcing the size limit) and computes the commitment the chain's blob
 * store uses, SHAKE-256 (32 bytes); releases before 0.7.0 used SHA-256. Read the live `max_da_blob_size` from
 * `rdk.params()`; the default here is reference only.
 */
import { qorehash } from "../utils/qorehash";
import { DEFAULT_RDK_PARAMS } from "../constants";
import type { DABackend } from "../config/enums";
import { bytesToHex, toBytes } from "../utils/bytes";

/** Message shown when a not-yet-active DA backend is selected for live use. */
export const DA_CELESTIA_UNAVAILABLE_MESSAGE =
  "Celestia data availability is selectable but not yet active on the QoreChain " +
  "network. Use the 'native' backend, or wait until Celestia is enabled.";

/** A prepared DA blob and the chain's SHAKE-256 commitment to it (not for a native batch's `data_hash` yet). */
export interface DaBlob {
  /** The blob bytes. */
  data: Uint8Array;
  /** The chain's commitment to the blob: SHAKE-256, 32 bytes, `0x`-prefixed. */
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
  return { data, dataHash: `0x${bytesToHex(qorehash(data))}`, size: data.length };
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
