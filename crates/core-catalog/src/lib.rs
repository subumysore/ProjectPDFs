//! `core-catalog` — public form knowledge + **catalog-first autofill** + **search**.
//!
//! A `CatalogEntry` carries a `FieldMap` (public, no user data). Autofill joins
//! the field-map's ontology keys with a Profile vault on-device — catalogued
//! forms skip OCR/detection. Search runs on-device over the synced index, so a
//! user's form-interest never leaves the device.
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

/// The widget kind to create on a flat PDF.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum FieldKind {
    /// A text input.
    #[default]
    Text,
    /// A checkbox.
    CheckBox,
}

/// Where to place a created widget on a (flat) PDF. PDF coordinates: origin at the
/// bottom-left, in points. `page` is 0-based.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct FieldRect {
    /// 0-based page index.
    pub page: u32,
    /// x (points from left).
    pub x: f32,
    /// y (points from bottom).
    pub y: f32,
    /// width (points).
    pub w: f32,
    /// height (points).
    pub h: f32,
}

/// One field: how it presents, its canonical ontology key, and (for flat PDFs)
/// where to CREATE the widget and what kind it is.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldSpec {
    /// Field name aligned to the ask (e.g. "Full name").
    pub name: String,
    /// Canonical ontology key (e.g. "full_name").
    pub ontology_key: String,
    /// Widget kind to create (default Text).
    #[serde(default)]
    pub kind: FieldKind,
    /// Placement on a flat PDF (None = form already has this field, or a web form).
    #[serde(default)]
    pub rect: Option<FieldRect>,
}

/// A public form's field layout (with per-field geometry for flat PDFs).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldMap {
    /// The fields, in document order.
    pub fields: Vec<FieldSpec>,
}

/// A known public form in the catalog.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CatalogEntry {
    /// Stable id.
    pub id: String,
    /// Human name.
    pub name: String,
    /// Form kind.
    pub kind: FormKind,
    /// Issuer/country/topic tags used for search.
    pub tags: Vec<String>,
    /// A stable layout fingerprint used to match an opened document to this entry.
    pub fingerprint: String,
    /// The field layout.
    pub field_map: FieldMap,
}

impl CatalogEntry {
    /// A lightweight summary (for the search index / results — no field map).
    pub fn summary(&self) -> CatalogSummary {
        CatalogSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            kind: self.kind,
            tags: self.tags.clone(),
        }
    }
}

/// A search-result / index summary (no field map).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CatalogSummary {
    /// Stable id.
    pub id: String,
    /// Human name.
    pub name: String,
    /// Form kind.
    pub kind: FormKind,
    /// Search tags.
    pub tags: Vec<String>,
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

/// Case-insensitive search over name + tags, ranked by how many query tokens match.
/// An empty query returns the whole catalog (ordered by name).
pub fn search<'a>(catalog: &'a [CatalogEntry], query: &str) -> Vec<&'a CatalogEntry> {
    let tokens: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
    if tokens.is_empty() {
        let mut all: Vec<&CatalogEntry> = catalog.iter().collect();
        all.sort_by(|a, b| a.name.cmp(&b.name));
        return all;
    }
    let mut scored: Vec<(usize, &CatalogEntry)> = catalog
        .iter()
        .filter_map(|e| {
            let hay = format!("{} {}", e.name, e.tags.join(" ")).to_lowercase();
            let score = tokens.iter().filter(|t| hay.contains(t.as_str())).count();
            (score > 0).then_some((score, e))
        })
        .collect();
    // Higher score first, then name for stability.
    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.cmp(&b.1.name)));
    scored.into_iter().map(|(_, e)| e).collect()
}

/// Match an opened document to a catalog entry by its layout fingerprint.
pub fn match_by_fingerprint<'a>(catalog: &'a [CatalogEntry], fingerprint: &str) -> Option<&'a CatalogEntry> {
    catalog.iter().find(|e| e.fingerprint == fingerprint)
}

