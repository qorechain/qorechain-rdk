"""Minimal HTTP abstraction so the read clients are easy to mock and test.

A :class:`Transport` is any callable ``(method, url, headers, body) ->
HttpResponse``. The default uses :mod:`requests` if available, falling back to
:mod:`urllib`. Tests inject a fake transport.
"""

from __future__ import annotations

import json as _json
from dataclasses import dataclass
from typing import Any, Callable, Optional, Protocol


@dataclass
class HttpResponse:
    """The subset of an HTTP response the clients use."""

    status: int
    status_text: str
    body_text: str

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def json(self) -> Any:
        return _json.loads(self.body_text) if self.body_text else None


class Transport(Protocol):
    """A pluggable HTTP transport."""

    def __call__(
        self,
        method: str,
        url: str,
        headers: Optional[dict[str, str]] = None,
        body: Optional[str] = None,
    ) -> HttpResponse:
        ...


def _requests_transport(
    method: str,
    url: str,
    headers: Optional[dict[str, str]] = None,
    body: Optional[str] = None,
) -> HttpResponse:
    import requests

    resp = requests.request(method, url, headers=headers, data=body, timeout=30)
    return HttpResponse(
        status=resp.status_code,
        status_text=resp.reason or "",
        body_text=resp.text,
    )


def _urllib_transport(
    method: str,
    url: str,
    headers: Optional[dict[str, str]] = None,
    body: Optional[str] = None,
) -> HttpResponse:
    import urllib.error
    import urllib.request

    data = body.encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
            text = resp.read().decode("utf-8")
            return HttpResponse(status=resp.status, status_text=resp.reason or "", body_text=text)
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8") if exc.fp else ""
        return HttpResponse(status=exc.code, status_text=exc.reason or "", body_text=text)


def default_transport() -> Transport:
    """Return the default transport (requests if installed, else urllib)."""
    try:
        import requests  # noqa: F401

        return _requests_transport
    except ImportError:  # pragma: no cover - fallback path
        return _urllib_transport


__all__ = ["HttpResponse", "Transport", "default_transport"]
