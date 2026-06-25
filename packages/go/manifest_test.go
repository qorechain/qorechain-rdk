package rdk

import "testing"

func TestManifestRoundTrip(t *testing.T) {
	cfg, err := PresetDefi().SetRollupID("my-rollup").SetStakeAmountUqor("10000000000").Build()
	if err != nil {
		t.Fatal(err)
	}
	m := ToManifest(cfg, ToManifestOptions{
		Network:   "testnet",
		ChainID:   TestnetChainID,
		Endpoints: &Endpoints{Rest: "http://localhost:1317"},
		Addresses: map[string]string{"creator": "qor1creator"},
		CreatedAt: "2026-06-25T00:00:00Z",
		Notes:     []string{"hello"},
	})
	if m.Schema != ManifestSchema || m.Version != 1 {
		t.Fatalf("unexpected manifest header: %+v", m)
	}

	data, err := StringifyManifest(m)
	if err != nil {
		t.Fatal(err)
	}
	if data[len(data)-1] != '\n' {
		t.Error("expected trailing newline")
	}

	parsed, err := ParseManifest(data)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Config.RollupID != "my-rollup" || parsed.Config.Profile != ProfileDefi {
		t.Errorf("round-trip lost config: %+v", parsed.Config)
	}
	if parsed.ChainID != TestnetChainID || parsed.Addresses["creator"] != "qor1creator" {
		t.Errorf("round-trip lost metadata: %+v", parsed)
	}

	b, err := FromManifest(parsed)
	if err != nil {
		t.Fatal(err)
	}
	rebuilt, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	if rebuilt.RollupID != cfg.RollupID || rebuilt.Settlement != cfg.Settlement {
		t.Errorf("rebuilt config mismatch: %+v vs %+v", rebuilt, cfg)
	}
}

func TestFromManifestRejectsBadSchema(t *testing.T) {
	if _, err := FromManifest(RollupManifest{Schema: "nope"}); err == nil {
		t.Error("expected error for bad schema")
	}
}
