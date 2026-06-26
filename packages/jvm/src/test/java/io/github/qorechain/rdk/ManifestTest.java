package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.qorechain.rdk.config.RollupConfig;
import io.github.qorechain.rdk.manifest.Manifest;
import io.github.qorechain.rdk.manifest.Manifest.RollupManifest;
import io.github.qorechain.rdk.manifest.Manifest.ToManifestOptions;
import io.github.qorechain.rdk.presets.Presets;
import org.junit.jupiter.api.Test;

class ManifestTest {

    @Test
    void roundTripsThroughJson() {
        RollupConfig config = Presets.defi(c -> c.rollupId = "my-rollup").stakeAmountUqor("10000000000").get();
        ToManifestOptions opts = new ToManifestOptions();
        opts.network = "testnet";
        opts.chainId = "qorechain-diana";
        RollupManifest manifest = Manifest.toManifest(config, opts);

        String json = Manifest.stringifyManifest(manifest);
        assertTrue(json.endsWith("\n"));
        assertTrue(json.contains("\"settlement\": \"zk\""));

        RollupManifest parsed = Manifest.parseManifest(json);
        assertEquals(Manifest.MANIFEST_SCHEMA, parsed.schema);
        assertEquals("my-rollup", parsed.config.rollupId);

        RollupConfig rebuilt = Manifest.fromManifest(parsed).get();
        assertEquals(config.rollupId, rebuilt.rollupId);
        assertEquals(config.settlement, rebuilt.settlement);
        assertEquals(config.proofSystem, rebuilt.proofSystem);
        assertEquals(config.vmType, rebuilt.vmType);
        assertEquals(config.stakeAmountUqor, rebuilt.stakeAmountUqor);
    }
}
