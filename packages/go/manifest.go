package rdk

import (
	"encoding/json"
	"errors"
)

// ManifestSchema is the schema identifier stamped on a rollup manifest.
const ManifestSchema = "qorechain-rdk/rollup-manifest"

// RollupManifest is a portable JSON snapshot of a rollup's resolved
// configuration, target network, endpoints, and key addresses. It is the
// rollup.json/node-config equivalent for this kit: save it, share it, and load
// it back into a config builder.
type RollupManifest struct {
	Schema    string            `json:"schema"`
	Version   int               `json:"version"`
	Network   string            `json:"network"`
	ChainID   string            `json:"chainId,omitempty"`
	Endpoints *Endpoints        `json:"endpoints,omitempty"`
	Config    RollupConfig      `json:"config"`
	Addresses map[string]string `json:"addresses,omitempty"`
	CreatedAt string            `json:"createdAt,omitempty"`
	Notes     []string          `json:"notes,omitempty"`
}

// ToManifestOptions holds the non-config inputs for ToManifest.
type ToManifestOptions struct {
	Network   string
	ChainID   string
	Endpoints *Endpoints
	Addresses map[string]string
	CreatedAt string
	Notes     []string
}

// ToManifest builds a manifest from a resolved config.
func ToManifest(config RollupConfig, options ToManifestOptions) RollupManifest {
	return RollupManifest{
		Schema:    ManifestSchema,
		Version:   1,
		Network:   options.Network,
		ChainID:   options.ChainID,
		Endpoints: options.Endpoints,
		Config:    config,
		Addresses: options.Addresses,
		CreatedAt: options.CreatedAt,
		Notes:     options.Notes,
	}
}

// FromManifest loads a manifest into a RollupConfigBuilder.
func FromManifest(manifest RollupManifest) (*RollupConfigBuilder, error) {
	if manifest.Schema != ManifestSchema {
		return nil, errors.New("not a qorechain-rdk rollup manifest")
	}
	return NewRollupConfigBuilder(manifest.Config), nil
}

// ParseManifest parses a manifest from JSON text.
func ParseManifest(data []byte) (RollupManifest, error) {
	var m RollupManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return RollupManifest{}, err
	}
	return m, nil
}

// StringifyManifest serializes a manifest to pretty JSON (trailing newline).
func StringifyManifest(manifest RollupManifest) ([]byte, error) {
	out, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(out, '\n'), nil
}
