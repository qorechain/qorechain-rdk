"""``RdkTxClient`` -- builds and broadcasts ``rdk`` transactions.

A transaction is assembled in Cosmos ``SIGN_MODE_DIRECT``: the hand-encoded
``rdk`` messages are wrapped in ``google.protobuf.Any`` with their
``/qorechain.rdk.v1.Msg...`` type URLs, packed into a ``TxBody``, paired with an
``AuthInfo`` carrying the signer's secp256k1 public key and fee, signed over the
``SignDoc`` digest (``sha256``), and broadcast as a ``TxRaw`` via the REST
``/cosmos/tx/v1beta1/txs`` endpoint (``BROADCAST_MODE_SYNC``).

Signing is delegated to a :class:`~qorechain_rdk.accounts.Signer` (secp256k1).
"""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from typing import Any, Optional, Protocol, runtime_checkable

from google.protobuf.any_pb2 import Any as PbAny
from cosmpy.protos.cosmos.base.v1beta1.coin_pb2 import Coin
from cosmpy.protos.cosmos.crypto.secp256k1.keys_pb2 import PubKey as Secp256k1PubKey
from cosmpy.protos.cosmos.tx.signing.v1beta1.signing_pb2 import SignMode
from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import (
    AuthInfo,
    Fee,
    ModeInfo,
    SignDoc,
    SignerInfo,
    TxBody,
    TxRaw,
)

from ..accounts.wallet import Signer
from ..client.http import Transport, default_transport
from ..enums import RollupStatus
from ..lifecycle.state_machine import assert_rollup_action
from . import messages as msgs
from .messages import EncodedMsg

_DEFAULT_GAS_LIMIT = 200000
_DEFAULT_FEE_AMOUNT = "5000"
_FEE_DENOM = "uqor"


@dataclass
class TxOptions:
    """Per-transaction overrides for gas, fee, and memo."""

    gas_limit: int = _DEFAULT_GAS_LIMIT
    fee_amount: str = _DEFAULT_FEE_AMOUNT
    fee_denom: str = _FEE_DENOM
    memo: str = ""


@dataclass
class BroadcastResult:
    """The result of a SYNC broadcast."""

    tx_hash: str
    code: int
    raw_log: str
    raw: Any


def _to_any(encoded: EncodedMsg) -> PbAny:
    return PbAny(type_url=encoded.type_url, value=encoded.value)


@runtime_checkable
class SignAndBroadcastBackend(Protocol):
    """The sign-and-broadcast capability ``RdkTxClient`` can delegate to.

    Satisfied by :class:`~qorechain_rdk.tx.mock.MockTxClient` (and by the real
    client's own REST path). A backend may additionally implement ``simulate``
    to support dry-run gas estimation offline.
    """

    address: str

    def sign_and_broadcast(
        self, encoded: list[EncodedMsg], opts: Optional["TxOptions"] = None
    ) -> "BroadcastResult":
        ...


