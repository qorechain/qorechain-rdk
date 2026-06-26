package io.github.qorechain.rdk.config;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Network and module constants for the QoreChain {@code rdk} module.
 *
 * <p>The parameter values here are the network's documented defaults. They are NOT a substitute
 * for the live chain state: always read the authoritative values with the {@code rdk params}
 * query surface before acting on them.
 */
public final class Constants {
    private Constants() {}

    /** Display denomination. */
    public static final String DISPLAY_DENOM = "QOR";

    /** Base denomination. */
    public static final String BASE_DENOM = "uqor";

    /** Base units per display unit (10^6). */
    public static final int DENOM_EXPONENT = 6;

    /** Bech32 prefix for account addresses. */
    public static final String ACCOUNT_PREFIX = "qor";

    /** Bech32 prefix for validator addresses. */
    public static final String VALIDATOR_PREFIX = "qorvaloper";

    /** Testnet chain id. */
    public static final String TESTNET_CHAIN_ID = "qorechain-diana";

    /** Mainnet chain id. */
    public static final String MAINNET_CHAIN_ID = "qorechain-vladi";

    /** Network names mapped to chain ids. */
    public static final Map<String, String> CHAIN_IDS;

    static {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("testnet", TESTNET_CHAIN_ID);
        m.put("mainnet", MAINNET_CHAIN_ID);
        CHAIN_IDS = Collections.unmodifiableMap(m);
    }

    /** Maximum number of registered rollups. */
    public static final int DEFAULT_MAX_ROLLUPS = 100;

    /** Minimum stake to create a rollup, in uqor (10,000 QOR). */
    public static final String DEFAULT_MIN_STAKE_FOR_ROLLUP_UQOR = "10000000000";

    /** Fraction of stake burned on creation, as a decimal string (1%). */
    public static final String DEFAULT_ROLLUP_CREATION_BURN_RATE = "0.01";

    /** Default optimistic challenge window, in seconds (7 days). */
    public static final int DEFAULT_CHALLENGE_WINDOW_SECS = 604800;

    /** Maximum data-availability blob size, in bytes (2 MiB). */
    public static final int DEFAULT_MAX_DA_BLOB_SIZE = 2097152;

    /** Blocks before expired DA blobs are pruned (~30 days at 6s blocks). */
    public static final int DEFAULT_BLOB_RETENTION_BLOCKS = 432000;

    /** Maximum settlement batches accepted per block. */
    public static final int DEFAULT_MAX_BATCHES_PER_BLOCK = 10;

    /** Default optimistic challenge bond, in uqor (1,000 QOR). */
    public static final String DEFAULT_CHALLENGE_BOND_UQOR = "1000000000";
}
