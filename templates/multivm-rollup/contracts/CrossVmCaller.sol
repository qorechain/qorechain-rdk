// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/// @title CrossVmCaller
/// @notice Calls a QoreChain Native (Wasm) contract from EVM (Solidity) through
/// QoreChain's cross-VM precompile.
///
/// READ BEFORE DEPLOYING. The precompile is not active on qorechain-vladi
/// (mainnet) or qorechain-diana (testnet) today: it runs only once governance
/// lists 0x…0901 in the EVM parameter `active_static_precompiles`, and it
/// reaches only the targets governance allowlists in the cross-VM parameter
/// `bridge_allowed_targets` (served at /qorechain/crossvm/v1/params). Check
/// both with the RDK's `crossVmTargetReady()`.
///
/// From chain v3.2.5 the precompile answers only
/// `executeCrossVMCall(uint8,string,bytes) returns (bytes)` and ABI-encodes
/// its result, so an active precompile always returns at least 64 bytes; a
/// refusal reverts with `Error(string)`. While it is inactive, 0x…0901 has no
/// code and a call to it SUCCEEDS with empty return data, which is why the
/// length check below matters. The Native contract sees THIS contract (as its
/// qor1 address) as the sender, not `tx.origin`.
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
        if (!ok) {
            // Pass the chain's reason through (e.g. "target ... is not allowlisted").
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        // Empty data: the precompile is not active, and the call reached nothing.
        require(ret.length >= 64, "cross-VM precompile inactive: the call reached no contract");
        // The Native contract's response data (often empty).
        result = abi.decode(ret, (bytes));
    }
}
