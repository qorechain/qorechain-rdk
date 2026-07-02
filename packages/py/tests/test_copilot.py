"""QCAI rollup copilot: best-effort aggregation and graceful degradation."""

from __future__ import annotations

import json

from qorrdk import create_rdk_client, get_rollup_advice
from qorrdk.client.http import HttpResponse


class _MockTransport:
    def __init__(self, routes, rl_status=None):
        self._routes = routes
        self._rl_status = rl_status

    def __call__(self, method, url, headers=None, body=None):
        if method == "POST":
            req = json.loads(body)
            if req["method"] == "qor_getRLAgentStatus" and self._rl_status is not None:
                return HttpResponse(200, "OK", json.dumps({"result": self._rl_status}))
            return HttpResponse(
                200, "OK", json.dumps({"error": {"code": -32601, "message": "no method"}})
            )
        for (m, needle), payload in self._routes.items():
            if m == method and needle in url:
                return HttpResponse(200, "OK", json.dumps(payload))
        return HttpResponse(404, "Not Found", json.dumps({"error": "no route"}))


def test_advice_aggregates_and_flags_fraud_and_congestion():
    routes = {
        ("GET", "/qorechain/rdk/v1/rollup/r1"): {
            "rollup": {"rollup_id": "r1", "status": "paused", "layer_id": "L1"}
        },
        ("GET", "/qorechain/ai/v1/fee-estimate"): {"gas_price": "0.15uqor"},
        ("GET", "/qorechain/ai/v1/network/recommendations"): {
            "note": "network is congested, raise fees"
        },
        ("GET", "/qorechain/ai/v1/fraud/investigations"): {
            "investigations": [
                {"id": "f1", "target": "r1"},
                {"id": "f2", "target": "other"},
            ]
        },
    }
    client = create_rdk_client(transport=_MockTransport(routes, rl_status={"epoch": 5}))
    advice = get_rollup_advice(client, "r1")

    assert advice.rollup_id == "r1"
    assert advice.status == "paused"
    assert advice.fee_estimate == {"gas_price": "0.15uqor"}
    assert advice.rl_agent_status == {"epoch": 5}
    # Only the fraud investigation that mentions r1.
    assert len(advice.fraud_investigations) == 1
    assert advice.fraud_investigations[0]["id"] == "f1"

    levels = {s.level for s in advice.suggestions}
    assert "warn" in levels  # paused status + congestion
    assert "action" in levels  # fraud
    assert "info" in levels  # fee estimate
    assert advice.warnings == []


def test_advice_degrades_to_warnings_when_surfaces_fail():
    # Everything 404s / RL errors -> warnings, no raise.
    client = create_rdk_client(transport=_MockTransport({}))
    advice = get_rollup_advice(client, "rX")

    assert advice.status == "unknown"
    assert advice.fee_estimate is None
    assert advice.fraud_investigations == []
    assert len(advice.warnings) >= 1
    # A default info suggestion is always present.
    assert any(s.level == "info" for s in advice.suggestions)
