package io.github.qorechain.rdk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import io.github.qorechain.rdk.config.Enums.ProfileName;
import io.github.qorechain.rdk.config.RollupConfig;
import io.github.qorechain.rdk.manifest.Manifest;
import io.github.qorechain.rdk.presets.Presets;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PresetsTest {

    @Test
    void everyPresetMatchesGoldenDefaults() {
        Golden g = Golden.load();
        for (ProfileName name : ProfileName.values()) {
            Map<String, Object> expected = g.presetDefaults.get(name.wire());
            assertNotNull(expected, "golden missing preset " + name.wire());

            RollupConfig config = Presets.preset(name, null).get();
            // Serialize via the wire-string Gson so enums render as the chain's strings.
            @SuppressWarnings("unchecked")
            Map<String, Object> actual = Manifest.GSON.fromJson(Manifest.GSON.toJson(config), Map.class);

            for (Map.Entry<String, Object> e : expected.entrySet()) {
                Object exp = e.getValue();
                Object act = actual.get(e.getKey());
                assertEquals(
                        normalize(exp),
                        normalize(act),
                        "preset " + name.wire() + " field " + e.getKey());
            }
        }
    }

    private static Object normalize(Object v) {
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (d == Math.floor(d)) {
                return (long) d;
            }
        }
        return v;
    }
}
