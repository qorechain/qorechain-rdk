//! Rollup health: a consolidated, beginner-friendly read of a rollup's status,
//! its latest settlement batch, and (for optimistic rollups) the
//! challenge-window countdown -- assembled from the existing read surface.

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
    /// Seconds since the latest batch was submitted.
    pub batch_age_secs: Option<i64>,
    /// For optimistic batches: when the challenge window closes (unix seconds).
    pub challenge_deadline_secs: Option<i64>,
    /// Seconds until the challenge window closes (negative if already past).
    pub seconds_until_challenge_deadline: Option<i64>,
    /// Coarse health flag: active rollup, latest batch not rejected.
    pub healthy: bool,
    /// Human-readable observations.
    pub notes: Vec<String>,
}

/// Assemble a [`RollupHealth`] snapshot for a rollup.
pub fn get_rollup_health(
    client: &RdkClient,
    rollup_id: &str,
    now_secs: i64,
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
        batch_age_secs: None,
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
    health.batch_age_secs = Some(now_secs - latest_batch.submitted_at);

    if latest_batch.status == "rejected" {
        healthy = false;
        health.notes.push("latest batch was rejected".to_string());
    }

    if latest_batch.status == "submitted" || latest_batch.status == "challenged" {
        let params = client.params()?;
        let deadline = latest_batch.submitted_at + params.default_challenge_window;
        health.challenge_deadline_secs = Some(deadline);
        health.seconds_until_challenge_deadline = Some(deadline - now_secs);
        if latest_batch.status == "challenged" {
            health
                .notes
                .push("latest batch is under challenge".to_string());
        }
    }

    health.healthy = healthy;
    Ok(health)
}
