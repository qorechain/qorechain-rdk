"""``RdkTxClient`` -- builds and broadcasts ``rdk`` transactions.

A transaction is assembled in Cosmos ``SIGN_MODE_DIRECT``: the hand-encoded
``rdk`` messages are wrapped in ``google.protobuf.Any`` with their
``/qorechain.rdk.v1.Msg...`` type URLs, packed into a ``TxBody``, paired with an
``AuthInfo`` carrying the signer's secp256k1 public key and fee, signed over the
``SignDoc`` digest (``sha256``), and broadcast as a ``TxRaw`` via the REST
``/cosmos/tx/v1beta1/txs`` endpoint (``BROADCAST_MODE_SYNC``).

Signing is delegated to a :class:`~qorrdk.accounts.Signer` (secp256k1).

Two signing paths:

- **Classical** (default): the ``SIGN_MODE_DIRECT`` transaction above, signed
  with secp256k1 only. Both public networks refuse a classical-only native-lane
  transaction.
- **Hybrid (post-quantum)**: pass ``pqc_keypair``. Every transaction is then
  built and signed by the QoreChain Python SDK's ``qorsdk.tx.build_hybrid_tx``,
  which attaches the ML-DSA-87 half as a ``PQCHybridSignature`` tx-body
  extension alongside the classical secp256k1 signature. The hybrid sign-bytes
  form (``v1`` / ``v2``) is resolved from the network by the SDK's resolver
  (``sign_bytes_version="auto"``), or forced with ``"v1"`` / ``"v2"``.
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

from qorsdk.pqc import PqcKeypair
from qorsdk.signbytes import (
    SignBytesResolver,
    default_sign_bytes_resolver,
    is_hybrid_signature_rejection,
)
from qorsdk.tx import BuiltTx, build_hybrid_tx

from ..rules import rollup_id_error, withdrawal_errors, withdrawals_root_error
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


_SIGN_BYTES_OPTIONS = ("auto", "v1", "v2")


class _TransportResponse:
    """The slice of an ``httpx`` response the SDK's sign-bytes resolver reads."""

    def __init__(self, url: str, resp) -> None:
        self._url = url
        self._resp = resp

    def raise_for_status(self) -> None:
        if not self._resp.ok:
            raise RuntimeError(
                f"GET {self._url} failed: {self._resp.status} {self._resp.status_text}"
            )

    def json(self) -> Any:
        return self._resp.json()


class _TransportHttpClient:
    """Adapts the RDK :class:`~qorrdk.client.http.Transport` to the ``get`` the
    SDK's resolver calls, so resolution goes through the same (injectable)
    transport as every other request this client makes."""

    def __init__(self, transport: Transport) -> None:
        self._transport = transport

    def get(self, url: str) -> _TransportResponse:
        return _TransportResponse(
            url, self._transport("GET", url, {"accept": "application/json"}, None)
        )


