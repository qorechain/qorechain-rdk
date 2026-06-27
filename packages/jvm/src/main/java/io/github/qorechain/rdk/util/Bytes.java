package io.github.qorechain.rdk.util;

import java.util.Base64;
import java.util.regex.Pattern;

/** Byte/hex helpers used across the tx, DA, and event layers. */
public final class Bytes {
    private Bytes() {}

    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private static final Pattern HEX_RE = Pattern.compile("^[0-9a-fA-F]*$");
    private static final Pattern HEX_FULL_RE = Pattern.compile("^[0-9a-fA-F]+$");
    private static final Pattern BASE64ISH_RE = Pattern.compile("[+/=]|[g-zG-Z]");

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

    /** Decode a standard (RFC 4648) base64 string into bytes. */
    public static byte[] base64ToBytes(String b64) {
        if (b64.isEmpty()) {
            return new byte[0];
        }
        return Base64.getDecoder().decode(b64);
    }

    /**
     * Decode a bytes value as it arrives from the chain's wire surface. Cosmos gRPC-gateway
     * (jsonpb) encodes proto {@code bytes} as base64; some surfaces send hex. Disambiguated by
     * alphabet and length (a 32-byte root is 64 hex chars vs ~44 base64 chars with {@code +/=}),
     * so both encodings round-trip correctly.
     */
    public static byte[] decodeWireBytes(String value) {
        if (value == null || value.isEmpty()) {
            return new byte[0];
        }
        boolean isHex = value.length() % 2 == 0 && HEX_FULL_RE.matcher(value).matches();
        boolean looksBase64 = BASE64ISH_RE.matcher(value).find();
        return isHex && !looksBase64 ? hexToBytes(value) : base64ToBytes(value);
    }
}