class RdkTxClient:
    """Builds, signs, and broadcasts ``rdk`` transactions over REST.

    By default the client assembles a ``SIGN_MODE_DIRECT`` transaction and
    broadcasts it over REST. Pass a ``backend`` (see
    :class:`SignAndBroadcastBackend`) -- or build one with :meth:`from_backend`
    -- to delegate signing and broadcast elsewhere, e.g. the offline
    :class:`~qorechain_rdk.tx.mock.MockTxClient`.
    """

    def __init__(
        self,
        *,
        rest_url: Optional[str] = None,
        chain_id: Optional[str] = None,
        signer: Optional[Signer] = None,
        transport: Optional[Transport] = None,
        backend: Optional[SignAndBroadcastBackend] = None,
    ) -> None:
        self._backend = backend
        if backend is None:
            if rest_url is None or chain_id is None or signer is None:
                raise ValueError(
                    "rest_url, chain_id, and signer are required without a backend"
                )
            self._rest = rest_url.rstrip("/")
            self._chain_id = chain_id
            self._signer = signer
            self._transport = transport or default_transport()
        else:
            self._rest = (rest_url or "").rstrip("/")
            self._chain_id = chain_id or ""
            self._signer = signer
            self._transport = transport

    @classmethod
    def from_backend(
        cls, backend: SignAndBroadcastBackend
    ) -> "RdkTxClient":
        """Wrap a sign-and-broadcast backend (advanced use and testing).

        Mirrors the TS ``RdkTxClient.fromClient``: the backend supplies both the
        signer address and the broadcast result, so the full create/lifecycle
        flow runs without a node.
        """
        return cls(backend=backend)

    @property
    def address(self) -> str:
        """The signing/operator address used as the message signer."""
        if self._backend is not None:
            return self._backend.address
        return self._signer.address

    # ------------------------------------------------------------------ #
    # Transaction assembly (no network access -- testable offline).
    # ------------------------------------------------------------------ #

    def build_sign_doc(
        self,
        encoded: list[EncodedMsg],
        *,
        account_number: int,
        sequence: int,
        opts: Optional[TxOptions] = None,
    ) -> tuple[SignDoc, bytes, bytes]:
        """Assemble the ``SignDoc`` for ``encoded`` messages.

        Returns ``(sign_doc, body_bytes, auth_info_bytes)`` so callers can sign
        and assemble a ``TxRaw`` without re-encoding.
        """
        opts = opts or TxOptions()
        body = TxBody(messages=[_to_any(m) for m in encoded], memo=opts.memo)
        body_bytes = body.SerializeToString()

        pubkey_any = PbAny(
            type_url="/cosmos.crypto.secp256k1.PubKey",
            value=Secp256k1PubKey(key=self._signer.public_key).SerializeToString(),
        )
        signer_info = SignerInfo(
            public_key=pubkey_any,
            mode_info=ModeInfo(single=ModeInfo.Single(mode=SignMode.SIGN_MODE_DIRECT)),
            sequence=sequence,
        )
        fee = Fee(
            amount=[Coin(denom=opts.fee_denom, amount=opts.fee_amount)],
            gas_limit=opts.gas_limit,
        )
        auth_info = AuthInfo(signer_infos=[signer_info], fee=fee)
        auth_info_bytes = auth_info.SerializeToString()

        sign_doc = SignDoc(
            body_bytes=body_bytes,
            auth_info_bytes=auth_info_bytes,
            chain_id=self._chain_id,
            account_number=account_number,
        )
        return sign_doc, body_bytes, auth_info_bytes

    def sign_tx(
        self,
        encoded: list[EncodedMsg],
        *,
        account_number: int,
        sequence: int,
        opts: Optional[TxOptions] = None,
    ) -> bytes:
        """Build and sign a transaction, returning the ``TxRaw`` bytes."""
        sign_doc, body_bytes, auth_info_bytes = self.build_sign_doc(
            encoded, account_number=account_number, sequence=sequence, opts=opts
        )
        digest = hashlib.sha256(sign_doc.SerializeToString()).digest()
        signature = self._signer.sign_digest(digest)
        tx_raw = TxRaw(
            body_bytes=body_bytes,
            auth_info_bytes=auth_info_bytes,
            signatures=[signature],
        )
        return tx_raw.SerializeToString()

    # ------------------------------------------------------------------ #
    # Network access.
    # ------------------------------------------------------------------ #

    def _get(self, path: str) -> dict:
        resp = self._transport(
            "GET", f"{self._rest}{path}", {"accept": "application/json"}, None
        )
        if not resp.ok:
            raise RuntimeError(f"REST GET {path} failed: {resp.status} {resp.status_text}")
        return resp.json() or {}

    def fetch_account(self, address: str) -> tuple[int, int]:
        """Read ``(account_number, sequence)`` for ``address`` from REST."""
        body = self._get(f"/cosmos/auth/v1beta1/accounts/{address}")
        account = body.get("account", {})
        # base_account may be nested for module/vesting accounts.
        base = account.get("base_account", account)
        return int(base.get("account_number", 0)), int(base.get("sequence", 0))

    def simulate(
        self, encoded: list[EncodedMsg], memo: Optional[str] = None
    ) -> int:
        """Estimate gas for ``encoded`` messages without broadcasting -- the
        basis for a dry run.

        If a backend supplies its own ``simulate``, it is used. Otherwise the
        real client POSTs a signed transaction to the REST
        ``/cosmos/tx/v1beta1/simulate`` endpoint, which requires a reachable
        node. Mirrors the TS ``RdkTxClient.simulate``.
        """
        if self._backend is not None:
            sim = getattr(self._backend, "simulate", None)
            if not callable(sim):
                raise RuntimeError("the underlying backend does not support simulation")
            return int(sim(encoded, memo))

        opts = TxOptions(memo=memo) if memo is not None else None
        account_number, sequence = self.fetch_account(self.address)
        tx_bytes = self.sign_tx(
            encoded, account_number=account_number, sequence=sequence, opts=opts
        )
        payload = json.dumps({"tx_bytes": base64.b64encode(tx_bytes).decode("ascii")})
        resp = self._transport(
            "POST",
            f"{self._rest}/cosmos/tx/v1beta1/simulate",
            {"content-type": "application/json", "accept": "application/json"},
            payload,
        )
        if not resp.ok:
            raise RuntimeError(
                f"simulate failed: {resp.status} {resp.status_text}: {resp.body_text}"
            )
        body = resp.json() or {}
        gas_info = body.get("gas_info", body)
        return int(gas_info.get("gas_used", 0))

    def broadcast_messages(
        self, encoded: list[EncodedMsg], opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Sign and broadcast ``encoded`` messages in ``BROADCAST_MODE_SYNC``."""
        if self._backend is not None:
            return self._backend.sign_and_broadcast(encoded, opts)
        account_number, sequence = self.fetch_account(self.address)
        tx_bytes = self.sign_tx(
            encoded, account_number=account_number, sequence=sequence, opts=opts
        )
        payload = json.dumps(
            {
                "tx_bytes": base64.b64encode(tx_bytes).decode("ascii"),
                "mode": "BROADCAST_MODE_SYNC",
            }
        )
        resp = self._transport(
            "POST",
            f"{self._rest}/cosmos/tx/v1beta1/txs",
            {"content-type": "application/json", "accept": "application/json"},
            payload,
        )
        if not resp.ok:
            raise RuntimeError(
                f"broadcast failed: {resp.status} {resp.status_text}: {resp.body_text}"
            )
        body = resp.json() or {}
        tx_response = body.get("tx_response", body)
        return BroadcastResult(
            tx_hash=str(tx_response.get("txhash", "")),
            code=int(tx_response.get("code", 0)),
            raw_log=str(tx_response.get("raw_log", "")),
            raw=tx_response,
        )

    # ------------------------------------------------------------------ #
    # Friendly per-message methods (the client's address is the signer).
    # ------------------------------------------------------------------ #

    def create_rollup(
        self,
        *,
        rollup_id: str,
        profile: str,
        vm_type: str,
        stake_amount,
        opts: Optional[TxOptions] = None,
    ) -> BroadcastResult:
        """Create a rollup. The client's address is the creator."""
        msg = msgs.create_rollup_msg(
            msgs.CreateRollupInput(
                creator=self.address,
                rollup_id=rollup_id,
                profile=str(getattr(profile, "value", profile)),
                vm_type=str(getattr(vm_type, "value", vm_type)),
                stake_amount=stake_amount,
            )
        )
        return self.broadcast_messages([msg], opts)

    def submit_batch(
        self, inp: "msgs.SubmitBatchInput | dict", opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Submit a settlement batch. The client's address is the sequencer."""
        data = _coerce(inp, msgs.SubmitBatchInput, sequencer=self.address)
        return self.broadcast_messages([msgs.submit_batch_msg(data)], opts)

    def challenge_batch(
        self, inp: "msgs.ChallengeBatchInput | dict", opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Challenge an optimistic batch with a fraud proof."""
        data = _coerce(inp, msgs.ChallengeBatchInput, challenger=self.address)
        return self.broadcast_messages([msgs.challenge_batch_msg(data)], opts)

    def resolve_challenge(
        self, inp: "msgs.ResolveChallengeInput | dict", opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Resolve an open challenge (upheld or dismissed)."""
        data = _coerce(inp, msgs.ResolveChallengeInput, resolver=self.address)
        return self.broadcast_messages([msgs.resolve_challenge_msg(data)], opts)

    def pause_rollup(
        self,
        *,
        rollup_id: str,
        reason: Optional[str] = None,
        current_status: Optional[RollupStatus] = None,
        opts: Optional[TxOptions] = None,
    ) -> BroadcastResult:
        """Pause an active rollup. Pass ``current_status`` to guard the transition."""
        if current_status is not None:
            assert_rollup_action("pause", current_status)
        msg = msgs.pause_rollup_msg(
            msgs.PauseRollupInput(creator=self.address, rollup_id=rollup_id, reason=reason)
        )
        return self.broadcast_messages([msg], opts)

    def resume_rollup(
        self,
        *,
        rollup_id: str,
        current_status: Optional[RollupStatus] = None,
        opts: Optional[TxOptions] = None,
    ) -> BroadcastResult:
        """Resume a paused rollup. Pass ``current_status`` to guard the transition."""
        if current_status is not None:
            assert_rollup_action("resume", current_status)
        msg = msgs.resume_rollup_msg(
            msgs.RollupRefInput(creator=self.address, rollup_id=rollup_id)
        )
        return self.broadcast_messages([msg], opts)

    def stop_rollup(
        self,
        *,
        rollup_id: str,
        current_status: Optional[RollupStatus] = None,
        opts: Optional[TxOptions] = None,
    ) -> BroadcastResult:
        """Stop a rollup permanently. Pass ``current_status`` to guard the transition."""
        if current_status is not None:
            assert_rollup_action("stop", current_status)
        msg = msgs.stop_rollup_msg(
            msgs.RollupRefInput(creator=self.address, rollup_id=rollup_id)
        )
        return self.broadcast_messages([msg], opts)

    def execute_withdrawal(
        self, inp: "msgs.ExecuteWithdrawalInput | dict", opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Execute a finalized-batch withdrawal. The client's address is the submitter."""
        data = _coerce(inp, msgs.ExecuteWithdrawalInput, submitter=self.address)
        return self.broadcast_messages([msgs.execute_withdrawal_msg(data)], opts)


def _coerce(inp, cls, **injected):
    """Build a message input dataclass, injecting the signer address field."""
    if isinstance(inp, cls):
        for key, value in injected.items():
            if getattr(inp, key, None) in (None, ""):
                setattr(inp, key, value)
        return inp
    if isinstance(inp, dict):
        data = dict(inp)
        data.update({k: v for k, v in injected.items() if k not in data or not data[k]})
        return cls(**data)
    raise TypeError(f"expected {cls.__name__} or dict, got {type(inp).__name__}")


__all__ = [
    "TxOptions",
    "BroadcastResult",
    "RdkTxClient",
    "SignAndBroadcastBackend",
]
