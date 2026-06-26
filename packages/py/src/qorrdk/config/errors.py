"""Configuration errors."""

from __future__ import annotations


class RollupConfigError(ValueError):
    """Raised when a rollup configuration fails validation."""

    def __init__(self, errors: list[str]) -> None:
        joined = "\n- ".join(errors)
        super().__init__(f"Invalid rollup configuration:\n- {joined}")
        #: The individual validation failures.
        self.errors = list(errors)


__all__ = ["RollupConfigError"]
