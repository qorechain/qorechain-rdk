"""Address derivation and signer-from-env."""

from __future__ import annotations

import hashlib

from qorechain_rdk import (
    Signer,
    derive_native_account,
    generate_mnemonic,
    signer_from_env,
    signer_from_private_key,
    validate_mnemonic,
)


def test_address_matches_golden(golden):
    account = derive_native_account(golden["mnemonic"])
    assert account.address == golden["nativeAddress"]
    assert account.private_key_hex == golden["privateKeyHex"]
    assert len(account.public_key) == 33


def test_validate_mnemonic(golden):
    assert validate_mnemonic(golden["mnemonic"])
    assert not validate_mnemonic("not a real mnemonic at all here")


def test_generated_mnemonic_is_valid():
    mnemonic = generate_mnemonic()
    assert validate_mnemonic(mnemonic)
    assert len(mnemonic.split()) == 12


def test_signer_from_private_key_address(golden):
    signer = signer_from_private_key(golden["privateKeyHex"])
    assert signer.address == golden["nativeAddress"]


def test_signer_from_env_prefers_hex(golden):
    env = {"QORE_OPERATOR_PRIVATE_KEY_HEX": golden["privateKeyHex"]}
    signer = signer_from_env(env)
    assert signer is not None
    assert signer.address == golden["nativeAddress"]


def test_signer_from_env_mnemonic(golden):
    env = {"QORE_MNEMONIC": golden["mnemonic"]}
    signer = signer_from_env(env)
    assert signer is not None
    assert signer.address == golden["nativeAddress"]


def test_signer_from_env_none_when_unset():
    assert signer_from_env({}) is None


def test_sign_verify_roundtrip(golden):
    signer = signer_from_private_key(golden["privateKeyHex"])
    digest = hashlib.sha256(b"qorechain rdk test message").digest()
    signature = signer.sign_digest(digest)
    assert len(signature) == 64
    assert signer.verify_digest(digest, signature)
    # A different digest must not verify.
    other = hashlib.sha256(b"different").digest()
    assert not signer.verify_digest(other, signature)
