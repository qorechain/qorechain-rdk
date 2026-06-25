//! Rollup-creation economics: the burn taken from a committed stake.

use crate::constants::DEFAULT_ROLLUP_CREATION_BURN_RATE;
use thiserror::Error;

/// An economics computation error.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EconomicsError {
    /// A value expected to be a non-negative integer string was not.
    #[error("{label} must be a non-negative integer string, got \"{value}\"")]
    NotInteger {
        /// What was being parsed.
        label: String,
        /// The offending value.
        value: String,
    },
    /// A decimal string was malformed.
    #[error("invalid decimal: \"{0}\"")]
    InvalidDecimal(String),
}

fn to_u128(value: &str, label: &str) -> Result<u128, EconomicsError> {
    let t = value.trim();
    if t.is_empty() || !t.bytes().all(|b| b.is_ascii_digit()) {
        return Err(EconomicsError::NotInteger {
            label: label.to_string(),
            value: value.to_string(),
        });
    }
    t.parse().map_err(|_| EconomicsError::NotInteger {
        label: label.to_string(),
        value: value.to_string(),
    })
}

/// Multiply an integer amount by a non-negative decimal (e.g. `"0.01"`),
/// flooring the result. Pure integer math -- no floating point -- so the result
/// is exact.
pub fn mul_decimal_floor(amount: u128, decimal: &str) -> Result<u128, EconomicsError> {
    let d = decimal.trim();
    let (whole, frac) = match d.split_once('.') {
        Some((w, f)) => (w, f),
        None => (d, ""),
    };
    let valid = !whole.is_empty()
        && whole.bytes().all(|b| b.is_ascii_digit())
        && (frac.is_empty() || frac.bytes().all(|b| b.is_ascii_digit()));
    if !valid {
        return Err(EconomicsError::InvalidDecimal(decimal.to_string()));
    }
    let scale = 10u128.pow(frac.len() as u32);
    let combined = format!("{whole}{frac}");
    let numerator: u128 = if combined.is_empty() {
        0
    } else {
        combined
            .parse()
            .map_err(|_| EconomicsError::InvalidDecimal(decimal.to_string()))?
    };
    Ok((amount * numerator) / scale)
}

/// The cost breakdown of creating a rollup. All amounts are uqor strings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreationCost {
    /// The stake you commit, in uqor.
    pub stake_uqor: String,
    /// The amount burned on creation, in uqor.
    pub burn_uqor: String,
    /// The stake remaining after the burn, in uqor.
    pub net_stake_uqor: String,
    /// The total leaving your wallet (equal to the committed stake), in uqor.
    pub total_required_uqor: String,
    /// The burn rate applied, as a decimal string.
    pub burn_rate: String,
}

/// Estimate the cost of creating a rollup: the burn taken from the committed
/// stake and the net stake remaining. Pass the live `rollup_creation_burn_rate`
/// from `rdk params()` for an exact figure; defaults to the documented rate.
pub fn estimate_creation_cost(
    stake_uqor: &str,
    burn_rate: Option<&str>,
) -> Result<CreationCost, EconomicsError> {
    let stake = to_u128(stake_uqor, "stakeUqor")?;
    let rate = burn_rate.unwrap_or(DEFAULT_ROLLUP_CREATION_BURN_RATE);
    let burn = mul_decimal_floor(stake, rate)?;
    Ok(CreationCost {
        stake_uqor: stake.to_string(),
        burn_uqor: burn.to_string(),
        net_stake_uqor: (stake - burn).to_string(),
        total_required_uqor: stake.to_string(),
        burn_rate: rate.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creation_cost_matches() {
        let c = estimate_creation_cost("10000000000", None).unwrap();
        assert_eq!(c.burn_uqor, "100000000");
        assert_eq!(c.net_stake_uqor, "9900000000");
        assert_eq!(c.total_required_uqor, "10000000000");
        assert_eq!(c.burn_rate, "0.01");
    }

    #[test]
    fn mul_decimal_floor_cases() {
        assert_eq!(mul_decimal_floor(100, "0.01").unwrap(), 1);
        assert_eq!(mul_decimal_floor(101, "0.01").unwrap(), 1);
        assert_eq!(mul_decimal_floor(5, "2").unwrap(), 10);
    }
}
