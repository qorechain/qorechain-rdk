package io.github.qorechain.rdk.util;

import io.github.qorechain.rdk.config.Constants;
import java.math.BigInteger;
import java.util.regex.Pattern;

/** Denomination conversion between display (QOR) and base (uqor) units, using exact integer math. */
public final class Denom {
    private Denom() {}

    private static final Pattern QOR_AMOUNT = Pattern.compile("^\\d+(\\.\\d+)?$");
    private static final Pattern UQOR_INTEGER = Pattern.compile("^\\d+$");

    /**
     * Convert a display amount (QOR) to base units (uqor) as an integer string. Uses integer/string
     * math only — never floating point — so values are exact.
     *
     * @throws IllegalArgumentException if the input is not a non-negative decimal or has more than
     *     {@code exponent} fractional digits.
     */
    public static String qorToUqor(String amount, int exponent) {
        int exp = exponent <= 0 ? Constants.DENOM_EXPONENT : exponent;
        String s = amount.trim();
        if (!QOR_AMOUNT.matcher(s).matches()) {
            throw new IllegalArgumentException("invalid QOR amount: \"" + amount + "\"");
        }
        String whole = s;
        String frac = "";
        int dot = s.indexOf('.');
        if (dot >= 0) {
            whole = s.substring(0, dot);
            frac = s.substring(dot + 1);
        }
        if (frac.length() > exp) {
            throw new IllegalArgumentException(
                    "QOR amount \"" + amount + "\" has more than " + exp + " fractional digits");
        }
        StringBuilder padded = new StringBuilder(whole).append(frac);
        for (int i = frac.length(); i < exp; i++) {
            padded.append('0');
        }
        String combined = stripLeadingZeros(padded.toString());
        return combined.isEmpty() ? "0" : combined;
    }

    public static String qorToUqor(String amount) {
        return qorToUqor(amount, Constants.DENOM_EXPONENT);
    }

    /**
     * Convert base units (uqor) to a display amount (QOR), trimming trailing zeros.
     *
     * @throws IllegalArgumentException if the input is not a non-negative integer.
     */
    public static String uqorToQor(String amount, int exponent) {
        int exp = exponent <= 0 ? Constants.DENOM_EXPONENT : exponent;
        String t = amount.trim();
        if (!UQOR_INTEGER.matcher(t).matches()) {
            throw new IllegalArgumentException("invalid uqor amount: \"" + amount + "\"");
        }
        BigInteger value = new BigInteger(t);
        if (value.signum() < 0) {
            throw new IllegalArgumentException("uqor amount must be non-negative");
        }
        BigInteger base = BigInteger.TEN.pow(exp);
        BigInteger[] qr = value.divideAndRemainder(base);
        BigInteger whole = qr[0];
        BigInteger frac = qr[1];
        if (frac.signum() == 0) {
            return whole.toString();
        }
        String fracStr = frac.toString();
        StringBuilder padded = new StringBuilder();
        for (int i = fracStr.length(); i < exp; i++) {
            padded.append('0');
        }
        padded.append(fracStr);
        String trimmed = stripTrailingZeros(padded.toString());
        return whole + "." + trimmed;
    }

    public static String uqorToQor(String amount) {
        return uqorToQor(amount, Constants.DENOM_EXPONENT);
    }

    private static String stripLeadingZeros(String s) {
        int i = 0;
        while (i < s.length() - 1 && s.charAt(i) == '0') {
            i++;
        }
        return s.substring(i);
    }

    private static String stripTrailingZeros(String s) {
        int i = s.length();
        while (i > 0 && s.charAt(i - 1) == '0') {
            i--;
        }
        return s.substring(0, i);
    }
}
