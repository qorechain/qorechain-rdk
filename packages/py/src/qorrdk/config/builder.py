"""A fluent builder for a :class:`RollupConfig`."""

from __future__ import annotations

from typing import Optional

from ..enums import ProfileName, VmType
from .errors import RollupConfigError
from .types import CreateRollupMsgInput, RollupConfig, SequencerParams
from .validate import (
    ValidationResult,
    assert_valid_rollup_config,
    validate_rollup_config,
)

_UNSET = object()


class RollupConfigBuilder:
    """A fluent builder for a :class:`RollupConfig`.

    Presets return a builder pre-filled with their defaults; override fields with
    :meth:`set`, inspect with :meth:`validation_result`, and produce a config with
    :meth:`build` or an on-chain create message with :meth:`to_create_msg`.
    """

    def __init__(self, initial: RollupConfig) -> None:
        self._config = initial.copy()

    def set(self, **overrides: object) -> "RollupConfigBuilder":
        """Merge field overrides. Nested ``sequencer_params`` are merged, not replaced."""
        sequencer_params = overrides.pop("sequencer_params", _UNSET)
        for key, value in overrides.items():
            if not hasattr(self._config, key):
                raise RollupConfigError([f'unknown config field "{key}"'])
            setattr(self._config, key, value)
        if sequencer_params is not _UNSET:
            incoming = sequencer_params
            if incoming is None:
                self._config.sequencer_params = None
            elif isinstance(incoming, dict):
                incoming = SequencerParams(**incoming)
                base = self._config.sequencer_params
                self._config.sequencer_params = (
                    base.merged(incoming) if base else incoming
                )
            elif isinstance(incoming, SequencerParams):
                base = self._config.sequencer_params
                self._config.sequencer_params = (
                    base.merged(incoming) if base else incoming.copy()
                )
            else:  # pragma: no cover - defensive
                raise RollupConfigError(["sequencer_params must be a SequencerParams or dict"])
        return self

    def get(self) -> RollupConfig:
        """A snapshot copy of the current (not necessarily valid) configuration."""
        return self._config.copy()

    def validation_result(self) -> ValidationResult:
        """The structured validation result for the current configuration."""
        return validate_rollup_config(self._config)

    def validate(self) -> "RollupConfigBuilder":
        """Validate, raising :class:`RollupConfigError` on any error. Returns ``self``."""
        assert_valid_rollup_config(self._config)
        return self

    def build(self) -> RollupConfig:
        """Validate and return a copy of the configuration."""
        assert_valid_rollup_config(self._config)
        return self._config.copy()

    def to_create_msg(
        self, creator: str, stake_amount: Optional[str] = None
    ) -> CreateRollupMsgInput:
        """Build the inputs for an on-chain ``MsgCreateRollup``.

        Requires a stake amount, either on the config (``stake_amount_uqor``) or
        via ``stake_amount``. Read the minimum from the chain with ``rdk.params()``.
        """
        assert_valid_rollup_config(self._config)
        amount = stake_amount if stake_amount is not None else self._config.stake_amount_uqor
        if not amount:
            raise RollupConfigError(
                [
                    "a stake amount is required to build a create message; set "
                    "stake_amount_uqor or pass stake_amount (read the minimum from "
                    "rdk.params())"
                ]
            )
        return CreateRollupMsgInput(
            creator=creator,
            rollup_id=self._config.rollup_id,
            profile=ProfileName(self._config.profile),
            vm_type=VmType(self._config.vm_type),
            stake_amount=amount,
        )


__all__ = ["RollupConfigBuilder"]
