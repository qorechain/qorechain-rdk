//! Configuration error type.

use std::fmt;

/// Returned when a rollup configuration fails validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RollupConfigError {
    /// The individual validation failures.
    pub errors: Vec<String>,
}

impl RollupConfigError {
    /// Build an error from a list of validation failures.
    pub fn new(errors: Vec<String>) -> Self {
        Self { errors }
    }
}

impl fmt::Display for RollupConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Invalid rollup configuration:")?;
        for e in &self.errors {
            write!(f, "\n- {e}")?;
        }
        Ok(())
    }
}

impl std::error::Error for RollupConfigError {}
