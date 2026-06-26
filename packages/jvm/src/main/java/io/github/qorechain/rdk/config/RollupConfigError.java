package io.github.qorechain.rdk.config;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Thrown when a rollup configuration fails validation. */
public class RollupConfigError extends RuntimeException {
    private final List<String> errors;

    public RollupConfigError(List<String> errors) {
        super("Invalid rollup configuration:\n- " + String.join("\n- ", errors));
        this.errors = Collections.unmodifiableList(new ArrayList<>(errors));
    }

    /** The individual validation failures. */
    public List<String> errors() {
        return errors;
    }
}
