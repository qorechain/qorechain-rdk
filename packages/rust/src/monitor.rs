//! Live monitoring helpers built on the read surface: poll a rollup's health on
//! an interval, and decode the `rdk` events emitted by a transaction.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::Value;

use crate::client::rest::RestError;
use crate::client::RdkClient;
use crate::events::{decode_rdk_events, DecodedRdkEvent, RawEvent};
use crate::health::{get_rollup_health, RollupHealth};

/// Decode the `rdk` events emitted by a transaction, by hash.
pub fn events_from_tx_hash(
    client: &RdkClient,
    hash: &str,
) -> Result<Vec<DecodedRdkEvent>, RestError> {
    let body = client.rest.get_tx(hash)?;
    let tx_response = body
        .get("tx_response")
        .or_else(|| body.get("txResponse"))
        .cloned()
        .unwrap_or(Value::Null);
    let events = tx_response
        .get("events")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(parse_raw_event).collect::<Vec<_>>())
        .unwrap_or_default();
    Ok(decode_rdk_events(&events))
}

/// Parse a single Cosmos event JSON object into a [`RawEvent`].
fn parse_raw_event(value: &Value) -> RawEvent {
    let event_type = value
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let attributes = value
        .get("attributes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|a| {
                    let key = a
                        .get("key")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let val = a
                        .get("value")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    (key, val)
                })
                .collect()
        })
        .unwrap_or_default();
    RawEvent {
        event_type,
        attributes,
    }
}

/// A handle to a running [`watch_rollup`] poll loop.
///
/// Dropping the handle requests the loop to stop and joins the worker thread.
pub struct Watcher {
    stopped: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Watcher {
    /// Whether the watcher has been asked to stop.
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// Request the poll loop to stop and join the worker thread.
    pub fn stop(mut self) {
        self.stop_inner();
    }

    fn stop_inner(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.stop_inner();
    }
}

/// Poll a rollup's [`RollupHealth`] on an interval, invoking `on_update` with
/// each snapshot (and `on_error` on a polling error, after which the loop
/// continues). Returns a [`Watcher`] handle; call [`Watcher::stop`] (or drop it)
/// to end the loop.
///
/// The clock is supplied by `now_secs` (called once per tick) so callers can
/// inject a deterministic time source in tests. The work runs on a background
/// thread, so `client`, the callbacks, and `now_secs` must be `Send + 'static`.
pub fn watch_rollup<U, E, N>(
    client: RdkClient,
    rollup_id: impl Into<String>,
    interval: Duration,
    mut on_update: U,
    mut on_error: E,
    now_secs: N,
) -> Watcher
where
    RdkClient: Send,
    U: FnMut(RollupHealth) + Send + 'static,
    E: FnMut(RestError) + Send + 'static,
    N: Fn() -> i64 + Send + 'static,
{
    let rollup_id = rollup_id.into();
    let stopped = Arc::new(AtomicBool::new(false));
    let stopped_worker = stopped.clone();

    let handle = thread::spawn(move || {
        while !stopped_worker.load(Ordering::SeqCst) {
            match get_rollup_health(&client, &rollup_id, now_secs()) {
                Ok(health) => {
                    if stopped_worker.load(Ordering::SeqCst) {
                        break;
                    }
                    on_update(health);
                }
                Err(error) => {
                    if stopped_worker.load(Ordering::SeqCst) {
                        break;
                    }
                    on_error(error);
                }
            }
            // Sleep in small slices so stop() is responsive without waiting out
            // the whole interval.
            let mut remaining = interval;
            let slice = Duration::from_millis(50);
            while remaining > Duration::ZERO && !stopped_worker.load(Ordering::SeqCst) {
                let step = remaining.min(slice);
                thread::sleep(step);
                remaining = remaining.saturating_sub(step);
            }
        }
    });

    Watcher {
        stopped,
        handle: Some(handle),
    }
}
