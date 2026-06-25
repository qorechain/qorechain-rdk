package rdk

import (
	"crypto/sha256"
	"fmt"
)

// DACelestiaUnavailableMessage is shown when a not-yet-active DA backend is
// selected for live use.
const DACelestiaUnavailableMessage = "Celestia data availability is selectable but not yet active on the QoreChain " +
	"network. Use the 'native' backend, or wait until Celestia is enabled."

// DaBlob is a prepared native DA blob and the commitment to place in a batch.
type DaBlob struct {
	// Data is the blob bytes.
	Data []byte
	// DataHash is the SHA-256 of the blob, 0x-prefixed, for the batch data_hash.
	DataHash string
	// Size is the blob size in bytes.
	Size int
}

// BuildDaBlob assembles a native DA blob from raw data, enforcing the maximum
// blob size, and computes its data_hash. A maxBlobSize <= 0 defaults to the
// documented limit. It errors if the blob exceeds the maximum.
func BuildDaBlob(data []byte, maxBlobSize int) (DaBlob, error) {
	if maxBlobSize <= 0 {
		maxBlobSize = DefaultMaxDaBlobSize
	}
	if len(data) > maxBlobSize {
		return DaBlob{}, fmt.Errorf("DA blob is %d bytes, exceeding the maximum of %d bytes", len(data), maxBlobSize)
	}
	sum := sha256.Sum256(data)
	return DaBlob{Data: data, DataHash: "0x" + BytesToHex(sum[:]), Size: len(data)}, nil
}

// IsDaBackendAvailable reports whether a DA backend is currently active on the
// network.
func IsDaBackendAvailable(da DABackend) bool {
	return da == DANative
}

// AssertDaBackendAvailable returns a clear, user-facing error if a DA backend
// that the network does not yet serve (Celestia, or "both") is about to be used
// for live submission.
func AssertDaBackendAvailable(da DABackend) error {
	if !IsDaBackendAvailable(da) {
		return fmt.Errorf("%s", DACelestiaUnavailableMessage)
	}
	return nil
}
