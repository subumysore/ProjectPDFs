//! ProjectPDFs native entry point (Tauri v2). Bridges the React UI to the Rust
//! core crates. Real commands (catalog match, fill, sign, export) land per spec.

use core_catalog::{autofill, demo_catalog, demo_entry, get, search, CatalogEntry, CatalogSummary, FilledField};
use core_store::{DataPoint, FormInstance, Profile, Store};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Result of saving a filled form.
#[derive(Serialize)]
struct SaveInfo {
    instance_id: String,
    version_no: i64,
    saves: i64,
}

/// Managed app state: the on-device store + the device signing key (from the OS keystore).
struct AppState {
    store: Mutex<Store>,
    sign_secret: [u8; 32],
}

/// Result of signing a form version.
#[derive(Serialize)]
struct SignInfo {
    version_no: i64,
    signer_public: String,
    doc_hash: String,
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

/// Search the on-device catalog index (name + tags). Query never leaves the device.
#[tauri::command]
fn catalog_search(query: String) -> Vec<CatalogSummary> {
    let catalog = demo_catalog();
    search(&catalog, &query).into_iter().map(|e| e.summary()).collect()
}

/// Catalog-first autofill: fill a chosen catalogued form from a Profile's vault.
#[tauri::command]
fn autofill_for(
    state: State<AppState>,
    profile_id: String,
    entry_id: String,
) -> Result<AutofillResult, String> {
    let store = state.store.lock().unwrap();
    let vault = store.vault(&profile_id).map_err(|e| e.to_string())?;
    let catalog = demo_catalog();
    let entry = get(&catalog, &entry_id)
        .cloned()
        .ok_or_else(|| format!("unknown form: {entry_id}"))?;
    let filled = autofill(&entry, &vault);
    Ok(AutofillResult { entry, filled })
}

const KEYRING_SERVICE: &str = "com.projectpdfs.app";
const KEYRING_USER: &str = "vault-key";

fn key_to_hex(k: &[u8; 32]) -> String {
    let mut s = String::with_capacity(64);
    for b in k {
        s.push_str(&format!("{b:02x}"));
    }
    s
}
fn hex_to_key(s: &str) -> Option<[u8; 32]> {
    if s.len() != 64 {
        return None;
    }
    let mut k = [0u8; 32];
    for i in 0..32 {
        k[i] = u8::from_str_radix(s.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(k)
}

/// The vault sealing key, from a file next to the DB (fallback when the OS keystore
/// is unavailable).
fn file_key(dir: &std::path::Path) -> core_crypto::SealKey {
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

/// Load the vault's sealing key from the **OS secure keystore** (Windows Credential
/// Manager / Keychain / secret-service), creating one on first run. Falls back to a
/// file next to the DB if the keystore is unavailable.
fn load_or_create_key(dir: &std::path::Path) -> core_crypto::SealKey {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        match entry.get_password() {
            Ok(hex) => {
                if let Some(k) = hex_to_key(&hex) {
                    return k;
                }
            }
            Err(keyring::Error::NoEntry) => {
                let k = core_crypto::generate_key();
                if entry.set_password(&key_to_hex(&k)).is_ok() {
                    return k;
                }
            }
            Err(_) => {}
        }
    }
    file_key(dir)
}

/// Save a filled form: autofill from the vault, append an immutable encrypted
/// version to the form instance, and record a "save" history event.
#[tauri::command]
fn save_filled_form(
    state: State<AppState>,
    profile_id: String,
    entry_id: String,
) -> Result<SaveInfo, String> {
    let store = state.store.lock().unwrap();
    let vault = store.vault(&profile_id).map_err(|e| e.to_string())?;
    let catalog = demo_catalog();
    let entry = get(&catalog, &entry_id)
        .cloned()
        .ok_or_else(|| format!("unknown form: {entry_id}"))?;
    // Only the fields we actually have values for.
    let values: BTreeMap<String, String> = autofill(&entry, &vault)
        .into_iter()
        .filter_map(|f| f.value.map(|v| (f.ontology_key, v)))
        .collect();

    let instance_id = format!("{profile_id}:{entry_id}");
    let at = now_secs();
    store
        .create_instance(
            &FormInstance {
                id: instance_id.clone(),
                profile_id: profile_id.clone(),
                entry_id: entry_id.clone(),
            },
            at,
        )
        .map_err(|e| e.to_string())?;
    let version_no = store.add_version(&instance_id, &values, at).map_err(|e| e.to_string())?;
    store.record_event(&instance_id, "save", at).map_err(|e| e.to_string())?;
    let saves = store.event_count(&instance_id, "save").map_err(|e| e.to_string())?;
    Ok(SaveInfo {
        instance_id,
        version_no,
        saves,
    })
}

/// Load the device Ed25519 signing secret from the OS keystore (file fallback).
/// This key is non-delegable: only this device+profile can produce its signatures.
fn load_or_create_sign_key(dir: &std::path::Path) -> [u8; 32] {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "sign-key") {
        match entry.get_password() {
            Ok(hex) => {
                if let Some(k) = hex_to_key(&hex) {
                    return k;
                }
            }
            Err(keyring::Error::NoEntry) => {
                let k = core_crypto::SignKeypair::generate().secret_bytes();
                if entry.set_password(&key_to_hex(&k)).is_ok() {
                    return k;
                }
            }
            Err(_) => {}
        }
    }
    let p = dir.join("sign.key");
    if let Ok(b) = std::fs::read(&p) {
        if b.len() == 32 {
            let mut k = [0u8; 32];
            k.copy_from_slice(&b);
            return k;
        }
    }
    let k = core_crypto::SignKeypair::generate().secret_bytes();
    let _ = std::fs::write(&p, k);
    k
}

/// Sign the latest saved version of a form on-device (device Ed25519 key), binding
/// a provenance manifest (doc hash + signer identity), and store the signature.
#[tauri::command]
fn sign_form(state: State<AppState>, profile_id: String, entry_id: String) -> Result<SignInfo, String> {
    let store = state.store.lock().unwrap();
    let instance_id = format!("{profile_id}:{entry_id}");
    let versions = store.list_versions(&instance_id).map_err(|e| e.to_string())?;
    let latest = versions.last().ok_or("no saved version to sign — save the form first")?;
    let values = store
        .version_values(&instance_id, latest.version_no)
        .map_err(|e| e.to_string())?;
    let canonical = serde_json::to_vec(&values).map_err(|e| e.to_string())?;
    let doc_hash = core_crypto::sha256_hex(&canonical);

    let kp = core_crypto::SignKeypair::from_secret(&state.sign_secret);
    let manifest = core_crypto::ProvenanceManifest {
        doc_hash: doc_hash.clone(),
        signer_public: kp.public_bytes(),
        created_at: now_secs() as u64,
        roles: vec!["Individual".to_string()],
    };
    let sig = manifest.sign(&kp);
    let signer_public = key_to_hex(&kp.public_bytes());
    let signature = sig.iter().map(|b| format!("{b:02x}")).collect::<String>();

    store
        .add_signature(
            &instance_id,
            &core_store::SignatureRecord {
                version_no: latest.version_no,
                signer_public: signer_public.clone(),
                signature,
                alg: "ed25519".into(),
                created_at: now_secs(),
            },
        )
        .map_err(|e| e.to_string())?;
    Ok(SignInfo {
        version_no: latest.version_no,
        signer_public,
        doc_hash,
    })
}

/// List signatures on a form.
#[tauri::command]
fn form_signatures(
    state: State<AppState>,
    profile_id: String,
    entry_id: String,
) -> Result<Vec<core_store::SignatureRecord>, String> {
    let store = state.store.lock().unwrap();
    store
        .list_signatures(&format!("{profile_id}:{entry_id}"))
        .map_err(|e| e.to_string())
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
            let sign_secret = load_or_create_sign_key(&dir);
            let db_path = dir.join("vault.db");
            let store =
                Store::open(db_path.to_string_lossy().as_ref(), key).expect("open vault store");
            app.manage(AppState {
                store: Mutex::new(store),
                sign_secret,
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
            catalog_search,
            autofill_for,
            save_filled_form,
            sign_form,
            form_signatures
        ])
        .run(tauri::generate_context!())
        .expect("error while running ProjectPDFs");
}
