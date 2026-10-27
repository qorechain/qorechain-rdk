package io.github.qorechain.rdk.da;

import io.github.qorechain.rdk.config.Constants;
import io.github.qorechain.rdk.config.Enums.DABackend;
import io.github.qorechain.rdk.util.Bytes;
import io.github.qorechain.rdk.util.Qorehash;

/**
 * Native data-availability helpers.
 *
 * <p>A settlement batch can commit to its data via the batch's {@code data_hash}. On QoreChain no
 * transaction posts a blob to the native DA store yet, so on a {@code native} or {@code both}
 * rollup the chain refuses a batch whose {@code data_hash} claims one: leave it empty there (see
 * {@code Rules.dataHashError}). This class assembles a blob (enforcing the size limit) and computes
 * the commitment the chain's blob store uses, SHAKE-256 (32 bytes); releases before 0.7.0 used
 * SHA-256. Read the live {@code max_da_blob_size} from {@code rdk.params()}; the default here is
 * reference only.
 */
public final class Da {
    private Da() {}

    /** Message shown when a not-yet-active DA backend is selected for live use. */
    public static final String DA_CELESTIA_UNAVAILABLE_MESSAGE =
            "Celestia data availability is selectable but not yet active on the QoreChain "
                    + "network. Use the 'native' backend, or wait until Celestia is enabled.";

    /**
     * A prepared DA blob and the chain's SHAKE-256 commitment to it (not for a native batch's
     * {@code data_hash} yet).
     */
    public static final class DaBlob {
        /** The blob bytes. */
        public final byte[] data;
        /** The chain's commitment to the blob: SHAKE-256, 32 bytes, {@code 0x}-prefixed. */
        public final String dataHash;
        /** Blob size in bytes. */
        public final int size;

        public DaBlob(byte[] data, String dataHash, int size) {
            this.data = data;
            this.dataHash = dataHash;
            this.size = size;
        }
    }

    /**
     * Assemble a native DA blob from raw data, enforcing the maximum blob size, and compute its
     * {@code data_hash}. A {@code maxBlobSize <= 0} uses the documented limit.
     *
     * @throws IllegalArgumentException if the blob exceeds {@code maxBlobSize}
     */
    public static DaBlob buildDaBlob(byte[] data, int maxBlobSize) {
        byte[] d = data == null ? new byte[0] : data.clone();
        int max = maxBlobSize > 0 ? maxBlobSize : Constants.DEFAULT_MAX_DA_BLOB_SIZE;
        if (d.length > max) {
            throw new IllegalArgumentException(
                    "DA blob is " + d.length + " bytes, exceeding the maximum of " + max + " bytes");
        }
        return new DaBlob(d, "0x" + Bytes.bytesToHex(Qorehash.qorehash(d)), d.length);
    }

    /** {@link #buildDaBlob(byte[], int)} with the documented maximum blob size. */
    public static DaBlob buildDaBlob(byte[] data) {
        return buildDaBlob(data, 0);
    }

    /** Whether a DA backend is currently active on the network. */
    public static boolean isDaBackendAvailable(DABackend da) {
        return da == DABackend.NATIVE;
    }

    /**
     * Throw a clear, user-facing error if a DA backend that the network does not yet serve
     * (Celestia, or {@code both}) is about to be used for live submission.
     */
    public static void assertDaBackendAvailable(DABackend da) {
        if (!isDaBackendAvailable(da)) {
            throw new IllegalStateException(DA_CELESTIA_UNAVAILABLE_MESSAGE);
        }
    }
}
