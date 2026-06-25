"""The offline MockTxClient backend: records calls, fakes broadcast, simulates gas."""

from __future__ import annotations

from qorechain_rdk import MockTxClient, RdkTxClient
from qorechain_rdk.enums import RollupStatus


def test_mock_records_create_and_full_lifecycle_offline():
    """create + pause/resume/stop run through the wrapped client with no node."""
    mock = MockTxClient(address="qor1creator")
    tx = RdkTxClient.from_backend(mock)
    assert tx.address == "qor1creator"

    created = tx.create_rollup(
        rollup_id="my-rollup", profile="defi", vm_type="evm", stake_amount=10000000000
    )
    assert created.code == 0
    assert created.tx_hash == "MOCK_TX_HASH"

    paused = tx.pause_rollup(
        rollup_id="my-rollup", reason="maintenance", current_status=RollupStatus.ACTIVE
    )
    assert paused.code == 0

    resumed = tx.resume_rollup(
        rollup_id="my-rollup", current_status=RollupStatus.PAUSED
    )
    assert resumed.code == 0

    stopped = tx.stop_rollup(
        rollup_id="my-rollup", current_status=RollupStatus.ACTIVE
    )
    assert stopped.code == 0

    # Four broadcasts recorded, in order, each carrying exactly one rdk message.
    assert len(mock.calls) == 4
    type_urls = [call.messages[0].type_url for call in mock.calls]
    assert type_urls == [
        "/qorechain.rdk.v1.MsgCreateRollup",
        "/qorechain.rdk.v1.MsgPauseRollup",
        "/qorechain.rdk.v1.MsgResumeRollup",
        "/qorechain.rdk.v1.MsgStopRollup",
    ]
    for call in mock.calls:
        assert len(call.messages) == 1


def test_mock_simulate_returns_fixed_gas():
    mock = MockTxClient(address="qor1creator", gas_estimate=99000)
    tx = RdkTxClient.from_backend(mock)

    from qorechain_rdk import CreateRollupInput, create_rollup_msg

    msg = create_rollup_msg(
        CreateRollupInput(
            creator="qor1creator",
            rollup_id="r",
            profile="defi",
            vm_type="evm",
            stake_amount=1,
        )
    )
    assert tx.simulate([msg]) == 99000
    # Simulation does not broadcast.
    assert mock.calls == []


def test_mock_custom_tx_hash():
    mock = MockTxClient(address="qor1abc", tx_hash="CUSTOM")
    tx = RdkTxClient.from_backend(mock)
    result = tx.create_rollup(
        rollup_id="r", profile="defi", vm_type="evm", stake_amount=1
    )
    assert result.tx_hash == "CUSTOM"
