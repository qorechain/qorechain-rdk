package io.github.qorechain.rdk.client;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.lang.reflect.Type;
import java.util.LinkedHashMap;
import java.util.Map;

/** Shared Gson helpers for parsing loosely-typed JSON payloads. */
public final class Json {
    private Json() {}

    public static final Gson GSON = new Gson();

    private static final Type MAP_TYPE = new TypeToken<Map<String, Object>>() {}.getType();

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String json) {
        if (json == null || json.isBlank()) {
            return new LinkedHashMap<>();
        }
        Object parsed = GSON.fromJson(json, Object.class);
        if (parsed instanceof Map) {
            return (Map<String, Object>) parsed;
        }
        return new LinkedHashMap<>();
    }

    public static String stringify(Object value) {
        return GSON.toJson(value);
    }
}