/// Look up a catalog entry by id.
pub fn get<'a>(catalog: &'a [CatalogEntry], id: &str) -> Option<&'a CatalogEntry> {
    catalog.iter().find(|e| e.id == id)
}

fn tf(name: &str, key: &str, rect: Option<FieldRect>) -> FieldSpec {
    FieldSpec {
        name: name.into(),
        ontology_key: key.into(),
        kind: FieldKind::Text,
        rect,
    }
}

/// A small built-in catalog for the Phase-1 demo (the on-device index, synced down in production).
/// The passport entry carries **coordinates** so a FLAT PDF (no form fields) can have widgets
/// created + placed + filled. Coordinates are PDF points on an A4 page (595 x 842), origin bottom-left.
pub fn demo_catalog() -> Vec<CatalogEntry> {
    let r = |y: f32| Some(FieldRect { page: 0, x: 180.0, y, w: 320.0, h: 18.0 });
    vec![
        CatalogEntry {
            id: "sample.passport.v1".into(),
            name: "Sample Passport Application".into(),
            kind: FormKind::Pdf,
            tags: vec!["passport".into(), "travel".into(), "identity".into(), "government".into()],
            fingerprint: "fp-passport-v1".into(),
            field_map: FieldMap {
                fields: vec![
                    tf("Full name", "full_name", r(736.0)),
                    tf("Date of birth", "date_of_birth", r(686.0)),
                    tf("Nationality", "nationality", r(636.0)),
                ],
            },
        },
        CatalogEntry {
            id: "sample.driving-licence.v1".into(),
            name: "Sample Driving Licence Application".into(),
            kind: FormKind::Pdf,
            tags: vec!["driving".into(), "licence".into(), "vehicle".into(), "identity".into()],
            fingerprint: "fp-licence-v1".into(),
            field_map: FieldMap {
                fields: vec![
                    tf("Full name", "full_name", None),
                    tf("Date of birth", "date_of_birth", None),
                    tf("Address", "address", None),
                ],
            },
        },
        CatalogEntry {
            id: "sample.bank-kyc.v1".into(),
            name: "Sample Bank KYC Form".into(),
            kind: FormKind::WebForm,
            tags: vec!["bank".into(), "kyc".into(), "finance".into(), "account".into()],
            fingerprint: "fp-bankkyc-v1".into(),
            field_map: FieldMap {
                fields: vec![
                    tf("Full name", "full_name", None),
                    tf("Phone", "phone", None),
                    tf("Address", "address", None),
                ],
            },
        },
    ]
}

/// The sample passport entry (kept for the earlier demo path).
pub fn demo_entry() -> CatalogEntry {
    demo_catalog().into_iter().next().expect("demo catalog non-empty")
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
        assert_eq!(filled[2].value, None); // nationality absent
    }

    #[test]
    fn search_matches_name_and_tags_case_insensitive() {
        let cat = demo_catalog();
        assert_eq!(search(&cat, "PASSPORT")[0].id, "sample.passport.v1");
        assert_eq!(search(&cat, "driving")[0].id, "sample.driving-licence.v1");
        assert_eq!(search(&cat, "kyc")[0].id, "sample.bank-kyc.v1");
        // "identity" tags two forms
        assert_eq!(search(&cat, "identity").len(), 2);
        // empty query returns all
        assert_eq!(search(&cat, "").len(), cat.len());
        // no match
        assert!(search(&cat, "zzz-nope").is_empty());
    }

    #[test]
    fn fingerprint_and_id_lookup() {
        let cat = demo_catalog();
        assert_eq!(match_by_fingerprint(&cat, "fp-licence-v1").unwrap().id, "sample.driving-licence.v1");
        assert!(match_by_fingerprint(&cat, "fp-unknown").is_none());
        assert_eq!(get(&cat, "sample.bank-kyc.v1").unwrap().name, "Sample Bank KYC Form");
    }

    #[test]
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-catalog");
    }
}
