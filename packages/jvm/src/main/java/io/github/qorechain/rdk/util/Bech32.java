package io.github.qorechain.rdk.util;

import io.github.qorechain.rdk.config.Constants;

/**
 * Minimal BIP-173 bech32 implementation, sufficient for QoreChain account addresses. It
 * encodes/decodes the data part as 5-bit groups with the standard checksum. This avoids pulling a
 * heavier dependency for a small, well-specified codec.
 */
public final class Bech32 {
    private Bech32() {}

    private static final String CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    private static final int[] CHARSET_REV = new int[128];

    static {
        for (int i = 0; i < 128; i++) {
            CHARSET_REV[i] = -1;
        }
        for (int i = 0; i < CHARSET.length(); i++) {
            CHARSET_REV[CHARSET.charAt(i)] = i;
        }
    }

    private static int polymod(int[] values) {
        int[] gen = {0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3};
        int chk = 1;
        for (int v : values) {
            int b = chk >>> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ v;
            for (int i = 0; i < 5; i++) {
                if (((b >>> i) & 1) == 1) {
                    chk ^= gen[i];
                }
            }
        }
        return chk;
    }

    private static int[] hrpExpand(String hrp) {
        int[] out = new int[hrp.length() * 2 + 1];
        int idx = 0;
        for (int i = 0; i < hrp.length(); i++) {
            out[idx++] = (hrp.charAt(i) >>> 5) & 0xff;
        }
        out[idx++] = 0;
        for (int i = 0; i < hrp.length(); i++) {
            out[idx++] = hrp.charAt(i) & 31;
        }
        return out;
    }

    private static int[] concat(int[] a, int[] b) {
        int[] out = new int[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static int[] createChecksum(String hrp, int[] data) {
        int[] values = concat(hrpExpand(hrp), data);
        int[] padded = new int[values.length + 6];
        System.arraycopy(values, 0, padded, 0, values.length);
        int polymod = polymod(padded) ^ 1;
        int[] out = new int[6];
        for (int i = 0; i < 6; i++) {
            out[i] = (polymod >>> (5 * (5 - i))) & 31;
        }
        return out;
    }

    private static boolean verifyChecksum(String hrp, int[] data) {
        return polymod(concat(hrpExpand(hrp), data)) == 1;
    }

    private static int[] convertBits(int[] data, int from, int to, boolean pad) {
        int acc = 0;
        int bits = 0;
        // Upper bound on output groups: every input contributes `from` bits, plus one padding group.
        int[] tmp = new int[(data.length * from) / to + 2];
        int n = 0;
        int maxv = (1 << to) - 1;
        int maxAcc = (1 << (from + to - 1)) - 1;
        for (int value : data) {
            if ((value >>> from) != 0) {
                throw new IllegalArgumentException("invalid data range in bit conversion");
            }
            acc = ((acc << from) | value) & maxAcc;
            bits += from;
            while (bits >= to) {
                bits -= to;
                tmp[n++] = (acc >>> bits) & maxv;
            }
        }
        if (pad) {
            if (bits > 0) {
                tmp[n++] = (acc << (to - bits)) & maxv;
            }
        } else if (bits >= from || ((acc << (to - bits)) & maxv) != 0) {
            throw new IllegalArgumentException("invalid padding in bit conversion");
        }
        int[] out = new int[n];
        System.arraycopy(tmp, 0, out, 0, n);
        return out;
    }

    private static int[] toIntArray(byte[] data) {
        int[] out = new int[data.length];
        for (int i = 0; i < data.length; i++) {
            out[i] = data[i] & 0xff;
        }
        return out;
    }

    /** Encode the human-readable part and 8-bit data bytes into a bech32 string. */
    public static String encode(String hrp, byte[] data8) {
        int[] data5 = convertBits(toIntArray(data8), 8, 5, true);
        int[] checksum = createChecksum(hrp, data5);
        StringBuilder sb = new StringBuilder();
        sb.append(hrp).append('1');
        for (int b : data5) {
            sb.append(CHARSET.charAt(b));
        }
        for (int b : checksum) {
            sb.append(CHARSET.charAt(b));
        }
        return sb.toString();
    }

    /** A decoded bech32 address: its human-readable part and 8-bit data bytes. */
    public static final class Decoded {
        public final String hrp;
        public final byte[] data;

        Decoded(String hrp, byte[] data) {
            this.hrp = hrp;
            this.data = data;
        }
    }

    /** Decode a bech32 string into its human-readable part and 8-bit data bytes. */
    public static Decoded decode(String addr) {
        String lower = addr.toLowerCase();
        String upper = addr.toUpperCase();
        if (!addr.equals(lower) && !addr.equals(upper)) {
            throw new IllegalArgumentException("bech32 string is mixed case");
        }
        String a = lower;
        int pos = a.lastIndexOf('1');
        if (pos < 1 || pos + 7 > a.length()) {
            throw new IllegalArgumentException("invalid bech32 separator position");
        }
        String hrp = a.substring(0, pos);
        String dataPart = a.substring(pos + 1);
        int[] data5 = new int[dataPart.length()];
        for (int i = 0; i < dataPart.length(); i++) {
            char c = dataPart.charAt(i);
            if (c >= 128 || CHARSET_REV[c] == -1) {
                throw new IllegalArgumentException("invalid bech32 character");
            }
            data5[i] = CHARSET_REV[c];
        }
        if (!verifyChecksum(hrp, data5)) {
            throw new IllegalArgumentException("invalid bech32 checksum");
        }
        int[] payload = new int[data5.length - 6];
        System.arraycopy(data5, 0, payload, 0, payload.length);
        int[] data8 = convertBits(payload, 5, 8, false);
        byte[] out = new byte[data8.length];
        for (int i = 0; i < data8.length; i++) {
            out[i] = (byte) data8[i];
        }
        return new Decoded(hrp, out);
    }

    /** Decode a bech32 address to a {@code 0x}-prefixed hex string of its data bytes. */
    public static String bech32ToHex(String address) {
        return "0x" + Bytes.bytesToHex(decode(address).data);
    }

    /** Encode hex data bytes as a bech32 address with the given prefix (empty → account prefix). */
    public static String hexToBech32(String hex, String prefix) {
        String p = (prefix == null || prefix.isEmpty()) ? Constants.ACCOUNT_PREFIX : prefix;
        return encode(p, Bytes.hexToBytes(hex));
    }

    /** Return the human-readable prefix of a bech32 address. */
    public static String bech32Prefix(String address) {
        return decode(address).hrp;
    }
}
