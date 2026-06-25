/**
 * Decode `rdk` module events from a transaction result.
 *
 * QoreChain emits these typed events for rollup and batch state changes. The
 * decoders here filter a transaction's events down to the `rdk` ones and expose
 * their attributes as a plain map.
 */

/** The event types emitted by the `rdk` module. */
export const RDK_EVENT_TYPES = [
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
] as const;

export type RdkEventType = (typeof RDK_EVENT_TYPES)[number];

/** A minimal Cosmos event shape (as surfaced by `@cosmjs` tx results). */
export interface RawEvent {
  type: string;
  attributes: readonly { key: string; value: string }[];
}

/** A decoded `rdk` event with its attributes as a map. */
export interface DecodedRdkEvent {
  type: RdkEventType;
  attributes: Record<string, string>;
}

function isRdkEventType(type: string): type is RdkEventType {
  return (RDK_EVENT_TYPES as readonly string[]).includes(type);
}

/** Filter and decode the `rdk` events from a list of transaction events. */
export function decodeRdkEvents(events: readonly RawEvent[]): DecodedRdkEvent[] {
  const out: DecodedRdkEvent[] = [];
  for (const event of events) {
    if (!isRdkEventType(event.type)) continue;
    const attributes: Record<string, string> = {};
    for (const attr of event.attributes) {
      attributes[attr.key] = attr.value;
    }
    out.push({ type: event.type, attributes });
  }
  return out;
}

/** Return the first decoded `rdk` event of a given type, if present. */
export function findRdkEvent(
  events: readonly RawEvent[],
  type: RdkEventType,
): DecodedRdkEvent | undefined {
  return decodeRdkEvents(events).find((e) => e.type === type);
}
