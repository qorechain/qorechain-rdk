package rdk

// Network and module constants for the QoreChain rdk module.
//
// The parameter values here are the network's documented defaults. They are NOT
// a substitute for the live chain state: always read the authoritative values
// with the rdk params query surface before acting on them.

// Version is the RDK package version (kept in lockstep with the TypeScript RDK).
const Version = "0.4.0"

const (
	// DisplayDenom is the display denomination.
	DisplayDenom = "QOR"

	// BaseDenom is the base denomination.
	BaseDenom = "uqor"

	// DenomExponent is the number of base units per display unit (10^6).
	DenomExponent = 6

	// AccountPrefix is the Bech32 prefix for account addresses.
	AccountPrefix = "qor"

	// ValidatorPrefix is the Bech32 prefix for validator addresses.
	ValidatorPrefix = "qorvaloper"
)

// Named networks and their chain ids. The RDK defaults to testnet.
const (
	// TestnetChainID is the testnet chain id.
	TestnetChainID = "qorechain-diana"

	// MainnetChainID is the mainnet chain id.
	MainnetChainID = "qorechain-vladi"
)

// ChainIDs maps network names to their chain ids.
var ChainIDs = map[string]string{
	"testnet": TestnetChainID,
	"mainnet": MainnetChainID,
}

// Documented defaults for the rdk module parameters. Read the live values from
// the chain with the rdk params query surface; treat these as reference only.
const (
	// DefaultMaxRollups is the maximum number of registered rollups.
	DefaultMaxRollups = 100

	// DefaultMinStakeForRollupUqor is the minimum stake to create a rollup,
	// in uqor (10,000 QOR).
	DefaultMinStakeForRollupUqor = "10000000000"

	// DefaultRollupCreationBurnRate is the fraction of stake burned on
	// creation, as a decimal string (1%).
	DefaultRollupCreationBurnRate = "0.01"

	// DefaultChallengeWindowSecs is the default optimistic challenge window,
	// in seconds (7 days).
	DefaultChallengeWindowSecs = 604800

	// DefaultMaxDaBlobSize is the maximum data-availability blob size, in
	// bytes (2 MiB).
	DefaultMaxDaBlobSize = 2097152

	// DefaultBlobRetentionBlocks is the number of blocks before expired DA
	// blobs are pruned (~30 days at 6s blocks).
	DefaultBlobRetentionBlocks = 432000

	// DefaultMaxBatchesPerBlock is the maximum settlement batches accepted
	// per block.
	DefaultMaxBatchesPerBlock = 10

	// DefaultChallengeBondUqor is the default optimistic challenge bond, in
	// uqor (1,000 QOR).
	DefaultChallengeBondUqor = "1000000000"
)
