package rdk

import "fmt"

// DACelestiaUnavailableMessage is shown when a not-yet-active DA backend is
// selected for live use.
const DACelestiaUnavailableMessage = "Celestia data availability is selectable but not yet active on the QoreChain " +
	"network. Use the 'native' backend, or wait until Celestia is enabled."

// DaBlob is a prepared DA blob and the commitment the chain's blob store uses,
// SHAKE-256 (32 bytes); releases before 0.7.0 used SHA-256. No transaction
// posts a blob to the native DA store yet, so on a "native" or "both" rollup
// the chain refuses a batch whose data_hash claims one: leave it empty there
// (see DataHashError). Read the live max_da_blob_size from Params; the default
// here is reference only.
type DaBlob struct {
	// Data is the blob bytes.
	Data []byte
	// DataHash is the chain's commitment to the blob: SHAKE-256, 32 bytes,
	// 0x-prefixed.
	DataHash string
	// Size is the blob size in bytes.
	Size int
}

// BuildDaBlob assembles a native DA blob from raw data, enforcing the maximum
// blob size, and computes the chain's commitment to it. A maxBlobSize <= 0
// defaults to the documented limit. It errors if the blob exceeds the maximum.
func BuildDaBlob(data []byte, maxBlobSize int) (DaBlob, error) {
	if maxBlobSize <= 0 {
		maxBlobSize = DefaultMaxDaBlobSize
	}
	if len(data) > maxBlobSize {
		return DaBlob{}, fmt.Errorf("DA blob is %d bytes, exceeding the maximum of %d bytes", len(data), maxBlobSize)
	}
	return DaBlob{Data: data, DataHash: "0x" + BytesToHex(Qorehash(data)), Size: len(data)}, nil
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
