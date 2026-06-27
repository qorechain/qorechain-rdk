package io.github.qorechain.rdk;

import com.google.gson.Gson;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/** Loads the {@code golden.json} cross-language fixture from test resources. */
final class Golden {
    String mnemonic;
    String nativeAddress;
    String privateKeyHex;
    Map<String, String> denom;
    Map<String, String> economics;
    MerkleSection merkle;
    Map<String, String> msgProtoHex;
    Map<String, Map<String, Object>> presetDefaults;
    AnchorSignBytesSection anchorSignBytes;
    MldsaVectorSection mldsaVector;

    static final class MerkleSection {
        List<String> leavesHex;
        String root;
        List<String> proofIndex1Siblings;
    }

    static final class AnchorSignBytesSection {
        String layerId;
        long layerHeight;
        String stateRoot;
        String validatorSetHash;
        String expectedHex;
    }

    static final class MldsaVectorSection {
        String algorithm;
        String messageUtf8;
        String publicKeyHex;
        String signatureHex;
    }

    static Golden load() {
        try (InputStream in = Golden.class.getResourceAsStream("/golden.json")) {
            if (in == null) {
                throw new IllegalStateException("golden.json not found on classpath");
            }
            return new Gson().fromJson(new InputStreamReader(in, StandardCharsets.UTF_8), Golden.class);
        } catch (Exception e) {
            throw new RuntimeException("failed to load golden.json", e);
        }
    }
}
