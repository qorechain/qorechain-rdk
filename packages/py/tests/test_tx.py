"""The 8 message proto bytes against golden, plus a sign->verify tx roundtrip."""

from __future__ import annotations

import hashlib

import pytest

from qorechain_rdk import (
    ChallengeBatchInput,
    CreateRollupInput,
    ExecuteWithdrawalInput,
    PauseRollupInput,
    ResolveChallengeInput,
    RollupRefInput,
    SubmitBatchInput,
    challenge_batch_msg,
    create_rollup_msg,
    execute_withdrawal_msg,
    pause_rollup_msg,
    resolve_challenge_msg,
    resume_rollup_msg,
    signer_from_private_key,
    stop_rollup_msg,
    submit_batch_msg,
)
from qorechain_rdk.tx.client import RdkTxClient


def test_create_rollup_proto_hex(golden):
    msg = create_rollup_msg(
        CreateRollupInput(
            creator="qor1creator",
            rollup_id="my-rollup",
            profile="defi",
            vm_type="evm",
            stake_amount=10000000000,
        )
    )
    assert msg.type_url == "/qorechain.rdk.v1.MsgCreateRollup"
    assert msg.value.hex() == golden["msgProtoHex"]["MsgCreateRollup"]


def test_pause_rollup_proto_hex(golden):
    msg = pause_rollup_msg(
        PauseRollupInput(creator="qor1creator", rollup_id="r1", reason="x")
    )
    assert msg.value.hex() == golden["msgProtoHex"]["MsgPauseRollup"]


def test_submit_batch_proto_hex(golden):
    msg = submit_batch_msg(
        SubmitBatchInput(
            sequencer="qor1seq",
            rollup_id="r",
            batch_index=7,
            state_root=bytes([1, 2, 3]),
            prev_state_root=bytes([4, 5]),
            tx_count=42,
            data_hash=bytes([9, 9]),
            proof=bytes([8]),
            withdrawals_root=bytes([7, 7, 7]),
        )
    )
    assert msg.value.hex() == golden["msgProtoHex"]["MsgSubmitBatch"]


def test_execute_withdrawal_proto_hex(golden):
    msg = execute_withdrawal_msg(
        ExecuteWithdrawalInput(
            submitter="qor1sub",
            rollup_id="r",
            batch_index=3,
            withdrawal_index=1,
            recipient="qor1dest",
            denom="uqor",
            amount=500,
            proof=[bytes([1]), bytes([2, 2])],
        )
    )
    assert msg.value.hex() == golden["msgProtoHex"]["MsgExecuteWithdrawal"]


def test_all_eight_messages_encode_with_correct_type_urls():
    builders = [
        create_rollup_msg(
            CreateRollupInput(creator="c", rollup_id="r", profile="defi", vm_type="evm", stake_amount=1)
        ),
        submit_batch_msg(
            SubmitBatchInput(sequencer="s", rollup_id="r", batch_index=1, state_root=b"\x01", tx_count=1, data_hash=b"\x02")
        ),
        challenge_batch_msg(ChallengeBatchInput(challenger="c", rollup_id="r", batch_index=1, proof=b"\x01")),
        resolve_challenge_msg(ResolveChallengeInput(resolver="r", rollup_id="r", batch_index=1, fraud_upheld=True)),
        pause_rollup_msg(PauseRollupInput(creator="c", rollup_id="r")),
        resume_rollup_msg(RollupRefInput(creator="c", rollup_id="r")),
        stop_rollup_msg(RollupRefInput(creator="c", rollup_id="r")),
        execute_withdrawal_msg(
            ExecuteWithdrawalInput(submitter="s", rollup_id="r", batch_index=1, withdrawal_index=0, recipient="d", denom="uqor", amount=1)
        ),
    ]
    type_urls = {b.type_url for b in builders}
    assert len(type_urls) == 8
    for b in builders:
        assert b.type_url.startswith("/qorechain.rdk.v1.Msg")
        assert isinstance(b.value, bytes)


def test_sign_doc_roundtrip_verifies(golden):
    """Build a real SIGN_MODE_DIRECT SignDoc, sign its digest, verify offline."""
    signer = signer_from_private_key(golden["privateKeyHex"])
    client = RdkTxClient(
        rest_url="http://localhost:1317",
        chain_id="qorechain-diana",
        signer=signer,
    )
    msg = create_rollup_msg(
        CreateRollupInput(
            creator=signer.address,
            rollup_id="my-rollup",
            profile="defi",
            vm_type="evm",
            stake_amount=10000000000,
        )
    )
    sign_doc, body_bytes, auth_info_bytes = client.build_sign_doc(
        [msg], account_number=7, sequence=3
    )
    digest = hashlib.sha256(sign_doc.SerializeToString()).digest()
    signature = signer.sign_digest(digest)
    assert signer.verify_digest(digest, signature)

    # A TxRaw can be assembled and re-parsed; the signature stays valid.
    tx_bytes = client.sign_tx([msg], account_number=7, sequence=3)
    from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxRaw

    tx_raw = TxRaw.FromString(tx_bytes)
    assert tx_raw.body_bytes == body_bytes
    assert tx_raw.auth_info_bytes == auth_info_bytes
    assert len(tx_raw.signatures) == 1
    assert signer.verify_digest(digest, tx_raw.signatures[0])


def test_msg_any_wraps_handencoded_bytes(golden):
    """The Any in the TxBody must carry our hand-encoded msg bytes verbatim."""
    signer = signer_from_private_key(golden["privateKeyHex"])
    client = RdkTxClient(
        rest_url="http://localhost:1317", chain_id="qorechain-diana", signer=signer
    )
    msg = create_rollup_msg(
        CreateRollupInput(
            creator=signer.address, rollup_id="my-rollup", profile="defi", vm_type="evm", stake_amount=10000000000
        )
    )
    sign_doc, body_bytes, _ = client.build_sign_doc([msg], account_number=0, sequence=0)
    from cosmpy.protos.cosmos.tx.v1beta1.tx_pb2 import TxBody

    body = TxBody.FromString(body_bytes)
    assert body.messages[0].type_url == "/qorechain.rdk.v1.MsgCreateRollup"
    assert body.messages[0].value == msg.value
