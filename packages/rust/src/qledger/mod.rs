//! The qledger-v1 execution model of optimistic rollups (chain v3.2.8+):
//! account keys and transactions, the state tree, execution, withdrawals,
//! fraud proofs and the batch admission rules, byte-compatible with the chain.
//!
//! Signatures are ML-DSA-44 with the FIPS 204 context `"qledger/v1"`:
//! [`QledgerTx::sign`] signs deterministically and [`MLDSA44_VERIFIER`] is the
//! built-in verifier to pass to execution, fraud-proof checks and batch
//! planning, which take any [`QledgerVerifier`].

use thiserror::Error;

use crate::client::rest::RestError;

pub mod batch;
pub mod exec;
pub mod fraud;
pub mod smt;
pub mod tx;

pub use batch::{
    choose_qledger_batch_end, fetch_qledger_entries, is_qledger_checkpoint, plan_qledger_batch,
    qledger_accumulate, qledger_batch_errors, QledgerBatchFacts, QledgerBatchPlan,
    QledgerFetchInput, QledgerPlanInput, QLEDGER_CHECKPOINT_INTERVAL, QLEDGER_FRESH_POST_BLOCKS,
    QLEDGER_MAX_PENDING_BATCHES_PER_SUBMITTER, QLEDGER_SLASH_BURN_PERCENT,
};
pub use exec::{
    execute_qledger, is_canonical_qor_address, qledger_withdrawal_counter_id,
    qledger_withdrawal_leaf, qledger_withdrawal_proof, qledger_withdrawals_root, QledgerEntry,
    QledgerEnv, QledgerResult, QledgerWithdrawal, QLEDGER_WITHDRAWAL_DENOM,
};
pub use fraud::{
    build_qledger_fraud_proof, check_qledger_fraud, decode_qledger_fraud_proof,
    encode_qledger_fraud_proof, QledgerClaim, QledgerFraudProof, QLEDGER_MAX_BATCH_ENTRIES,
    QLEDGER_MAX_POST_BYTES,
};
pub use smt::{
    qledger_empty_hash, qledger_empty_root, qledger_leaf_hash, QledgerLedger, QledgerPartialTree,
    QledgerState, QledgerWitness, QLEDGER_DEPTH,
};
pub use tx::{
    decode_qledger_deposit, decode_qledger_tx, encode_qledger_deposit, encode_qledger_tx,
    qledger_account_id, qledger_keypair_from_seed, qledger_signing_message, qledger_tx_unsigned,
    verify_qledger_tx, Mldsa44Verifier, QledgerKeypair, QledgerTx, QledgerVerifier,
    MLDSA44_VERIFIER, QLEDGER_DEPOSIT_POSTER_PREFIX, QLEDGER_KIND_TRANSFER, QLEDGER_KIND_WITHDRAW,
    QLEDGER_MAX_RECIPIENT_LEN, QLEDGER_MLDSA44_PUBLIC_KEY_SIZE, QLEDGER_MLDSA44_SIGNATURE_SIZE,
    QLEDGER_SCHEME_MLDSA44, QLEDGER_SIGNING_CONTEXT,
};

/// A qledger-v1 error.
#[derive(Debug, Clone, Error)]
pub enum QledgerError {
    /// An argument was not usable.
    #[error("qledger: {0}")]
    InvalidInput(String),
    /// Execution touched an account a partial tree does not hold.
    #[error("qledger: the witness does not open an account the batch touches")]
    IncompleteWitness,
    /// A witness does not match the state root, or two witnesses disagree.
    #[error("qledger: witness does not match the state root")]
    BadWitness,
    /// A fraud proof could not be decoded.
    #[error("qledger: malformed fraud proof")]
    MalformedFraudProof,
    /// A fraud proof is not about the batch it was checked against.
    #[error("qledger: the fraud proof does not apply: {0}")]
    NotApplicable(String),
    /// Inbox entries could not be read back or did not match the chain.
    #[error("qledger: {0}")]
    Fetch(String),
    /// The chain would not admit a batch now.
    #[error("{0}")]
    Refused(String),
    /// A REST call failed.
    #[error(transparent)]
    Rest(#[from] RestError),
}
