//! `RdkTxClient` -- builds Cosmos SIGN_MODE_DIRECT transactions for the `rdk`
//! messages and broadcasts them over the REST `/cosmos/tx/v1beta1/txs` endpoint
//! in `BROADCAST_MODE_SYNC`.
//!
//! Each `rdk` message is wrapped as a `cosmrs::Any`, placed in a `tx::Body`, and
//! signed together with an `AuthInfo` (a single `SignerInfo` plus a `Fee`). The
//! body and auth-info bytes, the chain id, and the account number form the
//! sign-doc bytes, which are signed and packed into a tx-raw envelope,
//! base64-encoded, and posted.

use cosmrs::crypto::secp256k1::SigningKey;
use cosmrs::tx::{AuthInfo, Body, Fee, SignerInfo};
use cosmrs::{Coin, Denom};
use prost::Message;
use serde_json::{json, Value};
use std::str::FromStr;
use thiserror::Error;

/// The `cosmos.tx.v1beta1.SignDoc` proto (encoded locally to avoid pulling in a
/// consensus-engine type for the chain id).
#[derive(Clone, PartialEq, Message)]
struct SignDocProto {
    #[prost(bytes = "vec", tag = "1")]
    body_bytes: Vec<u8>,
    #[prost(bytes = "vec", tag = "2")]
    auth_info_bytes: Vec<u8>,
    #[prost(string, tag = "3")]
    chain_id: String,
    #[prost(uint64, tag = "4")]
    account_number: u64,
}

/// The `cosmos.tx.v1beta1.TxRaw` envelope.
#[derive(Clone, PartialEq, Message)]
struct TxRawProto {
    #[prost(bytes = "vec", tag = "1")]
    body_bytes: Vec<u8>,
    #[prost(bytes = "vec", tag = "2")]
    auth_info_bytes: Vec<u8>,
    #[prost(bytes = "vec", repeated, tag = "3")]
    signatures: Vec<Vec<u8>>,
}

use crate::accounts::Signer;
use crate::client::rest::{RestClient, RestError};
use crate::config::RollupStatus;
use crate::constants::BASE_DENOM;

use super::lifecycle::{assert_rollup_action, LifecycleError, RollupAction};
use super::messages::{
    to_any, ChallengeBatchInput, CreateRollupInput, ExecuteWithdrawalInput, PauseRollupInput,
    ResolveChallengeInput, RollupRefInput, SubmitBatchInput,
};

