"""The QoreChain Native vm-type alias.

Mirrors ``ts/test/vmtype.test.ts``: ``native`` is advertised (``cosmwasm`` is a
legacy alias accepted but not advertised), maps to the ``cosmwasm`` wire value,
and labels as "QoreChain Native".
"""

from __future__ import annotations

from qorrdk import (
    VM_TYPES,
    is_vm_type,
    presets,
    validate_rollup_config,
    vm_type_label,
    vm_type_wire_value,
)
from qorrdk.tx import CreateRollupInput, create_rollup_msg


def test_advertises_native_not_cosmwasm():
    assert "native" in VM_TYPES
    assert "cosmwasm" not in VM_TYPES


def test_accepts_native_evm_svm_custom_and_cosmwasm_alias():
    for value in ("native", "evm", "svm", "custom", "cosmwasm"):
        assert is_vm_type(value) is True
    assert is_vm_type("wasm2") is False


def test_native_maps_to_cosmwasm_wire_value_others_pass_through():
    assert vm_type_wire_value("native") == "cosmwasm"
    assert vm_type_wire_value("cosmwasm") == "cosmwasm"
    assert vm_type_wire_value("evm") == "evm"
    assert vm_type_wire_value("svm") == "svm"


def test_labels_wasm_runtime_as_qorechain_native():
    assert vm_type_label("native") == "QoreChain Native"
    assert vm_type_label("cosmwasm") == "QoreChain Native"
    assert vm_type_label("evm") == "EVM"
    assert vm_type_label("svm") == "SVM"
    assert vm_type_label("custom") == "Custom"


def test_emits_cosmwasm_on_the_wire_when_config_says_native():
    msg = create_rollup_msg(
        CreateRollupInput(
            creator="qor1creator",
            rollup_id="r",
            profile="nft",
            vm_type="native",
            stake_amount=1,
        )
    )
    # The vm_type field is encoded as its wire value: cosmwasm, never native.
    assert b"cosmwasm" in msg.value
    assert b"native" not in msg.value


def test_validates_native_and_the_nft_preset_now_native():
    cfg = presets.nft("r").build()
    assert getattr(cfg.vm_type, "value", cfg.vm_type) == "native"
    assert validate_rollup_config(cfg).valid is True
