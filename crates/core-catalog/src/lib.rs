//! `core-catalog` — public form knowledge + **catalog-first autofill**.
//!
//! A `CatalogEntry` carries a `FieldMap` (public, no user data). Autofill joins
//! the field-map's ontology keys with a Profile vault on-device — catalogued
//! forms skip OCR/detection entirely.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The kind of form an entry describes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum FormKind {
    /// A PDF document.
    Pdf,
    /// A Word document.
    Docx,
    /// An Excel workbook.
    Xlsx,
    /// A live HTML web form.
    WebForm,
}

/// One field: how it presents + its canonical ontology key (used to match the vault).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FieldSpec {
    /// Field name aligned to the ask (e.g. "Full name").
    pub name: String,
    /// Canonical ontology key (e.g. "full_name").
    pub ontology_key: String,
}

/// A public form's field layout (positions/selectors omitted in this stub).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FieldMap {
    /// The fields, in document order.
    pub fields: Vec<FieldSpec>,
}

/// A known public form in the catalog.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CatalogEntry {
    /// Stable id.
    pub id: String,
    /// Human name.
    pub name: String,
    /// Form kind.
    pub kind: FormKind,
    /// The field layout.
    pub field_map: FieldMap,
}

/// A field filled from the vault (value is `None` when the vault lacks the key).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FilledField {
    /// Field name.
    pub name: String,
    /// Canonical key.
    pub ontology_key: String,
    /// Value from the vault, or `None`.
    pub value: Option<String>,
}

/// Catalog-first autofill: join a field-map with a Profile vault by ontology key.
pub fn autofill(entry: &CatalogEntry, vault: &BTreeMap<String, String>) -> Vec<FilledField> {
    entry
        .field_map
        .fields
        .iter()
        .map(|f| FilledField {
            name: f.name.clone(),
            ontology_key: f.ontology_key.clone(),
            value: vault.get(&f.ontology_key).cloned(),
        })
        .collect()
}

/// A built-in sample entry for the Phase-1 demo (a passport application form).
pub fn demo_entry() -> CatalogEntry {
    CatalogEntry {
        id: "sample.passport.v1".into(),
        name: "Sample Passport Application".into(),
        kind: FormKind::Pdf,
        field_map: FieldMap {
            fields: vec![
                FieldSpec {
                    name: "Full name".into(),
                    ontology_key: "full_name".into(),
                },
                FieldSpec {
                    name: "Date of birth".into(),
                    ontology_key: "date_of_birth".into(),
                },
                FieldSpec {
                    name: "Nationality".into(),
                    ontology_key: "nationality".into(),
                },
            ],
        },
    }
}

/// Returns this crate's stable module name.
pub fn module_name() -> &'static str {
    "core-catalog"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autofill_joins_vault_by_ontology_key() {
        let mut v = BTreeMap::new();
        v.insert("full_name".to_string(), "Asha Rao".to_string());
        v.insert("date_of_birth".to_string(), "1990-01-01".to_string());

        let filled = autofill(&demo_entry(), &v);
        assert_eq!(filled.len(), 3);
        assert_eq!(filled[0].value.as_deref(), Some("Asha Rao"));
        assert_eq!(filled[1].value.as_deref(), Some("1990-01-01"));
        // nationality absent from the vault -> None (prompts a new DataPoint)
        assert_eq!(filled[2].value, None);
    }

    #[test]
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-catalog");
    }
}
