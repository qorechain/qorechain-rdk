//! Native data-availability helpers.
//!
//! A settlement batch can commit to its data via the batch's `data_hash`. On
//! QoreChain no transaction posts a blob to the native DA store yet, so on a
//! `native` or `both` rollup the chain refuses a batch whose `data_hash` claims
//! one: leave it empty there (see `rules::data_hash_error`). This module
//! assembles a blob (enforcing the size limit) and computes the commitment the
//! chain's blob store uses, SHAKE-256 (32 bytes); releases before 0.7.0 used
//! SHA-256. Read the live `max_da_blob_size` from `rdk.params()`; the default
//! here is reference only.

use thiserror::Error;

use crate::config::DaBackend;
use crate::constants::DEFAULT_MAX_DA_BLOB_SIZE;
use crate::utils::bytes::bytes_to_hex;
use crate::utils::qorehash::qorehash;

/// Message shown when a not-yet-active DA backend is selected for live use.
pub const DA_CELESTIA_UNAVAILABLE_MESSAGE: &str =
    "Celestia data availability is selectable but not yet active on the QoreChain \
network. Use the 'native' backend, or wait until Celestia is enabled.";

/// A DA error.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DaError {
    /// The blob exceeds the maximum permitted size.
    #[error("DA blob is {size} bytes, exceeding the maximum of {max} bytes")]
    BlobTooLarge {
        /// The actual blob size in bytes.
        size: usize,
        /// The maximum permitted size in bytes.
        max: usize,
    },
    /// The selected DA backend is not yet active on the network.
    #[error("{0}")]
    BackendUnavailable(String),
}

/// A prepared DA blob and the chain's SHAKE-256 commitment to it (not for a
/// native batch's `data_hash` yet).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DaBlob {
    /// The blob bytes.
    pub data: Vec<u8>,
    /// The chain's commitment to the blob: SHAKE-256, 32 bytes, `0x`-prefixed.
    pub data_hash: String,
    /// Blob size in bytes.
    pub size: usize,
}

/// Assemble a native DA blob from raw data, enforcing the maximum blob size, and
/// compute its `data_hash`.
///
/// `max_blob_size` defaults to the documented limit
/// ([`DEFAULT_MAX_DA_BLOB_SIZE`]) when `None`. Returns
/// [`DaError::BlobTooLarge`] if the blob exceeds the limit.
pub fn build_da_blob(
    data: impl Into<Vec<u8>>,
    max_blob_size: Option<usize>,
) -> Result<DaBlob, DaError> {
    let data = data.into();
    let max = max_blob_size.unwrap_or(DEFAULT_MAX_DA_BLOB_SIZE as usize);
    if data.len() > max {
        return Err(DaError::BlobTooLarge {
            size: data.len(),
            max,
        });
    }
    let data_hash = format!("0x{}", bytes_to_hex(&qorehash(&[&data])));
    let size = data.len();
    Ok(DaBlob {
        data,
        data_hash,
        size,
    })
}

/// Whether a DA backend is currently active on the network.
pub fn is_da_backend_available(da: DaBackend) -> bool {
    da == DaBackend::Native
}

/// Return a clear, user-facing error if a DA backend that the network does not
/// yet serve (Celestia, or `both`) is about to be used for live submission.
pub fn assert_da_backend_available(da: DaBackend) -> Result<(), DaError> {
    if is_da_backend_available(da) {
        Ok(())
    } else {
        Err(DaError::BackendUnavailable(
            DA_CELESTIA_UNAVAILABLE_MESSAGE.to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_blob_with_data_hash() {
        // SHAKE-256("", 32 bytes) = 46b9dd2b...
        let blob = build_da_blob(Vec::new(), None).unwrap();
        assert_eq!(blob.size, 0);
        assert_eq!(
            blob.data_hash,
            "0x46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762f"
        );

        let blob = build_da_blob(b"abc".to_vec(), None).unwrap();
        assert_eq!(blob.size, 3);
        assert_eq!(
            blob.data_hash,
            "0x483366601360a8771c6863080cc4114d8db44530f8f1e1ee4f94ea37e78b5739"
        );
    }

    #[test]
    fn enforces_max_blob_size() {
        let err = build_da_blob(vec![0u8; 5], Some(4)).unwrap_err();
        assert_eq!(err, DaError::BlobTooLarge { size: 5, max: 4 });
        // Exactly at the limit is allowed.
        assert!(build_da_blob(vec![0u8; 4], Some(4)).is_ok());
    }

    #[test]
    fn backend_availability() {
        assert!(is_da_backend_available(DaBackend::Native));
        assert!(!is_da_backend_available(DaBackend::Celestia));
        assert!(!is_da_backend_available(DaBackend::Both));

        assert!(assert_da_backend_available(DaBackend::Native).is_ok());

        let err = assert_da_backend_available(DaBackend::Celestia).unwrap_err();
        assert!(matches!(err, DaError::BackendUnavailable(_)));
        assert!(err.to_string().contains("not yet active"));
        assert!(assert_da_backend_available(DaBackend::Both).is_err());
    }
}
