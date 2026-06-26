package io.github.qorechain.rdk.util;

import java.util.regex.Pattern;

/** Byte/hex helpers used across the tx, DA, and event layers. */
public final class Bytes {
    private Bytes() {}

    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private static final Pattern HEX_RE = Pattern.compile("^[0-9a-fA-F]*$");

    /** Convert bytes to a lowercase hex string (no {@code 0x} prefix). */
    public static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(HEX[(b >> 4) & 0xf]);
            sb.append(HEX[b & 0xf]);
        }
        return sb.toString();
    }

    /** Parse a hex string (with or without a {@code 0x} prefix) into bytes. */
    public static byte[] hexToBytes(String hex) {
        String h = hex;
        if (h.startsWith("0x") || h.startsWith("0X")) {
            h = h.substring(2);
        }
        if (h.length() % 2 != 0 || !HEX_RE.matcher(h).matches()) {
            throw new IllegalArgumentException("invalid hex string: \"" + hex + "\"");
        }
        byte[] out = new byte[h.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(h.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    /** Coerce a hex string into bytes (string overload of the TS {@code toBytes} helper). */
    public static byte[] toBytes(String input) {
        return hexToBytes(input);
    }
}
