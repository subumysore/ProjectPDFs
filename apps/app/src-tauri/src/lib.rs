//! ProjectPDFs native entry point (Tauri v2). Bridges the React UI to the Rust
//! core crates. Real commands (catalog match, fill, sign, export) land per spec.

use core_catalog::{autofill, demo_entry, CatalogEntry, FilledField};
use core_store::{DataPoint, Profile, Store};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Manager, State};

/// Managed app state: the on-device store, guarded for cross-thread command access.
struct AppState {
    store: Mutex<Store>,
}

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
    let store = Store::open(":memory:", core_crypto::generate_key()).map_err(|e| e.to_string())?;
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

// --- Persistent vault: real Profiles + DataPoints (all on-device) ---

#[tauri::command]
fn create_profile(state: State<AppState>, id: String, name: String) -> Result<(), String> {
    state
        .store
        .lock()
        .unwrap()
        .put_profile(&Profile { id, name })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_profiles(state: State<AppState>) -> Result<Vec<Profile>, String> {
    state.store.lock().unwrap().list_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
fn list_data_points(state: State<AppState>, profile_id: String) -> Result<Vec<DataPoint>, String> {
    state
        .store
        .lock()
        .unwrap()
        .data_points(&profile_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn upsert_data_point(
    state: State<AppState>,
    profile_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    state
        .store
        .lock()
        .unwrap()
        .put_data_point(&profile_id, &DataPoint { key, value })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_data_point(state: State<AppState>, profile_id: String, key: String) -> Result<(), String> {
    state
        .store
        .lock()
        .unwrap()
        .delete_data_point(&profile_id, &key)
        .map_err(|e| e.to_string())
}

/// Catalog-first autofill for a real Profile's vault against the sample form.
#[tauri::command]
fn autofill_for(state: State<AppState>, profile_id: String) -> Result<AutofillResult, String> {
    let store = state.store.lock().unwrap();
    let vault = store.vault(&profile_id).map_err(|e| e.to_string())?;
    let entry = demo_entry();
    let filled = autofill(&entry, &vault);
    Ok(AutofillResult { entry, filled })
}

/// Load the vault's sealing key from the app-data dir, or create one on first run.
///
/// PLACEHOLDER: the key file lives next to the DB for now. Production moves this to
/// the **OS secure keystore** (Keychain / Keystore / DPAPI) — see ADR-0002.
fn load_or_create_key(dir: &std::path::Path) -> core_crypto::SealKey {
    let key_path = dir.join("vault.key");
    if let Ok(bytes) = std::fs::read(&key_path) {
        if bytes.len() == 32 {
            let mut k = [0u8; 32];
            k.copy_from_slice(&bytes);
            return k;
        }
    }
    let k = core_crypto::generate_key();
    let _ = std::fs::write(&key_path, k);
    k
}

/// App entry (also the mobile entry point under Tauri v2).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Open the on-device vault under the OS app-data dir. Values are AES-256-GCM
            // sealed at rest with a per-install key (OS keystore in production).
            let dir = app.path().app_data_dir().expect("app data dir");
            std::fs::create_dir_all(&dir).expect("create data dir");
            let key = load_or_create_key(&dir);
            let db_path = dir.join("vault.db");
            let store =
                Store::open(db_path.to_string_lossy().as_ref(), key).expect("open vault store");
            app.manage(AppState {
                store: Mutex::new(store),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            core_modules,
            demo_autofill,
            create_profile,
            list_profiles,
            list_data_points,
            upsert_data_point,
            delete_data_point,
            autofill_for
        ])
        .run(tauri::generate_context!())
        .expect("error while running ProjectPDFs");
}
