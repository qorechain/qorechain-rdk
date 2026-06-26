package io.github.qorechain.rdk.events;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Decode {@code rdk} module events from a transaction result. */
public final class Events {
    private Events() {}

    /** The event types emitted by the {@code rdk} module. */
    public static final List<String> RDK_EVENT_TYPES =
            List.of(
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
                    "profile_suggested");

    private static final Set<String> RDK_EVENT_TYPE_SET = Set.copyOf(RDK_EVENT_TYPES);

    /** A single key/value pair on a Cosmos event. */
    public static final class EventAttribute {
        public final String key;
        public final String value;

        public EventAttribute(String key, String value) {
            this.key = key;
            this.value = value;
        }
    }

    /** A minimal Cosmos event shape (as surfaced by tx results). */
    public static final class RawEvent {
        public final String type;
        public final List<EventAttribute> attributes;

        public RawEvent(String type, List<EventAttribute> attributes) {
            this.type = type;
            this.attributes = attributes;
        }
    }

    /** A decoded {@code rdk} event with its attributes as a map. */
    public static final class DecodedRdkEvent {
        public final String type;
        public final Map<String, String> attributes;

        public DecodedRdkEvent(String type, Map<String, String> attributes) {
            this.type = type;
            this.attributes = attributes;
        }
    }

    private static boolean isRdkEventType(String type) {
        return RDK_EVENT_TYPE_SET.contains(type);
    }

    /** Filter and decode the {@code rdk} events from a list of transaction events. */
    public static List<DecodedRdkEvent> decodeRdkEvents(List<RawEvent> events) {
        List<DecodedRdkEvent> out = new ArrayList<>();
        for (RawEvent event : events) {
            if (!isRdkEventType(event.type)) {
                continue;
            }
            Map<String, String> attrs = new LinkedHashMap<>();
            for (EventAttribute attr : event.attributes) {
                attrs.put(attr.key, attr.value);
            }
            out.add(new DecodedRdkEvent(event.type, attrs));
        }
        return out;
    }

    /** Return the first decoded {@code rdk} event of a given type, or {@code null}. */
    public static DecodedRdkEvent findRdkEvent(List<RawEvent> events, String type) {
        for (DecodedRdkEvent e : decodeRdkEvents(events)) {
            if (e.type.equals(type)) {
                return e;
            }
        }
        return null;
    }
}
