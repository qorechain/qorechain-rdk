//! Denomination conversion between display units (QOR) and base units (uqor).
//!
//! Uses exact integer/string math only -- never floating point -- so values are
//! exact.

use crate::constants::DENOM_EXPONENT;
use thiserror::Error;

/// A denomination conversion error.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum DenomError {
    /// The input was not a valid non-negative decimal QOR amount.
    #[error("invalid QOR amount: \"{0}\"")]
    InvalidQor(String),
    /// The QOR amount had more fractional digits than the exponent allows.
    #[error("QOR amount \"{0}\" has more than {1} fractional digits")]
    TooManyFractionalDigits(String, u32),
    /// The input was not a valid non-negative integer uqor amount.
    #[error("invalid uqor amount: \"{0}\"")]
    InvalidUqor(String),
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Convert a display amount (QOR) to base units (uqor) as an integer string.
///
/// # Errors
///
/// Returns an error if the input is not a non-negative decimal or has more than
/// `exponent` fractional digits.
pub fn qor_to_uqor(amount: &str, exponent: u32) -> Result<String, DenomError> {
    let s = amount.trim();
    let (whole, frac) = match s.split_once('.') {
        Some((w, f)) => (w, f),
        None => (s, ""),
    };
    if !is_digits(whole) || (!frac.is_empty() && !is_digits(frac)) {
        return Err(DenomError::InvalidQor(amount.to_string()));
    }
    let exp = exponent as usize;
    if frac.len() > exp {
        return Err(DenomError::TooManyFractionalDigits(
            amount.to_string(),
            exponent,
        ));
    }
    let mut frac_padded = String::from(frac);
    while frac_padded.len() < exp {
        frac_padded.push('0');
    }
    let combined = format!("{whole}{frac_padded}");
    // Strip leading zeros while keeping at least one digit.
    let trimmed = combined.trim_start_matches('0');
    Ok(if trimmed.is_empty() {
        "0".to_string()
    } else {
        trimmed.to_string()
    })
}

/// Convert base units (uqor) to a display amount (QOR), trimming trailing zeros.
///
/// # Errors
///
/// Returns an error if the input is not a non-negative integer string.
pub fn uqor_to_qor(amount: &str, exponent: u32) -> Result<String, DenomError> {
    let t = amount.trim();
    if !is_digits(t) {
        return Err(DenomError::InvalidUqor(amount.to_string()));
    }
    let value: u128 = t
        .parse()
        .map_err(|_| DenomError::InvalidUqor(amount.to_string()))?;
    let base = 10u128.pow(exponent);
    let whole = value / base;
    let frac = value % base;
    if frac == 0 {
        return Ok(whole.to_string());
    }
    let exp = exponent as usize;
    let frac_str = format!("{frac:0>exp$}");
    let frac_trimmed = frac_str.trim_end_matches('0');
    Ok(format!("{whole}.{frac_trimmed}"))
}

/// Convert QOR to uqor using the network's default exponent (10^6).
pub fn qor_to_uqor_default(amount: &str) -> Result<String, DenomError> {
    qor_to_uqor(amount, DENOM_EXPONENT)
}

/// Convert uqor to QOR using the network's default exponent (10^6).
pub fn uqor_to_qor_default(amount: &str) -> Result<String, DenomError> {
    uqor_to_qor(amount, DENOM_EXPONENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qor_to_uqor_cases() {
        assert_eq!(qor_to_uqor("1.5", 6).unwrap(), "1500000");
        assert_eq!(qor_to_uqor("0.000001", 6).unwrap(), "1");
        assert_eq!(qor_to_uqor("0", 6).unwrap(), "0");
        assert!(qor_to_uqor("1.1234567", 6).is_err());
        assert!(qor_to_uqor("abc", 6).is_err());
    }

    #[test]
    fn uqor_to_qor_cases() {
        assert_eq!(uqor_to_qor("10000000000", 6).unwrap(), "10000");
        assert_eq!(uqor_to_qor("1500000", 6).unwrap(), "1.5");
        assert_eq!(uqor_to_qor("0", 6).unwrap(), "0");
        assert!(uqor_to_qor("1.5", 6).is_err());
    }
}
