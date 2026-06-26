package io.github.qorechain.rdk.manifest;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonDeserializer;
import com.google.gson.JsonPrimitive;
import com.google.gson.JsonSerializer;
import io.github.qorechain.rdk.config.Enums.DABackend;
import io.github.qorechain.rdk.config.Enums.GasModel;
import io.github.qorechain.rdk.config.Enums.ProfileName;
import io.github.qorechain.rdk.config.Enums.ProofSystem;
import io.github.qorechain.rdk.config.Enums.SequencerMode;
import io.github.qorechain.rdk.config.Enums.SettlementParadigm;
import io.github.qorechain.rdk.config.Enums.VmType;
import io.github.qorechain.rdk.config.Networks.Endpoints;
import io.github.qorechain.rdk.config.RollupConfig;
import io.github.qorechain.rdk.config.RollupConfigBuilder;
import java.util.List;
import java.util.Map;

/**
 * Rollup manifest — a portable JSON snapshot of a rollup's resolved configuration, target network,
 * endpoints, and key addresses. The {@code rollup.json}/node-config equivalent for this kit: save
 * it, share it, and load it back into a config builder.
 */
public final class Manifest {
    private Manifest() {}

    /** The schema identifier stamped on a rollup manifest. */
    public static final String MANIFEST_SCHEMA = "qorechain-rdk/rollup-manifest";

    /**
     * A Gson instance that (de)serializes the {@code rdk} enums as their wire strings. Shared by the
     * manifest and any caller that needs to round-trip a {@link RollupConfig}.
     */
    public static final Gson GSON =
            new GsonBuilder()
                    .registerTypeAdapter(SettlementParadigm.class, enumAdapter(SettlementParadigm::fromWire))
                    .registerTypeAdapter(SequencerMode.class, enumAdapter(SequencerMode::fromWire))
                    .registerTypeAdapter(ProofSystem.class, enumAdapter(ProofSystem::fromWire))
                    .registerTypeAdapter(DABackend.class, enumAdapter(DABackend::fromWire))
                    .registerTypeAdapter(GasModel.class, enumAdapter(GasModel::fromWire))
                    .registerTypeAdapter(VmType.class, enumAdapter(VmType::fromWire))
                    .registerTypeAdapter(ProfileName.class, enumAdapter(ProfileName::fromWire))
                    .disableHtmlEscaping()
                    .create();

    private interface FromWire<E> {
        E apply(String wire);
    }

    /** Combines a serializer and deserializer so a single registration covers both directions. */
    private static final class EnumTypeAdapter<E>
            implements JsonSerializer<E>, JsonDeserializer<E> {
        private final FromWire<E> fromWire;

        EnumTypeAdapter(FromWire<E> fromWire) {
            this.fromWire = fromWire;
        }

        @Override
        public com.google.gson.JsonElement serialize(
                E src, java.lang.reflect.Type typeOfSrc, com.google.gson.JsonSerializationContext context) {
            return src == null ? null : new JsonPrimitive(invokeWire(src));
        }

        @Override
        public E deserialize(
                com.google.gson.JsonElement json,
                java.lang.reflect.Type typeOfT,
                com.google.gson.JsonDeserializationContext context) {
            return fromWire.apply(json.getAsString());
        }
    }

    private static <E> EnumTypeAdapter<E> enumAdapter(FromWire<E> fromWire) {
        return new EnumTypeAdapter<>(fromWire);
    }

    private static String invokeWire(Object enumValue) {
        if (enumValue instanceof SettlementParadigm) {
            return ((SettlementParadigm) enumValue).wire();
        }
        if (enumValue instanceof SequencerMode) {
            return ((SequencerMode) enumValue).wire();
        }
        if (enumValue instanceof ProofSystem) {
            return ((ProofSystem) enumValue).wire();
        }
        if (enumValue instanceof DABackend) {
            return ((DABackend) enumValue).wire();
        }
        if (enumValue instanceof GasModel) {
            return ((GasModel) enumValue).wire();
        }
        if (enumValue instanceof VmType) {
            return ((VmType) enumValue).wire();
        }
        if (enumValue instanceof ProfileName) {
            return ((ProfileName) enumValue).wire();
        }
        return String.valueOf(enumValue);
    }

    /** A portable JSON snapshot of a rollup configuration. */
    public static final class RollupManifest {
        public String schema;
        public int version;
        public String network;
        public String chainId;
        public Endpoints endpoints;
        public RollupConfig config;
        public Map<String, String> addresses;
        public String createdAt;
        public List<String> notes;
    }

    /** The non-config inputs for {@link #toManifest}. */
    public static final class ToManifestOptions {
        public String network;
        public String chainId;
        public Endpoints endpoints;
        public Map<String, String> addresses;
        public String createdAt;
        public List<String> notes;
    }

    /** Build a manifest from a resolved config. */
    public static RollupManifest toManifest(RollupConfig config, ToManifestOptions options) {
        RollupManifest m = new RollupManifest();
        m.schema = MANIFEST_SCHEMA;
        m.version = 1;
        m.network = options.network;
        m.chainId = options.chainId;
        m.endpoints = options.endpoints;
        m.config = config;
        m.addresses = options.addresses;
        m.createdAt = options.createdAt;
        m.notes = options.notes;
        return m;
    }

    /** Load a manifest into a {@link RollupConfigBuilder}. */
    public static RollupConfigBuilder fromManifest(RollupManifest manifest) {
        if (manifest == null || !MANIFEST_SCHEMA.equals(manifest.schema)) {
            throw new IllegalArgumentException("not a qorechain-rdk rollup manifest");
        }
        return new RollupConfigBuilder(manifest.config);
    }

    /** Parse a manifest from JSON text. */
    public static RollupManifest parseManifest(String json) {
        return GSON.fromJson(json, RollupManifest.class);
    }

    /** Serialize a manifest to pretty JSON (trailing newline). */
    public static String stringifyManifest(RollupManifest manifest) {
        Gson pretty = GSON.newBuilder().setPrettyPrinting().create();
        return pretty.toJson(manifest) + "\n";
    }
}