/// A transaction-build or broadcast error.
#[derive(Debug, Error)]
pub enum TxError {
    /// A lifecycle guard rejected the action.
    #[error(transparent)]
    Lifecycle(#[from] LifecycleError),
    /// Building or signing the transaction failed.
    #[error("transaction build failed: {0}")]
    Build(String),
    /// The REST broadcast failed.
    #[error(transparent)]
    Rest(#[from] RestError),
}

/// Per-transaction options: the fee and an optional memo. The fee defaults to a
/// zero-amount fee with the configured gas limit; set an explicit amount for
/// fee-charging chains.
#[derive(Debug, Clone)]
pub struct TxOptions {
    /// Gas limit.
    pub gas_limit: u64,
    /// Fee amount, in uqor.
    pub fee_amount_uqor: u128,
    /// Optional memo.
    pub memo: String,
}

impl Default for TxOptions {
    fn default() -> Self {
        TxOptions {
            gas_limit: 200_000,
            fee_amount_uqor: 0,
            memo: String::new(),
        }
    }
}

/// A signing transaction client for the `rdk` module.
///
/// Holds the signer, account context (number + sequence), chain id, and a REST
/// client used to broadcast. Read the account number/sequence from the chain
/// (`/cosmos/auth/...`) before signing in production.
pub struct RdkTxClient<S: Signer> {
    signer: S,
    rest: RestClient,
    chain_id: String,
    account_number: u64,
    sequence: u64,
}

impl<S: Signer> RdkTxClient<S> {
    /// Build a tx client. The `account_number`/`sequence` should reflect the
    /// signer's on-chain account state.
    pub fn new(
        signer: S,
        rest: RestClient,
        chain_id: impl Into<String>,
        account_number: u64,
        sequence: u64,
    ) -> Self {
        RdkTxClient {
            signer,
            rest,
            chain_id: chain_id.into(),
            account_number,
            sequence,
        }
    }

    /// The signing/operator address used as the message signer.
    pub fn address(&self) -> &str {
        self.signer.address()
    }

    /// Set the account sequence (call after a successful broadcast to advance).
    pub fn set_sequence(&mut self, sequence: u64) {
        self.sequence = sequence;
    }

    /// Build a signed, base64-encoded transaction from a single `rdk` message,
    /// without broadcasting. Exposed for inspection and testing.
    pub fn build_signed_tx<M: super::codecs::RdkMsg>(
        &self,
        msg: &M,
        opts: &TxOptions,
    ) -> Result<String, TxError> {
        let bytes = self.sign(to_any_message(msg), opts)?;
        Ok(base64_encode(&bytes))
    }

    /// Estimate gas for a message without broadcasting -- the basis for a dry
    /// run. Builds and signs the transaction (so an invalid message is caught)
    /// and returns the gas limit from `opts` as the estimate.
    pub fn simulate<M: super::codecs::RdkMsg>(
        &self,
        msg: &M,
        opts: &TxOptions,
    ) -> Result<u64, TxError> {
        // Build and sign to validate the message, but do not broadcast.
        let _ = self.build_signed_tx(msg, opts)?;
        Ok(opts.gas_limit)
    }

    /// Build the body/auth-info bytes, sign the sign-doc, and return the encoded
    /// `TxRaw` bytes (SIGN_MODE_DIRECT).
    fn sign(&self, any: cosmrs::Any, opts: &TxOptions) -> Result<Vec<u8>, TxError> {
        let body = Body::new(vec![any], opts.memo.clone(), 0u32);
        let signer_info = SignerInfo::single_direct(Some(self.signer.public_key()), self.sequence);
        let denom = Denom::from_str(BASE_DENOM).map_err(|e| TxError::Build(e.to_string()))?;
        let fee = Fee::from_amount_and_gas(
            Coin {
                denom,
                amount: opts.fee_amount_uqor,
            },
            opts.gas_limit,
        );
        let auth_info: AuthInfo = signer_info.auth_info(fee);

        let body_bytes = body
            .into_bytes()
            .map_err(|e| TxError::Build(e.to_string()))?;
        let auth_info_bytes = auth_info
            .into_bytes()
            .map_err(|e| TxError::Build(e.to_string()))?;

        let sign_doc = SignDocProto {
            body_bytes: body_bytes.clone(),
            auth_info_bytes: auth_info_bytes.clone(),
            chain_id: self.chain_id.clone(),
            account_number: self.account_number,
        };
        let sign_doc_bytes = sign_doc.encode_to_vec();
        let signature = self
            .signing_key()
            .sign(&sign_doc_bytes)
            .map_err(|e| TxError::Build(e.to_string()))?;

        let tx_raw = TxRawProto {
            body_bytes,
            auth_info_bytes,
            signatures: vec![signature.to_vec()],
        };
        Ok(tx_raw.encode_to_vec())
    }

    fn signing_key(&self) -> &SigningKey {
        self.signer.signing_key()
    }

    fn broadcast<M: super::codecs::RdkMsg>(
        &self,
        msg: &M,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        let tx_b64 = self.build_signed_tx(msg, opts)?;
        let body = json!({ "tx_bytes": tx_b64, "mode": "BROADCAST_MODE_SYNC" });
        let resp = self
            .rest
            .post_json("/cosmos/tx/v1beta1/txs", body.to_string())?;
        Ok(resp)
    }

    /// Create a rollup. The client's address is the creator.
    pub fn create_rollup(
        &self,
        rollup_id: impl Into<String>,
        profile: impl Into<String>,
        vm_type: impl Into<String>,
        stake_amount: i64,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        let input = CreateRollupInput {
            creator: self.address().to_string(),
            rollup_id: rollup_id.into(),
            profile: profile.into(),
            vm_type: vm_type.into(),
            stake_amount,
        };
        self.broadcast(&input.to_msg(), opts)
    }

    /// Submit a settlement batch. The client's address is the sequencer.
    pub fn submit_batch(
        &self,
        mut input: SubmitBatchInput,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        input.sequencer = self.address().to_string();
        self.broadcast(&input.to_msg(), opts)
    }

    /// Challenge an optimistic batch with a fraud proof.
    pub fn challenge_batch(
        &self,
        mut input: ChallengeBatchInput,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        input.challenger = self.address().to_string();
        self.broadcast(&input.to_msg(), opts)
    }

    /// Resolve an open challenge (upheld or dismissed).
    pub fn resolve_challenge(
        &self,
        mut input: ResolveChallengeInput,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        input.resolver = self.address().to_string();
        self.broadcast(&input.to_msg(), opts)
    }

    /// Pause an active rollup. Pass `current_status` to guard the transition.
    pub fn pause_rollup(
        &self,
        rollup_id: impl Into<String>,
        reason: impl Into<String>,
        current_status: Option<RollupStatus>,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        if let Some(status) = current_status {
            assert_rollup_action(RollupAction::Pause, status)?;
        }
        let input = PauseRollupInput {
            creator: self.address().to_string(),
            rollup_id: rollup_id.into(),
            reason: reason.into(),
        };
        self.broadcast(&input.to_msg(), opts)
    }

    /// Resume a paused rollup. Pass `current_status` to guard the transition.
    pub fn resume_rollup(
        &self,
        rollup_id: impl Into<String>,
        current_status: Option<RollupStatus>,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        if let Some(status) = current_status {
            assert_rollup_action(RollupAction::Resume, status)?;
        }
        let input = RollupRefInput {
            creator: self.address().to_string(),
            rollup_id: rollup_id.into(),
        };
        self.broadcast(&input.to_resume_msg(), opts)
    }

    /// Stop a rollup permanently. Pass `current_status` to guard the transition.
    pub fn stop_rollup(
        &self,
        rollup_id: impl Into<String>,
        current_status: Option<RollupStatus>,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        if let Some(status) = current_status {
            assert_rollup_action(RollupAction::Stop, status)?;
        }
        let input = RollupRefInput {
            creator: self.address().to_string(),
            rollup_id: rollup_id.into(),
        };
        self.broadcast(&input.to_stop_msg(), opts)
    }

    /// Execute a finalized-batch withdrawal. The client's address is the
    /// submitter.
    pub fn execute_withdrawal(
        &self,
        mut input: ExecuteWithdrawalInput,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        input.submitter = self.address().to_string();
        self.broadcast(&input.to_msg(), opts)
    }
}

fn to_any_message<M: super::codecs::RdkMsg>(msg: &M) -> cosmrs::Any {
    to_any(msg)
}

/// Standard base64 (RFC 4648) encoder.
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }
}
