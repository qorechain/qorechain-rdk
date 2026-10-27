//! `RdkTxClient` -- builds Cosmos SIGN_MODE_DIRECT transactions for the `rdk`
//! messages and broadcasts them over the REST `/cosmos/tx/v1beta1/txs` endpoint
//! in `BROADCAST_MODE_SYNC`.
//!
//! Two signing paths:
//!
//! - **Hybrid (post-quantum)** -- give the client an ML-DSA-87 keypair
//!   ([`HybridSigningOptions::pqc_keypair`]). Every transaction is then built
//!   with the QoreChain SDK's hybrid builder: the classical secp256k1 signature
//!   plus an ML-DSA-87 signature carried as a tx-body extension. This is what
//!   both public networks require on the native lane.
//! - **Classical** -- without a PQC keypair, each `rdk` message is wrapped as a
//!   `cosmrs::Any`, placed in a `tx::Body`, and signed together with an
//!   `AuthInfo` (a single `SignerInfo` plus a `Fee`). The body and auth-info
//!   bytes, the chain id, and the account number form the sign-doc bytes, which
//!   are signed and packed into a tx-raw envelope, base64-encoded, and posted.
//!   The public networks refuse such a transaction.

use cosmrs::crypto::secp256k1::SigningKey;
use cosmrs::tx::{AuthInfo, Body, Fee, SignerInfo};
use cosmrs::{Coin, Denom};
use prost::Message;
use serde_json::{json, Value};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::Instant;
use thiserror::Error;

pub use qorechain::pqc::PqcKeypair;
pub use qorechain::signbytes::{SignBytesMode, SignBytesVersion};
pub use qorechain::tx::BuiltTx as BuiltHybridTx;

use qorechain::signbytes::{
    is_hybrid_sign_bytes_rejection_response, is_legacy_sign_bytes_chain, sign_bytes_version_for,
    DEFAULT_SIGN_BYTES_CACHE_TTL, SIGN_BYTES_V2_UPGRADES,
};
use qorechain::tx::{build_hybrid_tx, BuildHybridTxParams, Coin as SdkCoin, Fee as SdkFee};

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

use crate::accounts::{ResolvedPqcKeypair, Signer};
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
    /// The chain would refuse this transaction — caught before any fee is
    /// paid, because the chain only checks it after.
    #[error("{0}")]
    WouldBeRefused(String),
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

/// Post-quantum signing configuration. Supplying [`pqc_keypair`] switches the
/// client to the hybrid path; everything else is optional tuning.
///
/// [`pqc_keypair`]: HybridSigningOptions::pqc_keypair
#[derive(Clone, Default)]
pub struct HybridSigningOptions {
    /// The ML-DSA-87 (Dilithium-5) keypair providing the post-quantum half of
    /// the signature. When present, every transaction the client signs is
    /// signed hybrid.
    ///
    /// The key is expected to already be registered on chain (via
    /// `MsgRegisterPQCKey`) unless [`include_pqc_public_key`] is set.
    ///
    /// [`include_pqc_public_key`]: HybridSigningOptions::include_pqc_public_key
    pub pqc_keypair: Option<PqcKeypair>,
    /// Which hybrid sign-bytes form to sign. `Auto` (the default) asks the
    /// network over the client's REST endpoint whether the v2 upgrade is
    /// applied; `V1` / `V2` force a form -- useful when a network's upgrade
    /// plan name differs from what `Auto` looks up.
    pub sign_bytes_version: SignBytesMode,
    /// Embed the ML-DSA-87 public key in the extension so the chain can
    /// register it on first use. Defaults to `false`.
    pub include_pqc_public_key: bool,
}

impl std::fmt::Debug for HybridSigningOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print the secret key.
        f.debug_struct("HybridSigningOptions")
            .field("pqc_keypair", &self.pqc_keypair.as_ref().map(|_| "<set>"))
            .field("sign_bytes_version", &self.sign_bytes_version)
            .field("include_pqc_public_key", &self.include_pqc_public_key)
            .finish()
    }
}

