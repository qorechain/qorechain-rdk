//! The closed sets of values the `rdk` module accepts, as Rust enums plus the
//! matching runtime arrays (for validation and enumeration).
//!
//! These mirror the on-chain `rdk` module exactly. The strings are the wire
//! values the chain expects -- do not localize or re-case them.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Error returned when a wire string does not name a known enum variant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseEnumError {
    /// The kind of enum that failed to parse (e.g. `"settlement paradigm"`).
    pub kind: &'static str,
    /// The offending value.
    pub value: String,
}

impl fmt::Display for ParseEnumError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "\"{}\" is not a valid {}", self.value, self.kind)
    }
}

impl std::error::Error for ParseEnumError {}

macro_rules! wire_enum {
    (
        $(#[$meta:meta])*
        $name:ident, $kind:literal, $arr:ident => {
            $( $variant:ident => $wire:literal ),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub enum $name {
            $(
                #[doc = concat!("Wire value `", $wire, "`.")]
                $variant,
            )+
        }

        impl $name {
            /// The wire value the chain expects.
            pub const fn as_str(self) -> &'static str {
                match self {
                    $( $name::$variant => $wire, )+
                }
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }

        impl FromStr for $name {
            type Err = ParseEnumError;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                match s {
                    $( $wire => Ok($name::$variant), )+
                    other => Err(ParseEnumError { kind: $kind, value: other.to_string() }),
                }
            }
        }

        impl TryFrom<String> for $name {
            type Error = ParseEnumError;
            fn try_from(s: String) -> Result<Self, Self::Error> {
                s.parse()
            }
        }

        impl From<$name> for String {
            fn from(v: $name) -> String {
                v.as_str().to_string()
            }
        }

        /// All variants, in declaration order.
        pub const $arr: &[$name] = &[ $( $name::$variant, )+ ];
    };
}

wire_enum! {
    /// How a rollup settles to the Main Chain.
    Settlement, "settlement paradigm", SETTLEMENT_PARADIGMS => {
        Optimistic => "optimistic",
        Zk => "zk",
        Based => "based",
        Sovereign => "sovereign",
    }
}

wire_enum! {
    /// Who orders the rollup's transactions.
    Sequencer, "sequencer mode", SEQUENCER_MODES => {
        Dedicated => "dedicated",
        Shared => "shared",
        Based => "based",
    }
}

wire_enum! {
    /// The proof a settlement batch carries.
    ProofSystem, "proof system", PROOF_SYSTEMS => {
        Fraud => "fraud",
        Snark => "snark",
        Stark => "stark",
        None => "none",
    }
}

wire_enum! {
    /// Where rollup data is made available.
    DaBackend, "data-availability backend", DA_BACKENDS => {
        Native => "native",
        Celestia => "celestia",
        Both => "both",
    }
}

wire_enum! {
    /// The fee model the rollup charges.
    GasModel, "gas model", GAS_MODELS => {
        Standard => "standard",
        Eip1559 => "eip1559",
        Flat => "flat",
        Subsidized => "subsidized",
    }
}

/// The execution environment the rollup exposes.
///
/// - `Evm` — Ethereum/Solidity.
/// - `Native` — the QoreChain Native runtime (Wasm smart contracts).
/// - `Svm` — the Solana VM.
/// - `Custom` — an application-defined VM.
///
/// `CosmWasm` is a legacy alias of `Native`: both serialize to `cosmwasm` on the
/// wire (the network, explorer, and dashboard use `cosmwasm`), and the alias is
/// accepted when deserializing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub enum VmType {
    /// Wire value `evm`.
    Evm,
    /// The QoreChain Native runtime (Wasm). Wire value `cosmwasm`.
    Native,
    /// Legacy alias of [`VmType::Native`]. Wire value `cosmwasm`.
    CosmWasm,
    /// Wire value `svm`.
    Svm,
    /// Wire value `custom`.
    Custom,
}

