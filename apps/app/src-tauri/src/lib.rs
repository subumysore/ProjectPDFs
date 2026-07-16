//! ProjectPDFs native entry point (Tauri v2). Bridges the React UI to the Rust
//! core crates. Real commands (catalog match, fill, sign, export) land per spec.

use core_catalog::{autofill, demo_entry, CatalogEntry, FilledField};
use core_store::{DataPoint, Profile, Store};
use serde::Serialize;

#[derive(Serialize)]
struct CoreModules {
    modules: Vec<&'static str>,
}

/// Result of the Phase-1 catalog-first autofill demo.
#[derive(Serialize)]
struct AutofillResult {
    entry: CatalogEntry,
    filled: Vec<FilledField>,
}

/// Report which native core modules are compiled in (proves the bridge works).
#[tauri::command]
fn core_modules() -> CoreModules {
    CoreModules {
        modules: vec![
            core_store::module_name(),
            core_crypto::module_name(),
            core_catalog::module_name(),
        ],
    }
}

/// Minimal round-trip command used by the Phase-1 shell.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! ProjectPDFs native core is wired and on-device.")
}

/// Phase-1 vertical slice: catalog-first autofill, fully on-device.
///
/// Seeds an in-memory vault, matches a catalogued form's field-map, and fills it
/// from the vault by ontology key. (Real flow: open form -> match catalog ->
/// autofill the user's Profile vault. Persistence is in `core-store`.)
#[tauri::command]
fn demo_autofill() -> Result<AutofillResult, String> {
    let store = Store::open(":memory:").map_err(|e| e.to_string())?;
    store
        .put_profile(&Profile {
            id: "demo".into(),
            name: "Demo profile".into(),
        })
        .map_err(|e| e.to_string())?;
    for (key, value) in [("full_name", "Asha Rao"), ("date_of_birth", "1990-01-01")] {
        store
            .put_data_point(
                "demo",
                &DataPoint {
                    key: key.into(),
                    value: value.into(),
                },
            )
            .map_err(|e| e.to_string())?;
    }
    let vault = store.vault("demo").map_err(|e| e.to_string())?;
    let entry = demo_entry();
    let filled = autofill(&entry, &vault);
    Ok(AutofillResult { entry, filled })
}

/// App entry (also the mobile entry point under Tauri v2).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![greet, core_modules, demo_autofill])
        .run(tauri::generate_context!())
        .expect("error while running ProjectPDFs");
}
