//! Transaction layer: protobuf codecs for the `rdk` messages, friendly
//! input builders, the rollup/batch lifecycle state machine, and a signing
//! client that builds hybrid (post-quantum) or classical SIGN_MODE_DIRECT
//! transactions and broadcasts them over REST.

pub mod client;
pub mod codecs;
pub mod lifecycle;
pub mod messages;
pub mod mock;

pub use client::{
    BuiltHybridTx, HybridSigningOptions, PqcKeypair, RdkTxClient, SignBytesMode, SignBytesVersion,
    TxError, TxOptions, PQC_ALREADY_REGISTERED_CODE, PQC_REGISTRATION_FEE_UQOR,
    PQC_REGISTRATION_GAS_LIMIT, PQC_REGISTRATION_TYPE_URLS,
};
pub use codecs::{
    MsgBondRollupSubmitter, MsgBondRollupSubmitterResponse, MsgChallengeBatch, MsgCreateRollup,
    MsgDepositToRollup, MsgDepositToRollupResponse, MsgExecuteWithdrawal, MsgPauseRollup,
    MsgPostRollupData, MsgPostRollupDataResponse, MsgRegisterKemKey, MsgResolveChallenge,
    MsgResumeRollup, MsgSetRollupMembers, MsgSetRollupMembersResponse, MsgSetRollupSequencing,
    MsgSetVerificationKey, MsgStopRollup, MsgSubmitBatch, MsgUnbondRollupSubmitter,
    MsgUnbondRollupSubmitterResponse, MsgUpdateVerificationKey, RdkMsg, PQC_TYPE_URL_PREFIX,
    TYPE_URL_PREFIX,
};
pub use lifecycle::{
    assert_rollup_action, batch_transitions, can_perform_rollup_action, challenge_window_deadline,
    is_batch_final, is_challenge_window_closed, LifecycleError, RollupAction,
};
pub use messages::{
    to_any, BondRollupSubmitterInput, ChallengeBatchInput, CreateRollupInput, DepositToRollupInput,
    ExecuteWithdrawalInput, PauseRollupInput, PostRollupDataInput, RegisterKemKeyInput,
    ResolveChallengeInput, RollupRefInput, SetRollupMembersInput, SetRollupSequencingInput,
    SetVerificationKeyInput, SubmitBatchInput, UnbondRollupSubmitterInput,
    UpdateVerificationKeyInput, ML_KEM_1024_ALGORITHM_ID,
};
pub use mock::{MockCall, MockTxClient, DEFAULT_MOCK_GAS_ESTIMATE, MOCK_TX_HASH};