impl VmType {
    /// The wire value the chain expects. The QoreChain Native runtime (both
    /// `Native` and the `CosmWasm` alias) is transmitted as `cosmwasm`.
    pub const fn as_str(self) -> &'static str {
        match self {
            VmType::Evm => "evm",
            VmType::Native | VmType::CosmWasm => "cosmwasm",
            VmType::Svm => "svm",
            VmType::Custom => "custom",
        }
    }

    /// A human-readable label. The Wasm runtime reads as `QoreChain Native`.
    pub const fn label(self) -> &'static str {
        match self {
            VmType::Native | VmType::CosmWasm => "QoreChain Native",
            VmType::Evm => "EVM",
            VmType::Svm => "SVM",
            VmType::Custom => "Custom",
        }
    }
}

impl fmt::Display for VmType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for VmType {
    type Err = ParseEnumError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "evm" => Ok(VmType::Evm),
            // The advertised runtime name and its legacy wire alias both map to
            // the QoreChain Native runtime.
            "native" | "cosmwasm" => Ok(VmType::Native),
            "svm" => Ok(VmType::Svm),
            "custom" => Ok(VmType::Custom),
            other => Err(ParseEnumError {
                kind: "VM type",
                value: other.to_string(),
            }),
        }
    }
}

impl TryFrom<String> for VmType {
    type Error = ParseEnumError;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        s.parse()
    }
}

impl From<VmType> for String {
    fn from(v: VmType) -> String {
        v.as_str().to_string()
    }
}

/// The advertised VM types (`Native` is the QoreChain Native runtime). The
/// `CosmWasm` alias is accepted but intentionally kept out of this list.
pub const VM_TYPES: &[VmType] = &[VmType::Evm, VmType::Native, VmType::Svm, VmType::Custom];

/// The advertised VM-type wire-ish names, as strings (`native` is advertised in
/// place of the `cosmwasm` alias).
const ADVERTISED_VM_TYPE_NAMES: &[&str] = &["evm", "native", "svm", "custom"];

/// Whether `value` names a VM type the RDK accepts (the four advertised names
/// plus the `cosmwasm` legacy alias).
pub fn is_vm_type(value: &str) -> bool {
    ADVERTISED_VM_TYPE_NAMES.contains(&value) || value == "cosmwasm"
}

/// The on-chain wire value for a VM-type name. The QoreChain Native runtime
/// (`native`) is transmitted as `cosmwasm` for consistency with the network,
/// explorer, and dashboard; every other value passes through unchanged.
pub fn vm_type_wire_value(vm_type: &str) -> &str {
    if vm_type == "native" {
        "cosmwasm"
    } else {
        vm_type
    }
}

/// A human-readable label for a VM-type name (the Wasm runtime reads as
/// `QoreChain Native`). Unknown values pass through unchanged.
pub fn vm_type_label(vm_type: &str) -> &str {
    match vm_type {
        "native" | "cosmwasm" => "QoreChain Native",
        "evm" => "EVM",
        "svm" => "SVM",
        "custom" => "Custom",
        other => other,
    }
}

wire_enum! {
    /// Rollup lifecycle states.
    RollupStatus, "rollup status", ROLLUP_STATUSES => {
        Pending => "pending",
        Active => "active",
        Paused => "paused",
        Stopped => "stopped",
    }
}

wire_enum! {
    /// Settlement-batch lifecycle states.
    BatchStatus, "batch status", BATCH_STATUSES => {
        Submitted => "submitted",
        Challenged => "challenged",
        Finalized => "finalized",
        Rejected => "rejected",
    }
}

wire_enum! {
    /// The five preset profiles.
    Profile, "profile name", PROFILE_NAMES => {
        Defi => "defi",
        Gaming => "gaming",
        Nft => "nft",
        Enterprise => "enterprise",
        Custom => "custom",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_strings_roundtrip() {
        assert_eq!(Settlement::Optimistic.as_str(), "optimistic");
        assert_eq!("zk".parse::<Settlement>().unwrap(), Settlement::Zk);
        assert_eq!(VmType::CosmWasm.as_str(), "cosmwasm");
        assert!("bogus".parse::<Profile>().is_err());
        assert_eq!(SETTLEMENT_PARADIGMS.len(), 4);
        assert_eq!(PROFILE_NAMES.len(), 5);
    }
}
