//! `core-webform` — autofill live HTML forms from the vault.
//!
//! For forms that are web pages (not files): a WebForm catalog entry maps DOM
//! selectors to canonical ontology keys. [`fill_plan`] joins that with a Profile
//! vault to produce per-field fill instructions, which the in-app webview injects
//! **locally** — nothing is sent until the user submits on the site.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A field of a live web form: a DOM selector and the canonical key that fills it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomField {
    /// CSS/XPath selector for the input element.
    pub selector: String,
    /// Canonical ontology key (e.g. `full_name`).
    pub ontology_key: String,
}

/// An instruction to set one DOM field's value (injected locally in the webview).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FillInstruction {
    /// Target selector.
    pub selector: String,
    /// Value from the vault.
    pub value: String,
}

/// Build a fill plan: for each mapped DOM field that the vault can fill, an
/// instruction. Fields the vault lacks are skipped (the user provides them).
pub fn fill_plan(fields: &[DomField], vault: &BTreeMap<String, String>) -> Vec<FillInstruction> {
    fields
        .iter()
        .filter_map(|f| {
            vault.get(&f.ontology_key).map(|v| FillInstruction {
                selector: f.selector.clone(),
                value: v.clone(),
            })
        })
        .collect()
}

/// A sample WebForm DOM map (mirrors the catalog's Bank-KYC web form).
pub fn demo_web_fields() -> Vec<DomField> {
    vec![
        DomField {
            selector: "#full_name".into(),
            ontology_key: "full_name".into(),
        },
        DomField {
            selector: "input[name=phone]".into(),
            ontology_key: "phone".into(),
        },
        DomField {
            selector: "#address".into(),
            ontology_key: "address".into(),
        },
    ]
}

/// Returns this crate's stable module name.
pub fn module_name() -> &'static str {
    "core-webform"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_plan_maps_present_keys_only() {
        let fields = vec![
            DomField {
                selector: "#name".into(),
                ontology_key: "full_name".into(),
            },
            DomField {
                selector: "#phone".into(),
                ontology_key: "phone".into(),
            },
        ];
        let mut vault = BTreeMap::new();
        vault.insert("full_name".to_string(), "Asha Rao".to_string());
        // phone missing

        let plan = fill_plan(&fields, &vault);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].selector, "#name");
        assert_eq!(plan[0].value, "Asha Rao");
    }

    #[test]
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-webform");
    }
}
