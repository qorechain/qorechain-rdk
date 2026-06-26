package io.github.qorechain.rdk.tx;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * Minimal protobuf wire encoder. Fields are written in ascending field-number order by the message
 * encoders, matching the canonical gogoproto/cosmjs output so the resulting bytes are byte-for-byte
 * identical to the reference clients.
 */
public final class ProtoWriter {
    private static final int WIRE_VARINT = 0;
    private static final int WIRE_BYTES = 2;

    private final ByteArrayOutputStream buf = new ByteArrayOutputStream();

    public byte[] toByteArray() {
        return buf.toByteArray();
    }

    public void writeVarint(long v) {
        long value = v;
        while (true) {
            if ((value & ~0x7fL) == 0) {
                buf.write((int) (value & 0x7f));
                return;
            }
            buf.write((int) ((value & 0x7f) | 0x80));
            value >>>= 7;
        }
    }

    private void tag(int field, int wireType) {
        writeVarint(((long) field << 3) | wireType);
    }

    private void writeRaw(byte[] b) {
        buf.write(b, 0, b.length);
    }

    /** Write a non-empty string field (length-delimited). */
    public void writeString(int field, String s) {
        if (s == null || s.isEmpty()) {
            return;
        }
        writeRawString(field, s);
    }

    /** Write a string field unconditionally (used inside Any/SignDoc). */
    public void writeRawString(int field, String s) {
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        tag(field, WIRE_BYTES);
        writeVarint(b.length);
        writeRaw(b);
    }

    /** Write a non-empty bytes field (length-delimited). */
    public void writeBytes(int field, byte[] b) {
        if (b == null || b.length == 0) {
            return;
        }
        writeRawBytes(field, b);
    }

    /** Write a bytes field unconditionally. */
    public void writeRawBytes(int field, byte[] b) {
        tag(field, WIRE_BYTES);
        writeVarint(b.length);
        writeRaw(b);
    }

    /** Write a repeated bytes field, one entry per element. */
    public void writeRepeatedBytes(int field, List<byte[]> items) {
        if (items == null) {
            return;
        }
        for (byte[] item : items) {
            tag(field, WIRE_BYTES);
            writeVarint(item.length);
            writeRaw(item);
        }
    }

    /** Write a non-zero uint64 varint field. */
    public void writeUint64(int field, long v) {
        if (v == 0) {
            return;
        }
        tag(field, WIRE_VARINT);
        writeVarint(v);
    }

    /** Write a non-zero int64 varint field (two's-complement varint, as gogoproto encodes int64). */
    public void writeInt64(int field, long v) {
        if (v == 0) {
            return;
        }
        tag(field, WIRE_VARINT);
        writeVarint(v);
    }

    /** Write a true bool field (false is the default and omitted). */
    public void writeBool(int field, boolean v) {
        if (!v) {
            return;
        }
        tag(field, WIRE_VARINT);
        writeVarint(1);
    }

    /** Write an enum varint field unconditionally. */
    public void writeEnum(int field, long v) {
        tag(field, WIRE_VARINT);
        writeVarint(v);
    }

    /** Write an embedded message field (length-delimited). */
    public void writeMessage(int field, byte[] b) {
        tag(field, WIRE_BYTES);
        writeVarint(b.length);
        writeRaw(b);
    }
}
