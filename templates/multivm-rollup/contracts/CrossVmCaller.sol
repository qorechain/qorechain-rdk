// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/// @title CrossVmCaller
/// @notice Calls a QoreChain Native (Wasm) contract from EVM (Solidity) through
/// QoreChain's cross-VM precompile.
///
/// READ BEFORE DEPLOYING. The precompile is not active on qorechain-vladi
/// (mainnet) or qorechain-diana (testnet) today: it runs only once governance
/// lists 0x…0901 in the EVM parameter `active_static_precompiles`, and from
/// chain v3.2.3 it reaches only targets governance allowlists in the cross-VM
/// parameter `bridge_allowed_targets`. Check with the RDK's
/// `isCrossVmPrecompileActive()` (or `GET /cosmos/evm/vm/v1/params`).
///
/// While it is inactive, 0x…0901 is an address with no code, and a call to it
/// SUCCEEDS with empty return data. A `success` check alone therefore reports a
/// call that never happened — which is what this example did before 0.6.0.
contract CrossVmCaller {
    /// The fixed cross-VM precompile address (EVM -> QoreChain Native).
    address constant CROSS_VM_PRECOMPILE = 0x0000000000000000000000000000000000000901;

    /// The precompile's `targetVM` for a QoreChain Native (Wasm) contract.
    /// (0 is EVM, which the chain refuses from EVM since v3.2.3.)
    uint8 constant TARGET_NATIVE = 1;

    /// @param nativeContract the target QoreChain Native (Wasm) contract (bech32 "qor..." string)
    /// @param msg_ the QoreChain Native (Wasm) execute message (UTF-8 JSON bytes)
    /// @return result the target's raw reply
    function callNative(string calldata nativeContract, bytes calldata msg_)
        external
        returns (bytes memory result)
    {
        // The chain decodes executeCrossVMCall(uint8 targetVM, string, bytes).
        // Releases before 0.6.0 used a two-argument (string,bytes) form, whose
        // selector the precompile never matched.
        bytes memory callData = abi.encodeWithSignature(
            "executeCrossVMCall(uint8,string,bytes)", TARGET_NATIVE, nativeContract, msg_
        );
        (bool ok, bytes memory ret) = CROSS_VM_PRECOMPILE.call(callData);
        require(ok, "cross-VM call failed");

        // The precompile returns the target's RAW reply, so an empty reply can
        // also be genuine — and a precompile has no bytecode whether active or
        // not, so extcodesize cannot tell either. The only in-contract guard
        // that holds is a target that always returns a non-empty acknowledgement.
        // Make yours do so, and this line then rejects an inactive precompile.
        require(
            ret.length > 0,
            "cross-VM precompile inactive, or the target returned no acknowledgement"
        );
        return ret;
    }
}