@runtime_checkable
class SignAndBroadcastBackend(Protocol):
    """The sign-and-broadcast capability ``RdkTxClient`` can delegate to.

    Satisfied by :class:`~qorrdk.tx.mock.MockTxClient` (and by the real
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
    :class:`~qorrdk.tx.mock.MockTxClient`.

    Pass ``pqc_keypair`` to sign every transaction hybrid (post-quantum):

    - ``pqc_keypair``: the ML-DSA-87 keypair providing the post-quantum half.
      It must already be registered on chain unless ``include_pqc_public_key``
      is set. :func:`~qorrdk.accounts.resolve_pqc_keypair` and
      :func:`~qorrdk.accounts.pqc_keypair_from_env` find the right one.
    - ``include_pqc_public_key``: embed the public key in the extension so the
      chain registers it on first use. Defaults to ``False``.
    - ``sign_bytes_version``: ``"auto"`` (the default) asks the network over
      ``rest_url`` which hybrid sign-bytes form it verifies; ``"v1"`` / ``"v2"``
      force a form.
    - ``sign_bytes_resolver``: the SDK ``SignBytesResolver`` behind ``"auto"``;
      defaults to the SDK's process-wide one (answers cached briefly).
    """

    def __init__(
        self,
        *,
        rest_url: Optional[str] = None,
        chain_id: Optional[str] = None,
        signer: Optional[Signer] = None,
        transport: Optional[Transport] = None,
        backend: Optional[SignAndBroadcastBackend] = None,
        pqc_keypair: Optional[PqcKeypair] = None,
        include_pqc_public_key: bool = False,
        sign_bytes_version: str = "auto",
        sign_bytes_resolver: Optional[SignBytesResolver] = None,
    ) -> None:
        if sign_bytes_version not in _SIGN_BYTES_OPTIONS:
            raise ValueError(
                f'sign_bytes_version must be "auto", "v1" or "v2", got "{sign_bytes_version}"'
            )
        if pqc_keypair is not None and backend is not None:
            raise ValueError(
                "pqc_keypair applies to the client's own signing path; a backend signs "
                "and broadcasts on its own"
            )
        self._pqc_keypair = pqc_keypair
        self._include_pqc_public_key = bool(include_pqc_public_key)
        self._sign_bytes_version = sign_bytes_version
        self._resolver = sign_bytes_resolver or default_sign_bytes_resolver
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

    @property
    def is_hybrid(self) -> bool:
        """Whether this client signs hybrid (post-quantum) transactions."""
        return self._pqc_keypair is not None

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
        sign_bytes_version: Optional[str] = None,
    ) -> bytes:
        """Build and sign a transaction, returning the ``TxRaw`` bytes.

        A hybrid client signs with :meth:`sign_hybrid_tx`; its sign-bytes form
        is ``sign_bytes_version`` if given, else the client's setting, and
        ``"auto"`` asks the network (see :meth:`resolve_sign_bytes_version`).
        Without a PQC keypair this is the classical ``SIGN_MODE_DIRECT`` tx.
        """
        if self._pqc_keypair is not None:
            version = self.resolve_sign_bytes_version(
                sign_bytes_version or self._sign_bytes_version
            )
            return self.sign_hybrid_tx(
                encoded,
                account_number=account_number,
                sequence=sequence,
                opts=opts,
                sign_bytes_version=version,
            ).tx_raw_bytes
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

    def sign_hybrid_tx(
        self,
        encoded: list[EncodedMsg],
        *,
        account_number: int,
        sequence: int,
        sign_bytes_version: str,
        opts: Optional[TxOptions] = None,
    ) -> BuiltTx:
        """Build and sign a hybrid (secp256k1 + ML-DSA-87) transaction offline.

        The messages, fee, memo, chain id, account number and sequence are the
        ones the classical path uses; the transaction is assembled by the SDK's
        ``build_hybrid_tx``. ``sign_bytes_version`` must be ``"v1"`` or ``"v2"``
        (resolve ``"auto"`` first with :meth:`resolve_sign_bytes_version`).
        Returns the SDK's ``BuiltTx``: ``tx_raw_bytes`` to broadcast, plus the
        exact ``pqc_signed_message`` and ``pqc_signature``.
        """
        if self._pqc_keypair is None:
            raise RuntimeError("this client has no pqc_keypair, so it cannot sign hybrid")
        if sign_bytes_version not in ("v1", "v2"):
            raise ValueError(
                f'sign_bytes_version must be "v1" or "v2" here, got "{sign_bytes_version}"'
            )
        opts = opts or TxOptions()
        return build_hybrid_tx(
            account=self._signer,
            pqc_keypair=self._pqc_keypair,
            messages=[{"type_url": m.type_url, "value": m.value} for m in encoded],
            fee={
                "amount": [{"denom": opts.fee_denom, "amount": opts.fee_amount}],
                "gas": opts.gas_limit,
            },
            chain_id=self._chain_id,
            account_number=account_number,
            sequence=sequence,
            memo=opts.memo,
            include_pqc_public_key=self._include_pqc_public_key,
            sign_bytes_version=sign_bytes_version,
        )

    def resolve_sign_bytes_version(
        self, sign_bytes_version: Optional[str] = None, *, force_refresh: bool = False
    ) -> str:
        """Resolve the hybrid sign-bytes form (``"v1"`` / ``"v2"``) to sign.

        Uses the SDK's resolver: an explicit ``"v1"`` / ``"v2"`` is returned
        as-is; ``"auto"`` (the default setting) asks the network over the REST
        URL whether the v2 upgrade has been applied, through this client's
        transport, and caches the answer briefly.
        """
        option = sign_bytes_version or self._sign_bytes_version
        return self._resolver.resolve(
            self._chain_id,
            rest_url=self._rest or None,
            sign_bytes_version=option,
            force_refresh=force_refresh,
            client=_TransportHttpClient(self._transport or default_transport()),
        )

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
        if self._pqc_keypair is None:
            tx_bytes = self.sign_tx(
                encoded, account_number=account_number, sequence=sequence, opts=opts
            )
            return self._post_tx(tx_bytes)

        # Hybrid: sign with the resolved form. With "auto", a refusal of the
        # post-quantum signature means the cached answer went stale (the network
        # upgraded): re-resolve, re-sign and broadcast once more, as the SDK's
        # hybrid_sign_and_broadcast does. An explicit form is never retried.
        def attempt(version: str) -> BroadcastResult:
            built = self.sign_hybrid_tx(
                encoded,
                account_number=account_number,
                sequence=sequence,
                opts=opts,
                sign_bytes_version=version,
            )
            return self._post_tx(built.tx_raw_bytes)

        auto = self._sign_bytes_version == "auto"
        try:
            result = attempt(self.resolve_sign_bytes_version())
        except RuntimeError as err:
            if not (auto and is_hybrid_signature_rejection(err)):
                raise
        else:
            if not (auto and is_hybrid_signature_rejection(result.raw)):
                return result
        return attempt(self.resolve_sign_bytes_version("auto", force_refresh=True))

    def _post_tx(self, tx_bytes: bytes) -> BroadcastResult:
        """POST signed ``TxRaw`` bytes to ``/cosmos/tx/v1beta1/txs`` (SYNC)."""
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
        """Create a rollup. The client's address is the creator.

        Raises before broadcasting if ``rollup_id`` breaks the chain's id
        grammar (enforced at creation from v3.2.2), since the chain would refuse
        it only after the creation fee had been paid.
        """
        id_error = rollup_id_error(rollup_id)
        if id_error:
            raise ValueError(f'rollup_id "{rollup_id}" {id_error}')
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
        """Submit a settlement batch. The client's address is the sequencer.

        Raises before broadcasting if ``withdrawals_root`` is neither empty nor
        32 bytes, which the chain refuses from v3.2.5 only after the fee has
        been paid.
        """
        data = _coerce(inp, msgs.SubmitBatchInput, sequencer=self.address)
        root_error = withdrawals_root_error(data.withdrawals_root)
        if root_error:
            raise ValueError(f"cannot submit batch {data.batch_index}: {root_error}")
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
        """Execute a finalized-batch withdrawal. The client's address is the submitter.

        Raises before broadcasting if the chain would refuse the withdrawal at
        the start of ``ExecuteWithdrawal`` (v3.2.3+), which it would do only
        after the fee had been paid.
        """
        data = _coerce(inp, msgs.ExecuteWithdrawalInput, submitter=self.address)
        errors = withdrawal_errors(
            submitter=data.submitter,
            rollup_id=data.rollup_id,
            recipient=data.recipient,
            denom=data.denom,
            amount=data.amount,
            proof=data.proof,
        )
        if errors:
            raise ValueError("withdrawal would be refused by the chain: " + "; ".join(errors))
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
