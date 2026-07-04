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
	Name      string    `json:"name"`
	ChainID   string    `json:"chainId"`
	Endpoints Endpoints `json:"endpoints"`
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
	"testnet": {Name: "testnet", ChainID: TestnetChainID, Endpoints: testnetEndpoints},
	"mainnet": {Name: "mainnet", ChainID: MainnetChainID, Endpoints: mainnetEndpoints},
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
