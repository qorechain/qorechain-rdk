//! Decode `rdk` module events from a transaction result.
//!
//! QoreChain emits typed events for rollup and batch state changes. The decoders
//! here filter a transaction's events down to the `rdk` ones and expose their
//! attributes as a plain map.

use std::collections::BTreeMap;

/// The event types emitted by the `rdk` module.
pub const RDK_EVENT_TYPES: &[&str] = &[
    "rollup_created",
    "rollup_paused",
    "rollup_resumed",
    "rollup_stopped",
    "batch_submitted",
    "batch_challenged",
    "batch_finalized",
    "batch_rejected",
    "da_blob_stored",
    "da_blob_pruned",
    "profile_suggested",
];

/// A minimal Cosmos event shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawEvent {
    /// The event type.
    pub event_type: String,
    /// The event attributes, as key/value pairs.
    pub attributes: Vec<(String, String)>,
}

/// A decoded `rdk` event with its attributes as a map.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedRdkEvent {
    /// The event type.
    pub event_type: String,
    /// The event attributes.
    pub attributes: BTreeMap<String, String>,
}

/// Whether a string names an `rdk` event type.
pub fn is_rdk_event_type(event_type: &str) -> bool {
    RDK_EVENT_TYPES.contains(&event_type)
}

/// Filter and decode the `rdk` events from a list of transaction events.
pub fn decode_rdk_events(events: &[RawEvent]) -> Vec<DecodedRdkEvent> {
    events
        .iter()
        .filter(|e| is_rdk_event_type(&e.event_type))
        .map(|e| DecodedRdkEvent {
            event_type: e.event_type.clone(),
            attributes: e.attributes.iter().cloned().collect(),
        })
        .collect()
}

/// Return the first decoded `rdk` event of a given type, if present.
pub fn find_rdk_event(events: &[RawEvent], event_type: &str) -> Option<DecodedRdkEvent> {
    decode_rdk_events(events)
        .into_iter()
        .find(|e| e.event_type == event_type)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_and_decodes() {
        let events = vec![
            RawEvent {
                event_type: "message".to_string(),
                attributes: vec![],
            },
            RawEvent {
                event_type: "rollup_created".to_string(),
                attributes: vec![("rollup_id".to_string(), "my-rollup".to_string())],
            },
        ];
        let decoded = decode_rdk_events(&events);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].event_type, "rollup_created");
        assert_eq!(
            decoded[0].attributes.get("rollup_id"),
            Some(&"my-rollup".to_string())
        );
        assert!(find_rdk_event(&events, "rollup_paused").is_none());
    }
}
