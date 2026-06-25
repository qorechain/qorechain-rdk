//! Preflight checks -- the engine behind a `doctor` command. Verifies, in plain
//! language, that a developer is ready to create/operate a rollup: endpoints
//! reachable, network as expected, module params readable, config valid, a
//! signer configured, and the operator balance covering the stake plus a fee
//! buffer.

use crate::client::RdkClient;
use crate::config::{validate_rollup_config, RollupConfig};
use crate::constants::{Network, BASE_DENOM};
use crate::utils::denom::uqor_to_qor_default;

/// A check outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckStatus {
    /// The check passed.
    Ok,
    /// The check passed with a caveat.
    Warn,
    /// The check failed.
    Fail,
}

/// A single preflight check result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreflightCheck {
    /// A stable identifier.
    pub id: String,
    /// A human-readable label.
    pub label: String,
    /// The outcome.
    pub status: CheckStatus,
    /// An optional detail line.
    pub detail: Option<String>,
    /// An optional remediation hint.
    pub hint: Option<String>,
}

/// The overall preflight result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreflightResult {
    /// True when no check failed (warnings are allowed).
    pub ok: bool,
    /// The individual checks.
    pub checks: Vec<PreflightCheck>,
}

/// Options for [`check_preflight`].
#[derive(Default)]
pub struct PreflightOptions<'a> {
    /// A rollup config to validate.
    pub config: Option<&'a RollupConfig>,
    /// The operator/signer address.
    pub signer_address: Option<String>,
    /// Assert the client is pointed at this network.
    pub expected_network: Option<Network>,
    /// Extra uqor buffer to require on top of the stake (fees). Default 1 QOR.
    pub fee_buffer_uqor: Option<u128>,
}

/// Run the preflight checks against a client.
pub fn check_preflight(client: &RdkClient, options: PreflightOptions<'_>) -> PreflightResult {
    let mut checks: Vec<PreflightCheck> = Vec::new();
    let mut params = None;

    match client.params() {
        Ok(p) => {
            checks.push(PreflightCheck {
                id: "rest".to_string(),
                label: "REST endpoint reachable".to_string(),
                status: CheckStatus::Ok,
                detail: Some(client.network.endpoints.rest.clone()),
                hint: None,
            });
            let stake_qor = uqor_to_qor_default(&p.min_stake_for_rollup)
                .unwrap_or_else(|_| p.min_stake_for_rollup.clone());
            let burn_pct = p
                .rollup_creation_burn_rate
                .parse::<f64>()
                .map(|r| r * 100.0)
                .unwrap_or(0.0);
            checks.push(PreflightCheck {
                id: "params".to_string(),
                label: "Module parameters readable".to_string(),
                status: CheckStatus::Ok,
                detail: Some(format!("min stake {stake_qor} QOR, burn {burn_pct}%")),
                hint: None,
            });
            params = Some(p);
        }
        Err(e) => {
            checks.push(PreflightCheck {
                id: "rest".to_string(),
                label: "REST endpoint reachable".to_string(),
                status: CheckStatus::Fail,
                detail: Some(e.to_string()),
                hint: Some("Set the REST (LCD) endpoint to a reachable node.".to_string()),
            });
        }
    }

    if let Some(expected) = options.expected_network {
        let matches = client.network.name == expected;
        checks.push(PreflightCheck {
            id: "network".to_string(),
            label: "Network matches expectation".to_string(),
            status: if matches {
                CheckStatus::Ok
            } else {
                CheckStatus::Warn
            },
            detail: Some(format!(
                "client is {} ({})",
                client.network.name.as_str(),
                client.network.chain_id
            )),
            hint: if matches {
                None
            } else {
                Some(format!("Expected {}.", expected.as_str()))
            },
        });
    }

    if let Some(config) = options.config {
        let r = validate_rollup_config(config);
        let status = if r.valid {
            if r.warnings.is_empty() {
                CheckStatus::Ok
            } else {
                CheckStatus::Warn
            }
        } else {
            CheckStatus::Fail
        };
        let detail = if r.valid {
            r.warnings
                .first()
                .cloned()
                .or_else(|| Some("compatibility matrix satisfied".to_string()))
        } else {
            r.errors.first().cloned()
        };
        checks.push(PreflightCheck {
            id: "config".to_string(),
            label: "Rollup config valid".to_string(),
            status,
            detail,
            hint: if r.valid {
                None
            } else {
                Some("Fix the configuration errors before creating.".to_string())
            },
        });
    }

    if let Some(addr) = &options.signer_address {
        checks.push(PreflightCheck {
            id: "signer".to_string(),
            label: "Signer configured".to_string(),
            status: CheckStatus::Ok,
            detail: Some(addr.clone()),
            hint: None,
        });
        if let Some(p) = &params {
            match client.rest.get_balance(addr, BASE_DENOM) {
                Ok(bal) => {
                    let stake = p.min_stake_for_rollup.parse::<u128>().unwrap_or(0);
                    let buffer = options.fee_buffer_uqor.unwrap_or(1_000_000);
                    let required = stake + buffer;
                    let have = bal.parse::<u128>().unwrap_or(0);
                    let ok = have >= required;
                    checks.push(PreflightCheck {
                        id: "balance".to_string(),
                        label: "Balance covers stake + fees".to_string(),
                        status: if ok {
                            CheckStatus::Ok
                        } else {
                            CheckStatus::Fail
                        },
                        detail: Some(format!(
                            "have {} QOR, need ~{} QOR",
                            uqor_to_qor_default(&bal).unwrap_or(bal.clone()),
                            uqor_to_qor_default(&required.to_string())
                                .unwrap_or_else(|_| required.to_string())
                        )),
                        hint: if ok {
                            None
                        } else {
                            Some("Fund the operator account.".to_string())
                        },
                    });
                }
                Err(e) => {
                    checks.push(PreflightCheck {
                        id: "balance".to_string(),
                        label: "Balance readable".to_string(),
                        status: CheckStatus::Warn,
                        detail: Some(e.to_string()),
                        hint: None,
                    });
                }
            }
        }
    } else {
        checks.push(PreflightCheck {
            id: "signer".to_string(),
            label: "Signer configured".to_string(),
            status: CheckStatus::Warn,
            detail: Some("no signer".to_string()),
            hint: Some("Provide a signer to create/operate.".to_string()),
        });
    }

    let ok = checks.iter().all(|c| c.status != CheckStatus::Fail);
    PreflightResult { ok, checks }
}
