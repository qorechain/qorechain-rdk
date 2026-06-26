package io.github.qorechain.rdk.util;

import io.github.qorechain.rdk.config.Constants;
import java.math.BigInteger;
import java.util.regex.Pattern;

/** Rollup creation economics: burn-rate math and a creation-cost estimate. */
public final class Economics {
    private Economics() {}

    private static final Pattern UQOR_INTEGER = Pattern.compile("^\\d+$");
    private static final Pattern DECIMAL = Pattern.compile("^\\d+(\\.\\d+)?$");

    /**
     * Multiply an integer amount by a non-negative decimal (e.g. {@code "0.01"}), flooring the
     * result. Pure integer math — no floating point — so the result is exact.
     */
    public static BigInteger mulDecimalFloor(BigInteger amount, String decimal) {
        String d = decimal.trim();
        if (!DECIMAL.matcher(d).matches()) {
            throw new IllegalArgumentException("invalid decimal: \"" + decimal + "\"");
        }
        String whole = d;
        String frac = "";
        int dot = d.indexOf('.');
        if (dot >= 0) {
            whole = d.substring(0, dot);
            frac = d.substring(dot + 1);
        }
        BigInteger scale = BigInteger.TEN.pow(frac.length());
        String numStr = whole + frac;
        if (numStr.isEmpty()) {
            numStr = "0";
        }
        BigInteger numerator = new BigInteger(numStr);
        return amount.multiply(numerator).divide(scale);
    }

    /** The cost breakdown of creating a rollup. All amounts are uqor strings. */
    public static final class CreationCost {
        /** The stake you commit, in uqor. */
        public final String stakeUqor;
        /** The amount burned on creation, in uqor. */
        public final String burnUqor;
        /** The stake remaining after the burn, in uqor. */
        public final String netStakeUqor;
        /** The total leaving your wallet (equal to the committed stake), in uqor. */
        public final String totalRequiredUqor;
        /** The burn rate applied, as a decimal string. */
        public final String burnRate;

        public CreationCost(
                String stakeUqor,
                String burnUqor,
                String netStakeUqor,
                String totalRequiredUqor,
                String burnRate) {
            this.stakeUqor = stakeUqor;
            this.burnUqor = burnUqor;
            this.netStakeUqor = netStakeUqor;
            this.totalRequiredUqor = totalRequiredUqor;
            this.burnRate = burnRate;
        }
    }

    /**
     * Estimate the cost of creating a rollup: the burn taken from the committed stake and the net
     * stake remaining. An empty burn rate defaults to the documented rate; pass the live
     * {@code rollup_creation_burn_rate} from the params query for an exact figure.
     */
    public static CreationCost estimateCreationCost(String stakeUqor, String burnRate) {
        String t = stakeUqor.trim();
        if (!UQOR_INTEGER.matcher(t).matches()) {
            throw new IllegalArgumentException(
                    "stakeUqor must be a non-negative integer string, got \"" + stakeUqor + "\"");
        }
        BigInteger stake = new BigInteger(t);
        String rate = (burnRate == null || burnRate.isEmpty())
                ? Constants.DEFAULT_ROLLUP_CREATION_BURN_RATE
                : burnRate;
        BigInteger burn = mulDecimalFloor(stake, rate);
        BigInteger net = stake.subtract(burn);
        return new CreationCost(
                stake.toString(), burn.toString(), net.toString(), stake.toString(), rate);
    }

    public static CreationCost estimateCreationCost(String stakeUqor) {
        return estimateCreationCost(stakeUqor, null);
    }
}
