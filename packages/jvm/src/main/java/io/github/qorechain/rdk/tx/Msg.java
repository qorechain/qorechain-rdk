package io.github.qorechain.rdk.tx;

/**
 * Implemented by every {@code rdk} transaction message. {@link #typeUrl()} returns the wire type
 * URL and {@link #marshal()} returns the protobuf-encoded message bytes.
 */
public interface Msg {
    String typeUrl();

    byte[] marshal();
}
