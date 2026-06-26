package io.github.qorechain.rdk.config;

import java.util.Collections;
import java.util.List;

/** The outcome of validating a {@link RollupConfig}. */
public class ValidationResult {
    /** True when there are no errors (warnings do not affect validity). */
    public final boolean valid;
    /** Hard failures that block submission. */
    public final List<String> errors;
    /** Non-fatal notices (e.g. selecting a not-yet-active DA backend). */
    public final List<String> warnings;

    public ValidationResult(boolean valid, List<String> errors, List<String> warnings) {
        this.valid = valid;
        this.errors = Collections.unmodifiableList(errors);
        this.warnings = Collections.unmodifiableList(warnings);
    }
}
