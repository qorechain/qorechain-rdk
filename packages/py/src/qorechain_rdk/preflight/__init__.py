"""Preflight checks -- the engine behind the ``doctor`` command.

Verifies, in plain language, that a developer is ready to create/operate a
rollup: endpoints reachable, network as expected, module params readable, config
valid, a signer configured, and the operator balance covering the stake plus a
fee buffer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from ..config.types import RollupConfig
from ..config.validate import validate_rollup_config
from ..utils.denom import uqor_to_qor


@dataclass
class PreflightCheck:
    id: str
    label: str
    status: str  # "ok" | "warn" | "fail"
    detail: Optional[str] = None
    hint: Optional[str] = None


@dataclass
class PreflightResult:
    #: True when no check failed (warnings are allowed).
    ok: bool
    checks: list[PreflightCheck] = field(default_factory=list)


def _err(exc: Exception) -> str:
    return str(exc)


def check_preflight(
    client,
    *,
    config: Optional[RollupConfig] = None,
    signer_address: Optional[str] = None,
    expected_network: Optional[str] = None,
    fee_buffer_uqor: str = "1000000",
) -> PreflightResult:
    """Run the preflight checks against an :class:`RdkClient`."""
    checks: list[PreflightCheck] = []
    params = None
    try:
        params = client.params()
        checks.append(
            PreflightCheck(
                id="rest",
                label="REST endpoint reachable",
                status="ok",
                detail=client.network.endpoints.rest,
            )
        )
        burn_pct = float(params.rollup_creation_burn_rate) * 100
        checks.append(
            PreflightCheck(
                id="params",
                label="Module parameters readable",
                status="ok",
                detail=(
                    f"min stake {uqor_to_qor(params.min_stake_for_rollup)} QOR, "
                    f"burn {burn_pct:g}%"
                ),
            )
        )
    except Exception as exc:  # noqa: BLE001
        checks.append(
            PreflightCheck(
                id="rest",
                label="REST endpoint reachable",
                status="fail",
                detail=_err(exc),
                hint="Set QORE_REST_URL to a reachable node REST (LCD) endpoint.",
            )
        )

    if expected_network is not None:
        match = client.network.name == expected_network
        checks.append(
            PreflightCheck(
                id="network",
                label="Network matches expectation",
                status="ok" if match else "warn",
                detail=f"client is {client.network.name} ({client.network.chain_id})",
                hint=None if match else f"Expected {expected_network}.",
            )
        )

    if config is not None:
        r = validate_rollup_config(config)
        if r.valid:
            status = "warn" if r.warnings else "ok"
            detail = r.warnings[0] if r.warnings else "compatibility matrix satisfied"
            hint = None
        else:
            status = "fail"
            detail = r.errors[0]
            hint = "Fix the configuration errors before creating."
        checks.append(
            PreflightCheck(id="config", label="Rollup config valid", status=status, detail=detail, hint=hint)
        )

    if signer_address is not None:
        checks.append(
            PreflightCheck(
                id="signer", label="Signer configured", status="ok", detail=signer_address
            )
        )
        if params is not None:
            try:
                bal = client.rest.get_balance(signer_address)
                stake = int(params.min_stake_for_rollup)
                buffer = int(fee_buffer_uqor)
                required = stake + buffer
                ok = int(bal) >= required
                checks.append(
                    PreflightCheck(
                        id="balance",
                        label="Balance covers stake + fees",
                        status="ok" if ok else "fail",
                        detail=(
                            f"have {uqor_to_qor(bal)} QOR, "
                            f"need ~{uqor_to_qor(str(required))} QOR"
                        ),
                        hint=None if ok else "Fund the operator account (see the keys & funding guide).",
                    )
                )
            except Exception as exc:  # noqa: BLE001
                checks.append(
                    PreflightCheck(
                        id="balance", label="Balance readable", status="warn", detail=_err(exc)
                    )
                )
    else:
        checks.append(
            PreflightCheck(
                id="signer",
                label="Signer configured",
                status="warn",
                detail="no signer",
                hint="Set QORE_OPERATOR_PRIVATE_KEY_HEX or QORE_MNEMONIC to create/operate.",
            )
        )

    return PreflightResult(ok=all(c.status != "fail" for c in checks), checks=checks)


__all__ = ["PreflightCheck", "PreflightResult", "check_preflight"]
