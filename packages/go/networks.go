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

var localhostEndpoints = Endpoints{
	Rest:   "http://localhost:1317",
	RPC:    "http://localhost:26657",
	GRPC:   "localhost:9090",
	EvmRPC: "http://localhost:8545",
}

// Networks are the built-in network presets. Endpoint defaults point at
// localhost; override them to reach a real node.
var Networks = map[string]NetworkConfig{
	"testnet": {Name: "testnet", ChainID: TestnetChainID, Endpoints: localhostEndpoints},
	"mainnet": {Name: "mainnet", ChainID: MainnetChainID, Endpoints: localhostEndpoints},
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
