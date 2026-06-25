"""A mock tx backend -- the offline "devnet" equivalent.

Drop it into ``RdkTxClient.from_backend(MockTxClient(address="qor1..."))`` to
exercise the full create/submit/lifecycle flow without a node: it records every
call and returns a successful, fake :class:`BroadcastResult`. Mirrors the TS
``MockTxClient``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .client import BroadcastResult, TxOptions
from .messages import EncodedMsg

_DEFAULT_MOCK_ADDRESS = "qor1mock0000000000000000000000000000000000"
_DEFAULT_GAS_ESTIMATE = 120000
_DEFAULT_TX_HASH = "MOCK_TX_HASH"


@dataclass
class MockCall:
    """One recorded ``sign_and_broadcast`` call, in order."""

    messages: list[EncodedMsg]
    opts: Optional[TxOptions]


class MockTxClient:
    """A sign-and-broadcast backend that records calls and fakes success.

    Implements the :class:`~qorechain_rdk.tx.client.SignAndBroadcastBackend`
    protocol (including ``simulate``), so it can back an
    :class:`~qorechain_rdk.tx.client.RdkTxClient` via ``from_backend``.
    """

    def __init__(
        self,
        *,
        address: str = _DEFAULT_MOCK_ADDRESS,
        gas_estimate: int = _DEFAULT_GAS_ESTIMATE,
        tx_hash: str = _DEFAULT_TX_HASH,
    ) -> None:
        #: The signer/operator address reported to the wrapping client.
        self.address = address
        #: Gas returned from :meth:`simulate` and reported as used.
        self.gas_estimate = gas_estimate
        self._tx_hash = tx_hash
        #: Every ``sign_and_broadcast`` call, in order.
        self.calls: list[MockCall] = []

    def sign_and_broadcast(
        self, encoded: list[EncodedMsg], opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Record the call and return a fake successful broadcast result."""
        self.calls.append(MockCall(messages=list(encoded), opts=opts))
        return BroadcastResult(
            tx_hash=self._tx_hash,
            code=0,
            raw_log="",
            raw={
                "txhash": self._tx_hash,
                "code": 0,
                "raw_log": "",
                "gas_used": str(self.gas_estimate),
                "gas_wanted": str(self.gas_estimate),
            },
        )

    def simulate(
        self, encoded: list[EncodedMsg], memo: Optional[str] = None
    ) -> int:
        """Return the fixed gas estimate without broadcasting."""
        return self.gas_estimate


__all__ = ["MockTxClient", "MockCall"]
