package rdk

// Endpoints are the endpoint URLs the RDK talks to.
type Endpoints struct {
	// Rest is the Cosmos REST (LCD) endpoint: rollup/batch/DA/params reads.
	Rest string `json:"rest,omitempty"`
	// RPC is the consensus RPC endpoint: transaction broadcast.
	RPC string `json:"rpc,omitempty"`
	// GRPC is the gRPC host:port for typed queries (parity with REST).
	GRPC string `json:"grpc,omitempty"`
	// EvmRPC is the EVM + qor_ JSON-RPC endpoint: the custom qor_* methods.
	EvmRPC string `json:"evmRpc,omitempty"`
}

// NetworkConfig is a resolved network: its chain id and endpoints.
type NetworkConfig struct {
	Name    string `json:"name"`
	ChainID string `json:"chainId"`
	// AnchorSignV2Height is the Main Chain height at which this network
	// switched the canonical anchor message from v1 to v2 (the chain's
	// rdk-integrity feature, shipped in v3.2.2). An anchor recorded at or above
	// this height is signed over the v2 message; below it, v1. A fresh chain
	// enables the feature at genesis, so 0 is right for a local network.
	AnchorSignV2Height uint64    `json:"anchorSignV2Height"`
	Endpoints          Endpoints `json:"endpoints"`
}

// LocalhostEndpoints are the defaults for running against a local node.
// Override a preset's Endpoints with these for local development.
var LocalhostEndpoints = Endpoints{
	Rest:   "http://localhost:1317",
	RPC:    "http://localhost:26657",
	GRPC:   "localhost:9090",
	EvmRPC: "http://localhost:8545",
}

// mainnetEndpoints are the public mainnet endpoints (qorechain-vladi).
var mainnetEndpoints = Endpoints{
	Rest:   "https://api.qore.host",
	RPC:    "https://rpc.qore.host",
	GRPC:   "grpc.qore.host:443",
	EvmRPC: "https://evm.qore.host",
}

// testnetEndpoints are the public testnet endpoints (qorechain-diana).
var testnetEndpoints = Endpoints{
	Rest:   "https://api-testnet.qore.host",
	RPC:    "https://rpc-testnet.qore.host",
	GRPC:   "grpc-testnet.qore.host:443",
	EvmRPC: "https://evm-testnet.qore.host",
}

// Networks are the built-in network presets. Each ships the network's public
// endpoints so GetNetwork works out of the box; override a preset's Endpoints
// with LocalhostEndpoints to reach a local node, or with your own
// infrastructure.
var Networks = map[string]NetworkConfig{
	// rdk-integrity applied on qorechain-diana at height 6905034 (2026-10-02)
	// and on qorechain-vladi at height 3556788 (2026-10-16).
	"testnet": {Name: "testnet", ChainID: TestnetChainID, Endpoints: testnetEndpoints, AnchorSignV2Height: 6_905_034},
	"mainnet": {Name: "mainnet", ChainID: MainnetChainID, Endpoints: mainnetEndpoints, AnchorSignV2Height: 3_556_788},
}

// GetNetwork looks up a network preset by name. An empty name defaults to
// testnet. The returned config is a copy.
func GetNetwork(name string) NetworkConfig {
	if name == "" {
		name = "testnet"
	}
	net, ok := Networks[name]
	if !ok {
		net = Networks["testnet"]
	}
	return net
}

// ListNetworks lists the available network names.
func ListNetworks() []string {
	return []string{"testnet", "mainnet"}
}
