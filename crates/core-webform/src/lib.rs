//! `core-webform` — in-app webview autofill (DOM injection)
//!
//! Status: interface stub. Real implementation lands per its spec + tests (see docs/rfc/0001).
#![forbid(unsafe_code)]
#![warn(missing_docs)]

/// Returns this crate's stable module name (placeholder until the real API lands).
pub fn module_name() -> &'static str {
    "core-webform"
}

#[cfg(test)]
mod tests {
    #[test]
    fn module_name_is_stable() {
        assert_eq!(super::module_name(), "core-webform");
    }
}
