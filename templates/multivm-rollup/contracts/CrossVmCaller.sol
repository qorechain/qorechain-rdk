// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/// @title CrossVmCaller
/// @notice Minimal example of calling a CosmWasm contract from EVM (Solidity)
/// through QoreChain's cross-VM precompile.
///
/// The precompile lives at a fixed address and exposes `executeCrossVMCall`.
/// Confirm the exact ABI signature against your node — this example assumes
/// `executeCrossVMCall(string contractAddr, bytes msg)`.
contract CrossVmCaller {
    /// The fixed cross-VM precompile address (EVM -> CosmWasm).
    address constant CROSS_VM_PRECOMPILE = 0x0000000000000000000000000000000000000901;

    /// @param cosmwasmContract the target CosmWasm contract (bech32 "qor..." string)
    /// @param msg_ the CosmWasm execute message (UTF-8 JSON bytes)
    function callCosmWasm(string calldata cosmwasmContract, bytes calldata msg_)
        external
        returns (bytes memory result)
    {
        bytes memory callData =
            abi.encodeWithSignature("executeCrossVMCall(string,bytes)", cosmwasmContract, msg_);
        (bool ok, bytes memory ret) = CROSS_VM_PRECOMPILE.call(callData);
        require(ok, "cross-VM call failed");
        return ret;
    }
}
