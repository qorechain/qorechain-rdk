//! Client-side awareness of the rollup and settlement-batch lifecycles, so
//! invalid transitions are caught before a transaction is broadcast.
//!
//! Rollup: `pending -> active -> paused -> stopped` (creator-only
//! pause/resume/stop). Batch: `submitted -> finalized`, with
//! `submitted -> challenged -> rejected` (and `challenged -> finalized` when a
//! challenge is dismissed) on the optimistic path.

use crate::config::{BatchStatus, RollupStatus};
use std::fmt;

/// A creator-initiated rollup lifecycle action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RollupAction {
    /// Pause an active rollup.
    Pause,
    /// Resume a paused rollup.
    Resume,
    /// Stop a rollup permanently.
    Stop,
}

impl RollupAction {
    fn verb(self) -> &'static str {
        match self {
            RollupAction::Pause => "pause",
            RollupAction::Resume => "resume",
            RollupAction::Stop => "stop",
        }
    }

    /// The statuses from which this action is permitted.
    pub fn allowed_from(self) -> &'static [RollupStatus] {
        match self {
            RollupAction::Pause => &[RollupStatus::Active],
            RollupAction::Resume => &[RollupStatus::Paused],
            RollupAction::Stop => &[RollupStatus::Active, RollupStatus::Paused],
        }
    }
}

/// Returned when a rollup lifecycle action is not allowed from the current
/// status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecycleError {
    /// The attempted action.
    pub action: RollupAction,
    /// The status the rollup was in.
    pub status: RollupStatus,
}

impl fmt::Display for LifecycleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let allowed: Vec<&str> = self
            .action
            .allowed_from()
            .iter()
            .map(|s| s.as_str())
            .collect();
        let allowed = if allowed.is_empty() {
            "none".to_string()
        } else {
            allowed.join(", ")
        };
        write!(
            f,
            "cannot {} a rollup in status \"{}\" (allowed from: {})",
            self.action.verb(),
            self.status.as_str(),
            allowed
        )
    }
}

impl std::error::Error for LifecycleError {}

/// Whether a rollup action is allowed from the given status.
pub fn can_perform_rollup_action(action: RollupAction, status: RollupStatus) -> bool {
    action.allowed_from().contains(&status)
}

/// Return a [`LifecycleError`] if a rollup action is not allowed from `status`.
pub fn assert_rollup_action(
    action: RollupAction,
    status: RollupStatus,
) -> Result<(), LifecycleError> {
    if can_perform_rollup_action(action, status) {
        Ok(())
    } else {
        Err(LifecycleError { action, status })
    }
}

/// The valid next states for a batch status. A finalized/rejected batch is
/// terminal.
pub fn batch_transitions(status: BatchStatus) -> &'static [BatchStatus] {
    match status {
        BatchStatus::Submitted => &[BatchStatus::Finalized, BatchStatus::Challenged],
        BatchStatus::Challenged => &[BatchStatus::Rejected, BatchStatus::Finalized],
        BatchStatus::Finalized => &[],
        BatchStatus::Rejected => &[],
    }
}

/// Whether a batch status is terminal (finalized or rejected).
pub fn is_batch_final(status: BatchStatus) -> bool {
    batch_transitions(status).is_empty()
}

/// The Unix timestamp (seconds) at which an optimistic batch's challenge window
/// closes.
pub fn challenge_window_deadline(submitted_at_secs: i64, window_secs: i64) -> i64 {
    submitted_at_secs + window_secs
}

/// Whether an optimistic batch's challenge window has elapsed at `now_secs`.
pub fn is_challenge_window_closed(submitted_at_secs: i64, window_secs: i64, now_secs: i64) -> bool {
    now_secs >= challenge_window_deadline(submitted_at_secs, window_secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rollup_transitions() {
        assert!(can_perform_rollup_action(
            RollupAction::Pause,
            RollupStatus::Active
        ));
        assert!(!can_perform_rollup_action(
            RollupAction::Pause,
            RollupStatus::Paused
        ));
        assert!(assert_rollup_action(RollupAction::Resume, RollupStatus::Active).is_err());
    }

    #[test]
    fn batch_finality() {
        assert!(is_batch_final(BatchStatus::Finalized));
        assert!(!is_batch_final(BatchStatus::Submitted));
    }
}
