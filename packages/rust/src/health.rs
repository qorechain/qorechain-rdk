//! Rollup health: a consolidated, beginner-friendly read of a rollup's status,
//! its latest settlement batch, and (for optimistic rollups) the challenge
//! window, judged with the chain's own rules — see
//! [`crate::challenge_window`].

use crate::challenge_window::{
    batch_challenge_window, ChainTip, ChallengeWindowStatus, WindowMode,
};
use crate::client::rest::RestError;
use crate::client::RdkClient;

/// A consolidated rollup-health snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RollupHealth {
    /// The rollup id.
    pub rollup_id: String,
    /// Rollup lifecycle status (active/paused/stopped/pending).
    pub status: String,
    /// Whether any batch has been submitted.
    pub has_batches: bool,
    /// The latest batch index, if any.
    pub latest_batch_index: Option<i64>,
    /// The latest batch status, if any.
    pub latest_batch_status: Option<String>,
    /// The height the latest batch was submitted at.
    pub latest_batch_height: Option<i64>,
    /// Blocks since the latest batch was submitted.
    pub batch_age_blocks: Option<i64>,
    /// Seconds since submission — only when the node records the submission
    /// time (chain v3.2.4+); a height alone cannot be turned into a time.
    pub batch_age_secs: Option<i64>,
    /// The latest pending batch's window, by the chain's own rules.
    pub challenge_window: Option<ChallengeWindowStatus>,
    /// Time mode only: when the window closes (Unix seconds).
    pub challenge_deadline_secs: Option<i64>,
    /// Time mode only: seconds until it closes (negative once past).
    pub seconds_until_challenge_deadline: Option<i64>,
    /// Coarse health flag: active rollup, latest batch not rejected.
    pub healthy: bool,
    /// Human-readable observations.
    pub notes: Vec<String>,
}

/// Options for [`get_rollup_health`].
#[derive(Debug, Clone, Copy, Default)]
pub struct HealthOptions {
    /// The chain tip to judge against. `None` reads the node's `/status`.
    pub tip: Option<ChainTip>,
    /// The rollup's window in seconds. `None` uses the value the node reports
    /// for this rollup (chain v3.2.4+), then the global param.
    pub challenge_window_secs: Option<u64>,
}

/// Assemble a [`RollupHealth`] snapshot for a rollup.
pub fn get_rollup_health(
    client: &RdkClient,
    rollup_id: &str,
    options: HealthOptions,
) -> Result<RollupHealth, RestError> {
    let mut notes: Vec<String> = Vec::new();
    let rollup = client.rest.get_rollup(rollup_id)?;
    let mut healthy = rollup.status == "active";
    if rollup.status != "active" {
        notes.push(format!("rollup status is \"{}\"", rollup.status));
    }

    let mut health = RollupHealth {
        rollup_id: rollup_id.to_string(),
        status: rollup.status.clone(),
        has_batches: false,
        latest_batch_index: None,
        latest_batch_status: None,
        latest_batch_height: None,
        batch_age_blocks: None,
        batch_age_secs: None,
        challenge_window: None,
        challenge_deadline_secs: None,
        seconds_until_challenge_deadline: None,
        healthy,
        notes,
    };

    let latest_batch = match client.rest.get_latest_batch(rollup_id) {
        Ok(b) if b.submitted_at != 0 => b,
        _ => {
            health
                .notes
                .push("no settlement batches submitted yet".to_string());
            return Ok(health);
        }
    };

    health.has_batches = true;
    health.latest_batch_index = Some(latest_batch.batch_index);
    health.latest_batch_status = Some(latest_batch.status.clone());
    health.latest_batch_height = Some(latest_batch.submitted_at);

    if latest_batch.status == "rejected" {
        healthy = false;
        health.notes.push("latest batch was rejected".to_string());
    }

    let tip = match options.tip {
        Some(t) => Some(t),
        None => match client.get_chain_tip() {
            Ok(t) => Some(t),
            Err(e) => {
                health
                    .notes
                    .push(format!("could not read the chain tip: {e}"));
                None
            }
        },
    };
    if let Some(t) = tip {
        health.batch_age_blocks = Some(t.height - latest_batch.submitted_at);
        if latest_batch.submitted_time > 0 {
            health.batch_age_secs = Some(t.time_secs - latest_batch.submitted_time);
        }
    }

    if latest_batch.status == "submitted" || latest_batch.status == "challenged" {
        let fell_back =
            options.challenge_window_secs.is_none() && rollup.challenge_window_sec.is_none();
        let window_secs = match options
            .challenge_window_secs
            .or(rollup.challenge_window_sec)
        {
            Some(w) => w,
            None => client.params()?.default_challenge_window.max(0) as u64,
        };
        if let Some(t) = tip {
            let w = batch_challenge_window(&latest_batch, window_secs, t);
            if w.mode == WindowMode::Time {
                health.challenge_deadline_secs = w.deadline_secs;
                health.seconds_until_challenge_deadline = w.seconds_remaining;
            }
            health.challenge_window = Some(w);
        }
        if fell_back {
            health.notes.push(
                "this node does not report the rollup's own challenge window; using the global default, which is wrong for a rollup that set its own"
                    .to_string(),
            );
        }
        if latest_batch.status == "challenged" {
            health
                .notes
                .push("latest batch is under challenge".to_string());
        }
    }

    health.healthy = healthy;
    Ok(health)
}
