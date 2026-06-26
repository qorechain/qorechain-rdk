package io.github.qorechain.rdk.client;

import io.github.qorechain.rdk.client.Views.ParamsView;
import io.github.qorechain.rdk.config.RollupConfig;
import io.github.qorechain.rdk.config.Validate;
import io.github.qorechain.rdk.config.ValidationResult;
import io.github.qorechain.rdk.util.Denom;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;

/** Readiness checks before creating or operating a rollup. */
public final class Preflight {
    private Preflight() {}

    /** The status of a single preflight check. */
    public enum CheckStatus {
        OK,
        WARN,
        FAIL
    }

    /** A single readiness check result. */
    public static final class PreflightCheck {
        public final String id;
        public final String label;
        public final CheckStatus status;
        public final String detail;
        public final String hint;

        public PreflightCheck(String id, String label, CheckStatus status, String detail, String hint) {
            this.id = id;
            this.label = label;
            this.status = status;
            this.detail = detail;
            this.hint = hint;
        }
    }

    /** The aggregate result of the preflight checks. */
    public static final class PreflightResult {
        public final boolean ok;
        public final List<PreflightCheck> checks;

        public PreflightResult(boolean ok, List<PreflightCheck> checks) {
            this.ok = ok;
            this.checks = checks;
        }
    }

    /** Options for the preflight checks. */
    public static final class PreflightOptions {
        /** A rollup config to validate. Null skips the config check. */
        public RollupConfig config;
        /** The operator/signer address, to check balance/presence. */
        public String signerAddress;
        /** Asserts the client is pointed at this network. */
        public String expectedNetwork;
        /** Extra uqor required on top of the stake. Empty defaults to 1 QOR (1000000 uqor). */
        public String feeBufferUqor;
    }

    /** Run the preflight checks against a client. */
    public static PreflightResult checkPreflight(RdkClient client, PreflightOptions options) {
        List<PreflightCheck> checks = new ArrayList<>();
        ParamsView params = null;
        try {
            params = client.params();
        } catch (RuntimeException e) {
            checks.add(
                    new PreflightCheck(
                            "rest",
                            "REST endpoint reachable",
                            CheckStatus.FAIL,
                            e.getMessage(),
                            "Set QORE_REST_URL to a reachable node REST (LCD) endpoint."));
        }
        boolean haveParams = params != null;
        if (haveParams) {
            checks.add(
                    new PreflightCheck(
                            "rest",
                            "REST endpoint reachable",
                            CheckStatus.OK,
                            client.network.endpoints.rest,
                            ""));
            String minStakeQor = Denom.uqorToQor(params.minStakeForRollup, 0);
            String burnPct = burnPercent(params.rollupCreationBurnRate);
            checks.add(
                    new PreflightCheck(
                            "params",
                            "Module parameters readable",
                            CheckStatus.OK,
                            "min stake " + minStakeQor + " QOR, burn " + burnPct + "%",
                            ""));
        }

        if (options.expectedNetwork != null && !options.expectedNetwork.isEmpty()) {
            boolean match = options.expectedNetwork.equals(client.network.name);
            checks.add(
                    new PreflightCheck(
                            "network",
                            "Network matches expectation",
                            match ? CheckStatus.OK : CheckStatus.WARN,
                            "client is " + client.network.name + " (" + client.network.chainId + ")",
                            match ? "" : "Expected " + options.expectedNetwork + "."));
        }

        if (options.config != null) {
            ValidationResult r = Validate.validateRollupConfig(options.config);
            if (!r.valid) {
                checks.add(
                        new PreflightCheck(
                                "config",
                                "Rollup config valid",
                                CheckStatus.FAIL,
                                r.errors.get(0),
                                "Fix the configuration errors before creating."));
            } else if (!r.warnings.isEmpty()) {
                checks.add(
                        new PreflightCheck(
                                "config", "Rollup config valid", CheckStatus.WARN, r.warnings.get(0), ""));
            } else {
                checks.add(
                        new PreflightCheck(
                                "config",
                                "Rollup config valid",
                                CheckStatus.OK,
                                "compatibility matrix satisfied",
                                ""));
            }
        }

        if (options.signerAddress != null && !options.signerAddress.isEmpty()) {
            checks.add(
                    new PreflightCheck(
                            "signer", "Signer configured", CheckStatus.OK, options.signerAddress, ""));
            if (haveParams) {
                try {
                    String bal = client.rest.getBalance(options.signerAddress, "");
                    BigInteger stake = parseBig(params.minStakeForRollup);
                    String bufStr =
                            (options.feeBufferUqor == null || options.feeBufferUqor.isEmpty())
                                    ? "1000000"
                                    : options.feeBufferUqor;
                    BigInteger buffer = parseBig(bufStr);
                    BigInteger required = stake.add(buffer);
                    BigInteger have = parseBig(bal);
                    boolean ok = have.compareTo(required) >= 0;
                    String haveQor = Denom.uqorToQor(have.toString(), 0);
                    String reqQor = Denom.uqorToQor(required.toString(), 0);
                    checks.add(
                            new PreflightCheck(
                                    "balance",
                                    "Balance covers stake + fees",
                                    ok ? CheckStatus.OK : CheckStatus.FAIL,
                                    "have " + haveQor + " QOR, need ~" + reqQor + " QOR",
                                    ok ? "" : "Fund the operator account (see the keys & funding guide)."));
                } catch (RuntimeException e) {
                    checks.add(
                            new PreflightCheck(
                                    "balance", "Balance readable", CheckStatus.WARN, e.getMessage(), ""));
                }
            }
        } else {
            checks.add(
                    new PreflightCheck(
                            "signer",
                            "Signer configured",
                            CheckStatus.WARN,
                            "no signer",
                            "Set QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC to create/operate."));
        }

        boolean ok = true;
        for (PreflightCheck c : checks) {
            if (c.status == CheckStatus.FAIL) {
                ok = false;
            }
        }
        return new PreflightResult(ok, checks);
    }

    private static BigInteger parseBig(String s) {
        try {
            return new BigInteger(s.trim());
        } catch (NumberFormatException e) {
            return BigInteger.ZERO;
        }
    }

    private static String burnPercent(String rate) {
        try {
            BigDecimal pct = new BigDecimal(rate).multiply(BigDecimal.valueOf(100));
            return pct.stripTrailingZeros().toPlainString();
        } catch (NumberFormatException e) {
            return "0";
        }
    }
}
