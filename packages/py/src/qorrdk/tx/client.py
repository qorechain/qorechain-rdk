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
import time
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

from qorsdk.key_integrity import sign_proof_of_possession
from qorsdk.pqc import PqcKeypair
from qorsdk.pqc_dx import build_register_pqc_key
from qorsdk.signbytes import (
    SignBytesResolver,
    default_sign_bytes_resolver,
    is_hybrid_signature_rejection,
)
from qorsdk.tx import BuiltTx, build_hybrid_tx

from ..rules import data_hash_error, rollup_id_error, withdrawal_errors, withdrawals_root_error
from ..accounts.wallet import Signer
from ..client.http import Transport, default_transport
from ..client.rest import RestClient
from ..config.validate import rollup_mode_errors
from ..constants import DEFAULT_MIN_SUBMITTER_BOND_UQOR, MIN_ROLLUP_DEPOSIT_UQOR, RDK_FEATURES
from ..enums import MAX_ROLLUP_MEMBERS, PAUSED_PROOF_SYSTEMS, RollupStatus
from ..utils.bytes import to_bytes
from ..zk import is_data_hash_chain_bound, zk_public_input_errors
from ..qledger.batch import is_http_not_found, qledger_batch_errors
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


#: The settlement and proof system the chain derives from each preset profile.
_PROFILE_SETTLEMENT = {
    "defi": ("zk", "snark"),
    "gaming": ("based", "none"),
    "nft": ("optimistic", "fraud"),
    "enterprise": ("based", "none"),
    "custom": ("optimistic", "fraud"),
}

#: The length of an ML-KEM-1024 encapsulation key.
_ML_KEM_1024_KEY_SIZE = 1568

