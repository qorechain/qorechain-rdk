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

    /** Protocol switches of the chain v3.2.7 and v3.2.8 RDK features, as {@code x/pqc} reports them. */
    public static final class RdkFeatures {
        private RdkFeatures() {}

        public static final String ZK_VERIFICATION_KEY = "rdk-zk-verification-key";
        public static final String POST_ROLLUP_DATA = "rdk-post-rollup-data";
        public static final String BASED_SEQUENCING = "rdk-based-sequencing";
        public static final String OPTIMISTIC_REEXEC = "rdk-optimistic-reexec";
        public static final String STARK_STATEMENT = "rdk-stark-statement";
        public static final String PRIVATE_ROLLUPS = "rdk-private-rollups";
        public static final String ZK_CANONICAL_INPUTS = "rdk-zk-canonical-inputs";
        public static final String MAX_BATCHES_PER_BLOCK = "rdk-max-batches-per-block";
    }

    /**
     * Default posted-data retention (chain v3.2.8), in blocks. A set value is {@link
     * #MIN_POSTED_DATA_RETENTION_BLOCKS} to {@link #MAX_POSTED_DATA_RETENTION_BLOCKS} blocks and at
     * least the longest challenge window in force, counted as one block per second.
     */
    public static final long DEFAULT_POSTED_DATA_RETENTION_BLOCKS = 648_000L;

    /** Smallest posted-data retention a parameter change may set, in blocks (chain v3.2.8). */
    public static final long MIN_POSTED_DATA_RETENTION_BLOCKS = 100L;

    /** Largest posted-data retention a parameter change may set, in blocks (chain v3.2.8). */
    public static final long MAX_POSTED_DATA_RETENTION_BLOCKS = 25_920_000L;

    /** Smallest {@code MsgDepositToRollup} amount, in uqor (1 QOR). */
    public static final long MIN_ROLLUP_DEPOSIT_UQOR = 1_000_000L;

    /** Default {@code min_submitter_bond}, in uqor (1,000 QOR); read the live value from {@code rdk.params()}. */
    public static final long DEFAULT_MIN_SUBMITTER_BOND_UQOR = 1_000_000_000L;
}
