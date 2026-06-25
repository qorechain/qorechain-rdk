//! Transaction layer: protobuf codecs for the eight `rdk` messages, friendly
//! input builders, the rollup/batch lifecycle state machine, and a signing
//! client that builds SIGN_MODE_DIRECT transactions and broadcasts them over
//! REST.

pub mod client;
pub mod codecs;
pub mod lifecycle;
pub mod messages;
pub mod mock;

pub use client::{RdkTxClient, TxError, TxOptions};
pub use codecs::{
    MsgChallengeBatch, MsgCreateRollup, MsgExecuteWithdrawal, MsgPauseRollup, MsgResolveChallenge,
    MsgResumeRollup, MsgStopRollup, MsgSubmitBatch, RdkMsg, TYPE_URL_PREFIX,
};
pub use lifecycle::{
    assert_rollup_action, batch_transitions, can_perform_rollup_action, challenge_window_deadline,
    is_batch_final, is_challenge_window_closed, LifecycleError, RollupAction,
};
pub use messages::{
    to_any, ChallengeBatchInput, CreateRollupInput, ExecuteWithdrawalInput, PauseRollupInput,
    ResolveChallengeInput, RollupRefInput, SubmitBatchInput,
};
pub use mock::{MockCall, MockTxClient, DEFAULT_MOCK_GAS_ESTIMATE, MOCK_TX_HASH};