#: Messages an account without a registered post-quantum key may send on their
#: own (the chain's registration-only rule, ``pqc-keyless-extension-closed``).
_PQC_REGISTRATION_TYPES = frozenset(
    {
        "/qorechain.pqc.v1.MsgRegisterPQCKey",
        "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
        "/qorechain.pqc.v1.MsgMigratePQCKey",
    }
)
#: The ML-DSA-87 algorithm id in the chain's PQC registry.
_ML_DSA_87_ALGORITHM_ID = 1
#: The pqc codespace's "key already registered" refusal.
_PQC_ALREADY_REGISTERED_CODE = 7
#: The fixed fee of the key registration sent ahead of a keyless account's
#: first transaction.
_PQC_REGISTRATION_GAS = 600000
_PQC_REGISTRATION_FEE_UQOR = "90000"
#: How long to wait for the registration to be included in a block.
_PQC_REGISTRATION_TIMEOUT_S = 60.0
_PQC_REGISTRATION_POLL_S = 1.0


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
    - ``include_pqc_public_key``: the key is not registered yet. Since chain
      v3.2.3 a key carried in the signature extension is no longer registered
      on first use, and an account without a key may send only a key
      registration. So before the first transaction the client sends a
      ``MsgRegisterPQCKeyV2`` (with a proof of possession) on its own, waits
      for it to be included, then clears this flag. Defaults to ``False``.
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
        if self._pqc_keypair is None:
            account_number, sequence = self.fetch_account(self.address)
            tx_bytes = self.sign_tx(
                encoded, account_number=account_number, sequence=sequence, opts=opts
            )
            return self._post_tx(tx_bytes)
        # Since chain v3.2.3 (``pqc-keyless-extension-closed``) a key carried in
        # the signature extension is no longer registered on first use: an
        # account without a registered key may send only a registration.
        # Register it in a transaction of its own first, then send ``encoded``.
        if self._include_pqc_public_key and not all(
            m.type_url in _PQC_REGISTRATION_TYPES for m in encoded
        ):
            self._register_pqc_key()
        return self._broadcast_hybrid(encoded, opts)

    def _register_pqc_key(self) -> BroadcastResult:
        """Register this client's ML-DSA-87 key with ``MsgRegisterPQCKeyV2``.

        The registration carries the key's proof of possession and a fixed fee.
        A refusal as "already registered" (pqc code 7) is accepted. On success
        the client waits for the transaction to be included in a block, so the
        next transaction sees the key. Afterwards the key is no longer embedded
        in the signature extension.
        """
        keypair = self._pqc_keypair
        assert keypair is not None
        proof = sign_proof_of_possession(
            chain_id=self._chain_id,
            account=self.address,
            keypair=keypair,
            algorithm_id=_ML_DSA_87_ALGORITHM_ID,
        )
        reg = build_register_pqc_key(
            sender=self.address,
            dilithium_pubkey=keypair.public_key,
            ecdsa_pubkey=b"",
            key_type="hybrid",
            proof_of_possession=proof,
        )
        encoded = [EncodedMsg(type_url=reg.type_url, value=reg.value.SerializeToString())]
        fee = TxOptions(
            gas_limit=_PQC_REGISTRATION_GAS,
            fee_amount=_PQC_REGISTRATION_FEE_UQOR,
            fee_denom=_FEE_DENOM,
        )
        result = self._broadcast_hybrid(encoded, fee)
        if not _is_ok_or_already_registered(result.code, result.raw):
            raise RuntimeError(
                f"registering this account's post-quantum key failed "
                f"(code {result.code}): {result.raw_log}"
            )
        if result.code == 0:
            self._wait_for_inclusion(result.tx_hash)
        self._include_pqc_public_key = False
        return result

    def _wait_for_inclusion(self, tx_hash: str) -> None:
        """Wait until ``tx_hash`` is in a block and check it was not refused."""
        deadline = time.monotonic() + _PQC_REGISTRATION_TIMEOUT_S
        path = f"{self._rest}/cosmos/tx/v1beta1/txs/{tx_hash}"
        while True:
            resp = self._transport("GET", path, {"accept": "application/json"}, None)
            if resp.ok:
                body = resp.json() or {}
                tx = body.get("tx_response", body)
                code = int(tx.get("code", 0))
                if not _is_ok_or_already_registered(code, tx):
                    raise RuntimeError(
                        f"registering this account's post-quantum key failed in block "
                        f"(code {code}): {tx.get('raw_log', '')}"
                    )
                return
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    f"the post-quantum key registration {tx_hash} was not included within "
                    f"{_PQC_REGISTRATION_TIMEOUT_S:.0f}s"
                )
            time.sleep(_PQC_REGISTRATION_POLL_S)

    def _broadcast_hybrid(
        self, encoded: list[EncodedMsg], opts: Optional[TxOptions]
    ) -> BroadcastResult:
        """Sign hybrid with the account's current state and broadcast."""
        account_number, sequence = self.fetch_account(self.address)

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
        verification_key=None,
        sequencing: str = "",
        execution_vm: str = "",
        privacy: str = "",
        opts: Optional[TxOptions] = None,
    ) -> BroadcastResult:
        """Create a rollup. The client's address is the creator.

        Raises before broadcasting if ``rollup_id`` breaks the chain's id
        grammar (enforced at creation from v3.2.2), since the chain would refuse
        it only after the creation fee had been paid. From chain v3.2.8 the
        ``sequencing`` / ``execution_vm`` / ``privacy`` combination is checked
        against the profile's settlement the same way (a new optimistic rollup,
        ``nft`` or ``custom``, needs ``execution_vm="qledger-v1"`` and
        ``sequencing="based"``). ``verification_key`` (chain v3.2.7+)
        registers a zk rollup's key at creation.
        """
        id_error = rollup_id_error(rollup_id)
        if id_error:
            raise ValueError(f'rollup_id "{rollup_id}" {id_error}')
        profile_value = str(getattr(profile, "value", profile))
        preset = _PROFILE_SETTLEMENT.get(profile_value)
        if preset is not None:
            errors = rollup_mode_errors(
                settlement=preset[0],
                proof_system=preset[1],
                sequencing=sequencing,
                execution_vm=execution_vm,
                privacy=privacy,
            )
            if errors:
                raise ValueError(
                    f'rollup "{rollup_id}" would be refused: ' + "; ".join(errors)
                )
        msg = msgs.create_rollup_msg(
            msgs.CreateRollupInput(
                creator=self.address,
                rollup_id=rollup_id,
                profile=profile_value,
                vm_type=str(getattr(vm_type, "value", vm_type)),
                stake_amount=stake_amount,
                verification_key=verification_key,
                sequencing=str(getattr(sequencing, "value", sequencing) or ""),
                execution_vm=str(getattr(execution_vm, "value", execution_vm) or ""),
                privacy=str(getattr(privacy, "value", privacy) or ""),
            )
        )
        return self.broadcast_messages([msg], opts)

    def _rest_client(self) -> Optional[RestClient]:
        """A read client over this client's REST URL, when it has one."""
        if self._backend is not None or not self._rest:
            return None
        return RestClient(self._rest, self._transport)

    def submit_batch(
        self, inp: "msgs.SubmitBatchInput | dict", opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Submit a settlement batch. The client's address is the sequencer.

        Raises before broadcasting if ``withdrawals_root`` is neither empty nor
        32 bytes, which the chain refuses from v3.2.5 only after the fee has
        been paid. When the client reads the network (it has a REST URL), it
        also checks what the chain would refuse after the fee: a based rollup's
        ``inbox_end``, a native-DA ``data_hash``, and (chain v3.2.8) canonical
        ZK public inputs and the paused STARK settlement. On a qledger-v1
        rollup it also checks the batch admission rules (bond, pending
        batches, range size, retained end, fresh-post and checkpoint stops).
        """
        data = _coerce(inp, msgs.SubmitBatchInput, sequencer=self.address)
        root_error = withdrawals_root_error(data.withdrawals_root)
        if root_error:
            raise ValueError(f"cannot submit batch {data.batch_index}: {root_error}")
        rest = self._rest_client()
        if rest is not None:
            self._check_batch_against_rollup(rest, data, self.address)
        return self.broadcast_messages([msgs.submit_batch_msg(data)], opts)

    @staticmethod
    def _check_batch_against_rollup(
        rest: RestClient, data: "msgs.SubmitBatchInput", submitter: str
    ) -> None:
        def fail(why: str) -> ValueError:
            return ValueError(f"cannot submit batch {data.batch_index}: {why}")

        rollup = rest.get_rollup(data.rollup_id)
        based = rollup.sequencing == "based"
        inbox_end = 0 if data.inbox_end is None else int(data.inbox_end)
        has_data_hash = bool(data.data_hash) and len(to_bytes(data.data_hash)) > 0
        if based and inbox_end == 0:
            raise fail(
                "the rollup is based: set inbox_end and carry the inbox range commitment "
                "as data_hash"
            )
        if not based and inbox_end != 0:
            raise fail("inbox_end must be 0 on a rollup that is not based")
        if not based and has_data_hash:
            posted = rest.is_protocol_feature_enabled(RDK_FEATURES["post_rollup_data"])
            err = data_hash_error(
                rollup.da_backend, data.data_hash, posted_data_enabled=posted
            )
            if err:
                raise fail(err)
        if rollup.execution_vm == "qledger-v1":
            # Chain v3.2.8 admission rules for qledger-v1 batches.
            params = rest.get_params()
            bond = rest.get_submitter_bond(data.rollup_id, submitter)
            inbox = rest.get_inbox(data.rollup_id)
            head = inbox.head_sequence

            def retained(x: int) -> bool:
                return x == head or rest.get_inbox(data.rollup_id, x).range_data_hash != ""

            next_retained: Optional[bool] = None
            next_height: Optional[int] = None
            if inbox_end < head:
                try:
                    next_height = rest.get_posted_data(data.rollup_id, inbox_end + 1).height
                    next_retained = True
                except RuntimeError as err:
                    if not is_http_not_found(err):
                        raise
                    next_retained = False
            errors = qledger_batch_errors(
                consumed=inbox.consumed_sequence,
                head=head,
                end=inbox_end,
                bond=bond.amount,
                min_bond=params.min_submitter_bond or DEFAULT_MIN_SUBMITTER_BOND_UQOR,
                pending=bond.pending,
                end_retained=inbox_end <= head and retained(inbox_end),
                next_retained=next_retained,
                next_height=next_height,
                inclusion_height=rest.get_latest_height() + 2,
            )
            if errors:
                raise fail("; ".join(errors))
        if rollup.settlement_mode == "zk":
            if (rollup.proof_system or "") in PAUSED_PROOF_SYSTEMS:
                if rest.is_protocol_feature_enabled(RDK_FEATURES["stark_statement"]):
                    raise fail(
                        "STARK settlement is paused on the network; governance can move the "
                        "rollup to a Groth16 key"
                    )
            elif rest.is_protocol_feature_enabled(RDK_FEATURES["zk_canonical_inputs"]):
                errors = zk_public_input_errors(
                    state_root=data.state_root,
                    prev_state_root=data.prev_state_root,
                    data_hash=data.data_hash,
                    withdrawals_root=data.withdrawals_root,
                    data_hash_bound=is_data_hash_chain_bound(rollup, data.data_hash),
                )
                if errors:
                    raise fail("; ".join(errors))

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

    def set_verification_key(
        self,
        *,
        rollup_id: str,
        verification_key,
        proof_system: str = "",
        opts: Optional[TxOptions] = None,
    ) -> BroadcastResult:
        """Register or replace the rollup's ZK verification key (chain v3.2.7+).
        The client's address must be the creator, and only before the first
        batch. ``proof_system="stark"`` is refused from v3.2.8."""
        ps = str(getattr(proof_system, "value", proof_system) or "")
        if ps in PAUSED_PROOF_SYSTEMS:
            raise ValueError(
                "STARK keys are refused by the chain from v3.2.8; register a snark (Groth16) key"
            )
        msg = msgs.set_verification_key_msg(
            msgs.SetVerificationKeyInput(
                creator=self.address,
                rollup_id=rollup_id,
                verification_key=verification_key,
                proof_system=ps,
            )
        )
        return self.broadcast_messages([msg], opts)

    def post_rollup_data(
        self, *, rollup_id: str, data, opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Post rollup data on chain (chain v3.2.8+). ``data`` is bytes or a
        hex string. The ``MsgPostRollupDataResponse`` carries the inbox sequence
        and SHA-256; on a private rollup ``data`` must be an envelope
        (:func:`~qorrdk.privpost.seal_envelope`). The poster pays
        ``posted_data_fee_per_byte`` per billable byte (at least 1 KiB) on top
        of gas."""
        if len(to_bytes(data)) == 0:
            raise ValueError("data cannot be empty")
        msg = msgs.post_rollup_data_msg(poster=self.address, rollup_id=rollup_id, data=data)
        return self.broadcast_messages([msg], opts)

    def deposit_to_rollup(
        self, *, rollup_id: str, account, amount, opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Deposit uqor into a qledger-v1 rollup, crediting the 32-byte L2
        ``account`` through the rollup's inbox (chain v3.2.8+). At least 1 QOR."""
        acct = to_bytes(account)
        if len(acct) != 32 or not any(acct):
            raise ValueError("account must be a non-zero 32-byte qledger-v1 account id")
        if int(amount) < MIN_ROLLUP_DEPOSIT_UQOR:
            raise ValueError(f"a deposit is at least {MIN_ROLLUP_DEPOSIT_UQOR} uqor (1 QOR)")
        msg = msgs.deposit_to_rollup_msg(
            depositor=self.address, rollup_id=rollup_id, account=acct, amount=amount
        )
        return self.broadcast_messages([msg], opts)

    def bond_rollup_submitter(
        self, *, rollup_id: str, amount, opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Add to this client's submitter bond on a qledger-v1 rollup (chain v3.2.8+)."""
        if int(amount) <= 0:
            raise ValueError("amount must be positive")
        msg = msgs.bond_rollup_submitter_msg(
            submitter=self.address, rollup_id=rollup_id, amount=amount
        )
        return self.broadcast_messages([msg], opts)

    def unbond_rollup_submitter(
        self, *, rollup_id: str, opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Withdraw this client's whole submitter bond, a full challenge window
        after its last batch (chain v3.2.8+)."""
        msg = msgs.unbond_rollup_submitter_msg(submitter=self.address, rollup_id=rollup_id)
        return self.broadcast_messages([msg], opts)

    def set_rollup_members(
        self, *, rollup_id: str, members, opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Set a private rollup's member list (chain v3.2.8+). The client's
        address must be the creator; each member needs a registered
        ML-KEM-1024 key. Starts a new membership epoch."""
        members = list(members)
        if len(members) == 0 or len(members) > MAX_ROLLUP_MEMBERS:
            raise ValueError(f"a private rollup has 1 to {MAX_ROLLUP_MEMBERS} members")
        if len(set(members)) != len(members):
            raise ValueError("a member is listed twice")
        msg = msgs.set_rollup_members_msg(
            creator=self.address, rollup_id=rollup_id, members=members
        )
        return self.broadcast_messages([msg], opts)

    def register_kem_key(
        self, *, public_key, opts: Optional[TxOptions] = None
    ) -> BroadcastResult:
        """Publish this client's ML-KEM-1024 encapsulation key in the chain's
        KEM registry (chain v3.2.5+), so a private rollup can list it as a
        member. Derive the key pair with
        :func:`~qorrdk.privpost.kem_keypair_from_seed` and keep the seed secret."""
        pk = to_bytes(public_key)
        if len(pk) != _ML_KEM_1024_KEY_SIZE:
            raise ValueError(
                f"an ML-KEM-1024 key is {_ML_KEM_1024_KEY_SIZE} bytes, got {len(pk)}"
            )
        msg = msgs.register_kem_key_msg(sender=self.address, public_key=pk)
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


def _is_ok_or_already_registered(code: int, raw: Any) -> bool:
    """Code 0, or the pqc codespace's "already registered" (7)."""
    if code == 0:
        return True
    codespace = raw.get("codespace", "") if isinstance(raw, dict) else ""
    return code == _PQC_ALREADY_REGISTERED_CODE and codespace in ("", "pqc")


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
