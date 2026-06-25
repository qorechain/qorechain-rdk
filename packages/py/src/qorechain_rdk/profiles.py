"""QCAI-assisted profile suggestion.

Wraps the ``qor_suggestRollupProfile`` advisory call, normalizing its response to
a known profile name. If the advisory service is unavailable or returns an
unrecognized value, it falls back to a documented default (``defi``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from .client.jsonrpc import QorClient
from .enums import PROFILE_NAMES, ProfileName


@dataclass
class ProfileSuggestion:
    """The result of a profile suggestion."""

    #: The recommended profile.
    profile: ProfileName
    #: Whether the suggestion came from the advisory service or the fallback.
    source: str  # "advisory" | "fallback"
    #: The raw advisory response (or error message), for transparency.
    raw: Any = None


def _is_profile_name(value: Any) -> bool:
    return isinstance(value, str) and value in PROFILE_NAMES


def _extract_profile(result: Any) -> Optional[ProfileName]:
    if _is_profile_name(result):
        return ProfileName(result)
    if isinstance(result, dict):
        candidate = (
            result.get("profile")
            or result.get("suggestedProfile")
            or result.get("suggested_profile")
            or result.get("recommendation")
        )
        if _is_profile_name(candidate):
            return ProfileName(candidate)
    return None


def suggest_profile(
    use_case: str,
    qor: QorClient,
    fallback: ProfileName = ProfileName.DEFI,
) -> ProfileSuggestion:
    """Suggest a rollup profile from a plain-language use-case description."""
    try:
        result = qor.suggest_rollup_profile(use_case)
    except Exception as exc:  # noqa: BLE001 - surfaced as fallback raw
        return ProfileSuggestion(profile=fallback, source="fallback", raw=str(exc))
    profile = _extract_profile(result)
    if profile is not None:
        return ProfileSuggestion(profile=profile, source="advisory", raw=result)
    return ProfileSuggestion(profile=fallback, source="fallback", raw=result)


__all__ = ["ProfileSuggestion", "suggest_profile"]
