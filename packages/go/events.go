package rdk

// RdkEventTypes are the event types emitted by the rdk module.
var RdkEventTypes = []string{
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
}

// EventAttribute is a single key/value pair on a Cosmos event.
type EventAttribute struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// RawEvent is a minimal Cosmos event shape (as surfaced by tx results).
type RawEvent struct {
	Type       string           `json:"type"`
	Attributes []EventAttribute `json:"attributes"`
}

// DecodedRdkEvent is a decoded rdk event with its attributes as a map.
type DecodedRdkEvent struct {
	Type       string
	Attributes map[string]string
}

func isRdkEventType(t string) bool {
	for _, e := range RdkEventTypes {
		if e == t {
			return true
		}
	}
	return false
}

// DecodeRdkEvents filters and decodes the rdk events from a list of transaction
// events.
func DecodeRdkEvents(events []RawEvent) []DecodedRdkEvent {
	out := []DecodedRdkEvent{}
	for _, event := range events {
		if !isRdkEventType(event.Type) {
			continue
		}
		attrs := make(map[string]string, len(event.Attributes))
		for _, attr := range event.Attributes {
			attrs[attr.Key] = attr.Value
		}
		out = append(out, DecodedRdkEvent{Type: event.Type, Attributes: attrs})
	}
	return out
}

// FindRdkEvent returns the first decoded rdk event of a given type, and whether
// one was found.
func FindRdkEvent(events []RawEvent, eventType string) (DecodedRdkEvent, bool) {
	for _, e := range DecodeRdkEvents(events) {
		if e.Type == eventType {
			return e, true
		}
	}
	return DecodedRdkEvent{}, false
}
