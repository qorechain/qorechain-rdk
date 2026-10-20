//! Challenge windows, computed with the chain's own rules (`x/rdk`
//! `challenge_window.go`).
//!
//! The chain chooses the rule **per batch**. A batch submitted under the
//! time-based window (chain v3.2.4, `rdk-challenge-window-time`) records its
//! submission block time, and its window closes once block time reaches
//! `submitted_time + window_secs`. Every earlier batch keeps the original rule:
//! `window_secs / 6` blocks counted from the submission **height** — which
//! assumed 6-second blocks, so a 7-day window closes after about 3.75 days on
//! mainnet and 28 hours on the testnet.
//!
//! On the block-count path the chain refuses a challenge once
//! `height - submitted_at > window_blocks` but finalizes once it is `>=`, so for
//! exactly one block a batch is both finalizable and still challengeable;
//! [`ChallengeWindowStatus::open`] and [`ChallengeWindowStatus::finalizable`]
//! report the two separately.

use crate::client::views::BatchView;

/// The chain tip a challenge window is judged against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChainTip {
    /// Latest block height.
    pub height: i64,
    /// The tip's block time, Unix seconds.
    pub time_secs: i64,
}

/// Which rule the chain applies to a batch's window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowMode {
    /// Seconds of block time from the recorded submission time (v3.2.4+).
    Time,
    /// `window_secs / 6` blocks from the submission height.
    Blocks,
}

/// A batch's challenge window, exactly as the chain judges it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChallengeWindowStatus {
    /// Which rule applies.
    pub mode: WindowMode,
    /// Whether the chain still accepts a challenge now.
    pub open: bool,
    /// Whether the chain would finalize the batch now.
    pub finalizable: bool,
    /// Time mode: when the window closes (Unix seconds).
    pub deadline_secs: Option<i64>,
    /// Time mode: seconds until it closes (negative once closed).
    pub seconds_remaining: Option<i64>,
    /// Block-count mode: the window's length in blocks.
    pub window_blocks: Option<i64>,
    /// Block-count mode: the last height at which a challenge is accepted.
    pub deadline_height: Option<i64>,
    /// Block-count mode: blocks until that height (negative once closed).
    pub blocks_remaining: Option<i64>,
}

/// Compute a batch's challenge window as the chain does. `window_secs` is the
/// **rollup's own** window; the global `default_challenge_window` param is only
/// a fallback.
pub fn batch_challenge_window(
    batch: &BatchView,
    window_secs: u64,
    tip: ChainTip,
) -> ChallengeWindowStatus {
    if batch.submitted_time > 0 {
        let elapsed = tip.time_secs - batch.submitted_time;
        // The chain treats a negative elapsed (tip before submission) as not elapsed.
        let elapsed_fully = elapsed >= 0 && elapsed as u64 >= window_secs;
        let deadline = batch.submitted_time + window_secs as i64;
        return ChallengeWindowStatus {
            mode: WindowMode::Time,
            open: !elapsed_fully,
            finalizable: elapsed_fully,
            deadline_secs: Some(deadline),
            seconds_remaining: Some(deadline - tip.time_secs),
            window_blocks: None,
            deadline_height: None,
            blocks_remaining: None,
        };
    }
    let window_blocks = (window_secs / 6) as i64;
    let since = tip.height - batch.submitted_at;
    let deadline_height = batch.submitted_at + window_blocks;
    ChallengeWindowStatus {
        mode: WindowMode::Blocks,
        open: since <= window_blocks,
        finalizable: since >= window_blocks,
        deadline_secs: None,
        seconds_remaining: None,
        window_blocks: Some(window_blocks),
        deadline_height: Some(deadline_height),
        blocks_remaining: Some(deadline_height - tip.height),
    }
}

/// Parse an RFC 3339 UTC timestamp as the node reports it
/// (`YYYY-MM-DDTHH:MM:SS[.fraction]Z`) to Unix seconds. Fractions are dropped.
pub(crate) fn rfc3339_utc_to_unix(s: &str) -> Option<i64> {
    let s = s.strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-');
    let (y, m, day): (i64, i64, i64) = (
        d.next()?.parse().ok()?,
        d.next()?.parse().ok()?,
        d.next()?.parse().ok()?,
    );
    let time = time.split('.').next()?;
    let mut t = time.split(':');
    let (hh, mm, ss): (i64, i64, i64) = (
        t.next()?.parse().ok()?,
        t.next()?.parse().ok()?,
        t.next()?.parse().ok()?,
    );
    if !(1..=12).contains(&m) || !(1..=31).contains(&day) || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    // Days from the civil date (Howard Hinnant's algorithm), proleptic Gregorian.
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + hh * 3_600 + mm * 60 + ss)
}

#[cfg(test)]
mod tests {
    use super::rfc3339_utc_to_unix;

    #[test]
    fn parses_the_node_timestamp_format() {
        assert_eq!(rfc3339_utc_to_unix("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(
            rfc3339_utc_to_unix("2023-11-14T22:13:20Z"),
            Some(1_700_000_000)
        );
        // Nanosecond fractions, as the node reports them, are dropped.
        assert_eq!(
            rfc3339_utc_to_unix("2023-11-14T22:13:20.123456789Z"),
            Some(1_700_000_000)
        );
        // A leap day.
        assert_eq!(
            rfc3339_utc_to_unix("2024-02-29T00:00:00Z"),
            Some(1_709_164_800)
        );
        assert_eq!(rfc3339_utc_to_unix("not a time"), None);
        assert_eq!(rfc3339_utc_to_unix("2023-11-14T22:13:20"), None); // no Z
    }
}
