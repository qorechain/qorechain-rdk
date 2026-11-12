package io.github.qorechain.rdk.tx;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * Minimal protobuf wire decoder for the response messages this kit reads (varint and
 * length-delimited fields; fixed-width fields are skipped).
 */
public final class ProtoReader {
    private final byte[] buf;
    private int pos;

    public ProtoReader(byte[] buf) {
        this.buf = buf == null ? new byte[0] : buf;
    }

    /** Whether there is more to read. */
    public boolean hasMore() {
        return pos < buf.length;
    }

    /** Read a varint (up to 64 bits). */
    public long readVarint() {
        long result = 0;
        for (int shift = 0; shift < 64; shift += 7) {
            if (pos >= buf.length) {
                throw new IllegalArgumentException("protobuf: truncated varint");
            }
            int b = buf[pos++] & 0xff;
            result |= (long) (b & 0x7f) << shift;
            if ((b & 0x80) == 0) {
                return result;
            }
        }
        throw new IllegalArgumentException("protobuf: varint too long");
    }

    /** Read a field tag; the field number is {@code tag >>> 3}, the wire type {@code tag & 7}. */
    public int readTag() {
        return (int) readVarint();
    }

    /** Read a length-delimited field's bytes. */
    public byte[] readBytes() {
        long n = readVarint();
        if (n < 0 || n > buf.length - pos) {
            throw new IllegalArgumentException("protobuf: truncated length-delimited field");
        }
        byte[] out = Arrays.copyOfRange(buf, pos, pos + (int) n);
        pos += (int) n;
        return out;
    }

    /** Read a length-delimited field as UTF-8. */
    public String readString() {
        return new String(readBytes(), StandardCharsets.UTF_8);
    }

    /** Skip a field of the given wire type. */
    public void skip(int wireType) {
        switch (wireType) {
            case 0:
                readVarint();
                return;
            case 1:
                advance(8);
                return;
            case 2:
                readBytes();
                return;
            case 5:
                advance(4);
                return;
            default:
                throw new IllegalArgumentException("protobuf: unsupported wire type " + wireType);
        }
    }

    private void advance(int n) {
        if (buf.length - pos < n) {
            throw new IllegalArgumentException("protobuf: truncated fixed-width field");
        }
        pos += n;
    }
}