impl From<ResolvedPqcKeypair> for HybridSigningOptions {
    /// The keypair found by [`crate::accounts::resolve_pqc_keypair`] /
    /// [`crate::accounts::pqc_keypair_from_env`], embedding the public key
    /// exactly when the account has none registered yet.
    fn from(resolved: ResolvedPqcKeypair) -> Self {
        HybridSigningOptions {
            pqc_keypair: Some(resolved.keypair),
            sign_bytes_version: SignBytesMode::Auto,
            include_pqc_public_key: resolved.include_pqc_public_key,
        }
    }
}

/// Resolved hybrid configuration held by a client that signs post-quantum.
struct HybridConfig {
    private_key: [u8; 32],
    pqc_keypair: PqcKeypair,
    sign_bytes: SignBytesMode,
    include_pqc_public_key: bool,
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
    hybrid: Option<HybridConfig>,
    sign_bytes_cache: Mutex<Option<(SignBytesVersion, Instant)>>,
}

impl<S: Signer> RdkTxClient<S> {
    /// Build a classical-only tx client. The `account_number`/`sequence` should
    /// reflect the signer's on-chain account state.
    ///
    /// Both public networks refuse a classical-only native-lane transaction;
    /// use [`RdkTxClient::new_with_options`] with a PQC keypair to sign hybrid.
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
            hybrid: None,
            sign_bytes_cache: Mutex::new(None),
        }
    }

    /// Build a tx client with hybrid (post-quantum) signing options. With
    /// `options.pqc_keypair` set, every transaction is signed hybrid; without
    /// it this is [`RdkTxClient::new`].
    ///
    /// Fails fast when the signer cannot sign hybrid (it does not expose its
    /// private key) or the keypair is not an ML-DSA-87 keypair.
    pub fn new_with_options(
        signer: S,
        rest: RestClient,
        chain_id: impl Into<String>,
        account_number: u64,
        sequence: u64,
        options: HybridSigningOptions,
    ) -> Result<Self, TxError> {
        Self::new(signer, rest, chain_id, account_number, sequence).with_hybrid(options)
    }

    /// Switch this client to hybrid (post-quantum) signing (see
    /// [`RdkTxClient::new_with_options`]). Options without a keypair leave the
    /// client classical.
    pub fn with_hybrid(mut self, options: HybridSigningOptions) -> Result<Self, TxError> {
        let Some(pqc_keypair) = options.pqc_keypair else {
            self.hybrid = None;
            return Ok(self);
        };
        let private_key = self.signer.private_key_bytes().ok_or_else(|| {
            TxError::Build(
                "hybrid (post-quantum) signing needs the signer's raw secp256k1 private key, \
                 and this signer does not expose one; use a NativeAccount"
                    .to_string(),
            )
        })?;
        if !qorechain::pqc::is_valid_pqc_secret_key_len(&pqc_keypair.secret_key)
            || !qorechain::pqc::is_valid_pqc_public_key_len(&pqc_keypair.public_key)
        {
            return Err(TxError::Build(
                "the PQC keypair is not an ML-DSA-87 (Dilithium-5) keypair".to_string(),
            ));
        }
        self.hybrid = Some(HybridConfig {
            private_key,
            pqc_keypair,
            sign_bytes: options.sign_bytes_version,
            include_pqc_public_key: options.include_pqc_public_key,
        });
        Ok(self)
    }

    /// Whether this client signs hybrid (post-quantum) transactions.
    pub fn is_hybrid(&self) -> bool {
        self.hybrid.is_some()
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
    ///
    /// A hybrid client signs it hybrid; with `SignBytesMode::Auto` on a network
    /// whose sign-bytes form depends on an upgrade, that asks the node which
    /// form it verifies.
    pub fn build_signed_tx<M: super::codecs::RdkMsg>(
        &self,
        msg: &M,
        opts: &TxOptions,
    ) -> Result<String, TxError> {
        let bytes = match &self.hybrid {
            Some(hybrid) => {
                let version = self.resolve_sign_bytes_version_with(hybrid.sign_bytes, false)?;
                self.sign_hybrid(hybrid, msg, opts, version)?.tx_raw_bytes
            }
            None => self.sign(to_any_message(msg), opts)?,
        };
        Ok(base64_encode(&bytes))
    }

    /// Build a signed hybrid transaction framed with the given sign-bytes
    /// `version`, without broadcasting or any network call. The result carries
    /// the `TxRaw` bytes and the exact bytes the ML-DSA-87 signature covers.
    ///
    /// Fails if this client has no PQC keypair.
    pub fn build_hybrid_tx<M: super::codecs::RdkMsg>(
        &self,
        msg: &M,
        opts: &TxOptions,
        version: SignBytesVersion,
    ) -> Result<BuiltHybridTx, TxError> {
        let hybrid = self.hybrid.as_ref().ok_or_else(|| {
            TxError::Build("this client has no PQC keypair, so it signs classical-only".to_string())
        })?;
        self.sign_hybrid(hybrid, msg, opts, version)
    }

    /// The hybrid sign-bytes form this client signs: the forced `V1` / `V2`, or
    /// for `Auto` the form the network verifies (asked over REST, cached for a
    /// minute). A classical client resolves `Auto` the same way.
    pub fn resolve_sign_bytes_version(&self) -> Result<SignBytesVersion, TxError> {
        let mode = self
            .hybrid
            .as_ref()
            .map(|h| h.sign_bytes)
            .unwrap_or_default();
        self.resolve_sign_bytes_version_with(mode, false)
    }

    /// Estimate gas for a message without broadcasting -- the basis for a dry
    /// run. Builds and signs the transaction (so an invalid message is caught)
    /// and returns the gas limit from `opts` as the estimate. Never touches the
    /// network.
    pub fn simulate<M: super::codecs::RdkMsg>(
        &self,
        msg: &M,
        opts: &TxOptions,
    ) -> Result<u64, TxError> {
        // Build and sign to validate the message, but do not broadcast.
        match &self.hybrid {
            Some(hybrid) => {
                // The form does not change whether the transaction builds, so a
                // dry run does not ask the network for it.
                let version = hybrid.sign_bytes.fixed().unwrap_or(SignBytesVersion::V2);
                let _ = self.sign_hybrid(hybrid, msg, opts, version)?;
            }
            None => {
                let _ = self.build_signed_tx(msg, opts)?;
            }
        }
        Ok(opts.gas_limit)
    }

    /// Resolve `mode` for this client's chain. `refresh` bypasses the cache.
    fn resolve_sign_bytes_version_with(
        &self,
        mode: SignBytesMode,
        refresh: bool,
    ) -> Result<SignBytesVersion, TxError> {
        if let Some(version) = mode.fixed() {
            return Ok(version);
        }
        if !is_legacy_sign_bytes_chain(&self.chain_id) {
            return Ok(SignBytesVersion::V2);
        }
        let mut cache = self
            .sign_bytes_cache
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if !refresh {
            if let Some((version, at)) = *cache {
                if at.elapsed() < DEFAULT_SIGN_BYTES_CACHE_TTL {
                    return Ok(version);
                }
            }
        }
        let mut height = 0;
        for plan in SIGN_BYTES_V2_UPGRADES {
            height = self.rest.get_applied_plan_height(plan).map_err(|e| {
                TxError::Build(format!(
                    "cannot ask the node whether upgrade {plan} is applied ({e}); pass an \
                     explicit sign-bytes version (v1 or v2)"
                ))
            })?;
            if height > 0 {
                break;
            }
        }
        let version = sign_bytes_version_for(&self.chain_id, height);
        *cache = Some((version, Instant::now()));
        Ok(version)
    }

    /// Build the hybrid transaction with the SDK's builder: same messages, fee,
    /// memo, chain id, account number and sequence as the classical path.
    fn sign_hybrid<M: super::codecs::RdkMsg>(
        &self,
        hybrid: &HybridConfig,
        msg: &M,
        opts: &TxOptions,
        version: SignBytesVersion,
    ) -> Result<BuiltHybridTx, TxError> {
        let any = to_any_message(msg);
        build_hybrid_tx(BuildHybridTxParams {
            private_key: hybrid.private_key.to_vec(),
            public_key: self.signer.public_key().to_bytes(),
            pqc_secret_key: hybrid.pqc_keypair.secret_key.clone(),
            pqc_public_key: hybrid.pqc_keypair.public_key.clone(),
            messages: vec![qorechain::tx::Message {
                type_url: any.type_url,
                value: any.value,
            }],
            fee: SdkFee {
                amount: vec![SdkCoin {
                    denom: BASE_DENOM.to_string(),
                    amount: opts.fee_amount_uqor.to_string(),
                }],
                gas: opts.gas_limit.to_string(),
                granter: String::new(),
                payer: String::new(),
            },
            chain_id: self.chain_id.clone(),
            account_number: self.account_number,
            sequence: self.sequence,
            memo: opts.memo.clone(),
            timeout_height: 0,
            include_pqc_public_key: hybrid.include_pqc_public_key,
            sign_bytes_version: Some(version),
        })
        .map_err(|e| TxError::Build(e.to_string()))
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
        let Some(hybrid) = &self.hybrid else {
            let tx_b64 = self.build_signed_tx(msg, opts)?;
            return self.post_tx(tx_b64);
        };
        let version = self.resolve_sign_bytes_version_with(hybrid.sign_bytes, false)?;
        let tx = self.sign_hybrid(hybrid, msg, opts, version)?;
        let resp = self.post_tx(base64_encode(&tx.tx_raw_bytes))?;
        // With `Auto`, a refusal of the hybrid signature can mean the network
        // switched form since it was asked: ask again and re-sign, once.
        if hybrid.sign_bytes != SignBytesMode::Auto
            || !is_hybrid_sign_bytes_rejection_response(&resp)
        {
            return Ok(resp);
        }
        let version = self.resolve_sign_bytes_version_with(hybrid.sign_bytes, true)?;
        let tx = self.sign_hybrid(hybrid, msg, opts, version)?;
        self.post_tx(base64_encode(&tx.tx_raw_bytes))
    }

    fn post_tx(&self, tx_b64: String) -> Result<Value, TxError> {
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
        // The chain enforces the id grammar at creation from v3.2.2 — after the
        // creation fee is paid.
        if let Some(e) = crate::rules::rollup_id_error(&input.rollup_id) {
            return Err(TxError::WouldBeRefused(format!(
                "rollupId \"{}\" {e}",
                input.rollup_id
            )));
        }
        self.broadcast(&input.to_msg(), opts)
    }

    /// Submit a settlement batch. The client's address is the sequencer.
    pub fn submit_batch(
        &self,
        mut input: SubmitBatchInput,
        opts: &TxOptions,
    ) -> Result<Value, TxError> {
        input.sequencer = self.address().to_string();
        // From chain v3.2.5 the chain refuses a malformed withdrawals root
        // after the fee is paid.
        if let Some(e) = crate::rules::withdrawals_root_error(&input.withdrawals_root) {
            return Err(TxError::WouldBeRefused(format!(
                "cannot submit batch {}: {e}",
                input.batch_index
            )));
        }
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
    ///
    /// Once the chain reports `rdk-challenge-settlement` (v3.2.5), a rollup
    /// whose latest batch is still submitted or challenged is refused here,
    /// before the fee is paid.
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
        // From chain v3.2.5 a rollup with an unsettled latest batch cannot be
        // stopped; check before paying the fee.
        if self
            .rest
            .is_protocol_feature_enabled(crate::transition::FEATURE_RDK_CHALLENGE_SETTLEMENT)?
        {
            // An error here is a rollup with no batch yet.
            let latest = self.rest.get_latest_batch(&input.rollup_id).ok();
            let status = latest.as_ref().map(|b| b.status.as_str());
            if let Some(e) = crate::rules::stop_rollup_error(status) {
                return Err(TxError::WouldBeRefused(format!(
                    "cannot stop rollup \"{}\": {e}",
                    input.rollup_id
                )));
            }
        }
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
        let msg = input.to_msg();
        // The chain refuses these at the start of ExecuteWithdrawal (v3.2.3+) —
        // after the fee is paid.
        let errors = crate::rules::withdrawal_errors(
            &msg.submitter,
            &msg.rollup_id,
            &msg.recipient,
            &msg.denom,
            msg.amount,
            &msg.proof,
        );
        if !errors.is_empty() {
            return Err(TxError::WouldBeRefused(format!(
                "withdrawal would be refused by the chain: {}",
                errors.join("; ")
            )));
        }
        self.broadcast(&msg, opts)
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
