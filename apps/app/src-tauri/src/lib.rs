//! PolyglotFormFill native entry point (Tauri v2). Bridges the React UI to the Rust
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
    /// Whether the user has unlocked the app this session. Data commands refuse until true.
    unlocked: Mutex<bool>,
    /// App-data dir (holds the lock verifier file).
    data_dir: std::path::PathBuf,
}

// ---- App unlock (passphrase gate) ------------------------------------------------
// The app requires a passphrase to open. We store a SALTED, ITERATED verifier (not the
// passphrase, not the vault key) so nobody can open the app UI or read the vault via
// commands without it. At-rest encryption (OS keystore) is unchanged; this adds an
// access gate so "nobody can access without signing in" holds on the desktop too.

#[derive(serde::Serialize, serde::Deserialize)]
struct LockFile {
    salt: String,
    hash: String,
    iters: u32,
}

fn lock_path(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("app-lock.json")
}

fn kdf(salt: &str, passphrase: &str, iters: u32) -> String {
    let mut h = core_crypto::sha256_hex(format!("{salt}\u{0}{passphrase}").as_bytes());
    for _ in 1..iters {
        h = core_crypto::sha256_hex(h.as_bytes());
    }
    h
}

/// Lock status for the UI: whether a passphrase is set, and whether we're unlocked.
#[tauri::command]
fn lock_status(state: State<AppState>) -> serde_json::Value {
    let has = lock_path(&state.data_dir).exists();
    let unlocked = *state.unlocked.lock().unwrap();
    serde_json::json!({ "has_passphrase": has, "unlocked": unlocked })
}

/// First-run: set the app passphrase (creates the verifier) and unlock.
#[tauri::command]
fn set_passphrase(state: State<AppState>, passphrase: String) -> Result<(), String> {
    if passphrase.trim().len() < 6 {
        return Err("Passphrase must be at least 6 characters.".into());
    }
    let path = lock_path(&state.data_dir);
    if path.exists() {
        return Err("A passphrase is already set; use unlock.".into());
    }
    let salt = key_to_hex(&core_crypto::generate_key());
    let iters = 100_000u32;
    let lf = LockFile {
        hash: kdf(&salt, passphrase.trim(), iters),
        salt,
        iters,
    };
    std::fs::write(&path, serde_json::to_vec_pretty(&lf).unwrap()).map_err(|e| e.to_string())?;
    *state.unlocked.lock().unwrap() = true;
    touch_session(&state.data_dir);
    Ok(())
}

/// Unlock the app by verifying the passphrase against the stored verifier.
#[tauri::command]
fn unlock(state: State<AppState>, passphrase: String) -> Result<(), String> {
    let path = lock_path(&state.data_dir);
    let bytes = std::fs::read(&path).map_err(|_| "No passphrase set.".to_string())?;
    let lf: LockFile = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if kdf(&lf.salt, passphrase.trim(), lf.iters) == lf.hash {
        *state.unlocked.lock().unwrap() = true;
        touch_session(&state.data_dir);
        Ok(())
    } else {
        Err("Incorrect passphrase.".into())
    }
}

// --- Unlock session sentinel (shared-vault gate, ADR-0019 follow-up) -------------------
// The native-messaging host serves the shared vault to the extension ONLY while the desktop
// app is unlocked. The app writes a heartbeat sentinel (a unix timestamp) on unlock and keeps
// it fresh; on lock/startup it's cleared. The host requires the sentinel to be recent, so the
// passphrase gate also protects companion access (not just the in-app UI).
fn session_path(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("app-session.flag")
}
fn touch_session(dir: &std::path::Path) {
    let _ = std::fs::write(session_path(dir), now_secs().to_string());
}
fn clear_session(dir: &std::path::Path) {
    let _ = std::fs::remove_file(session_path(dir));
}

/// Re-lock the app (e.g. when stepping away).
#[tauri::command]
fn lock_app(state: State<AppState>) {
    *state.unlocked.lock().unwrap() = false;
    clear_session(&state.data_dir);
}

/// Guard used by every command that exposes user data.
fn require_unlocked(state: &State<AppState>) -> Result<(), String> {
    if *state.unlocked.lock().unwrap() {
        Ok(())
    } else {
        Err("locked — unlock the app first".into())
    }
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
    format!("Hello, {name}! PolyglotFormFill native core is wired and on-device.")
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
    require_unlocked(&state)?;
    state
        .store
        .lock()
        .unwrap()
        .put_profile(&Profile { id, name })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_profiles(state: State<AppState>) -> Result<Vec<Profile>, String> {
    require_unlocked(&state)?;
    state.store.lock().unwrap().list_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
fn list_data_points(state: State<AppState>, profile_id: String) -> Result<Vec<DataPoint>, String> {
    require_unlocked(&state)?;
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
    require_unlocked(&state)?;
    state
        .store
        .lock()
        .unwrap()
        .put_data_point_at(&profile_id, &DataPoint { key, value }, now_secs())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_data_point(state: State<AppState>, profile_id: String, key: String) -> Result<(), String> {
    require_unlocked(&state)?;
    state
        .store
        .lock()
        .unwrap()
        .delete_data_point(&profile_id, &key)
        .map_err(|e| e.to_string())
}

// ---- Encrypted backup / transfer (ADR-0003) --------------------------------------
// Export a profile's vault as a passphrase-encrypted blob. Byte-format matches the
// browser extension (core-crypto: PBKDF2 + AES-256-GCM), so a file exported here
// imports there and vice-versa. No plaintext export.

#[tauri::command]
fn export_vault(state: State<AppState>, profile_id: String, passphrase: String) -> Result<Vec<u8>, String> {
    require_unlocked(&state)?;
    if passphrase.len() < 8 {
        return Err("choose a backup passphrase (8+ characters)".into());
    }
    let data = state.store.lock().unwrap().vault(&profile_id).map_err(|e| e.to_string())?;
    let subject = device_id_for(&state.data_dir);
    let inner = serde_json::json!({ "v": 1, "subject": subject, "data": data });
    let bytes = serde_json::to_vec(&inner).map_err(|e| e.to_string())?;
    Ok(core_crypto::export_encrypted(&passphrase, &bytes))
}

#[tauri::command]
fn import_vault(
    state: State<AppState>,
    profile_id: String,
    passphrase: String,
    bytes: Vec<u8>,
) -> Result<usize, String> {
    require_unlocked(&state)?;
    let plain = core_crypto::import_encrypted(&passphrase, &bytes)
        .map_err(|_| "wrong passphrase or the file was tampered with".to_string())?;
    let v: serde_json::Value = serde_json::from_slice(&plain).map_err(|e| e.to_string())?;
    let data = v.get("data").and_then(|d| d.as_object()).ok_or("no data in backup")?;
    let store = state.store.lock().unwrap();
    let mut n = 0usize;
    for (k, val) in data {
        if let Some(s) = val.as_str() {
            store
                .put_data_point(&profile_id, &DataPoint { key: k.clone(), value: s.to_string() })
                .map_err(|e| e.to_string())?;
            n += 1;
        }
    }
    Ok(n)
}

// ---- Per-device identity + offline license (ADR-0011) ----------------------------
// A random per-install id (NOT hardware fingerprinting — privacy-preserving) used to
// bind offline licenses to this device. Created once and reused.
fn device_id_for(dir: &std::path::Path) -> String {
    let path = dir.join("device.id");
    if let Ok(s) = std::fs::read_to_string(&path) {
        let t = s.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    let bytes = core_crypto::generate_key();
    let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let _ = std::fs::write(&path, &id);
    id
}

#[tauri::command]
fn device_id(state: State<AppState>) -> String {
    device_id_for(&state.data_dir)
}

// Vendor Ed25519 public key. The private half stays with the storefront (vendor-key.json,
// gitignored) and signs each device-bound license via scripts/license/issue.mjs. Regenerate
// with scripts/license/keygen.mjs for production and replace these 32 bytes.
const VENDOR_PUBLIC: [u8; 32] = [
    0x12, 0x26, 0x09, 0x89, 0x03, 0x56, 0xe1, 0x44, 0x0e, 0x4b, 0x10, 0xc7, 0xdc, 0x29, 0xd3, 0xc9,
    0xdf, 0xba, 0xed, 0x88, 0x09, 0x79, 0x48, 0x8f, 0xdb, 0x3c, 0x6c, 0xd0, 0xef, 0x12, 0x8c, 0x37,
];

#[derive(Serialize)]
struct LicenseStatus {
    licensed: bool,
    tier: String,
    subject: String,
    reason: String,
}

fn license_path(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("license.token")
}

fn check_license(dir: &std::path::Path) -> LicenseStatus {
    let token = std::fs::read_to_string(license_path(dir)).unwrap_or_default();
    if token.trim().is_empty() {
        return LicenseStatus { licensed: false, tier: "free".into(), subject: String::new(), reason: "no license installed".into() };
    }
    let dev = device_id_for(dir);
    match core_license::verify_on_device(token.trim(), &VENDOR_PUBLIC, now_secs(), &dev) {
        Ok(lic) => LicenseStatus { licensed: true, tier: lic.tier, subject: lic.subject, reason: String::new() },
        Err(e) => LicenseStatus { licensed: false, tier: "free".into(), subject: String::new(), reason: e.to_string() },
    }
}

#[tauri::command]
fn license_status(state: State<AppState>) -> LicenseStatus {
    check_license(&state.data_dir)
}

#[tauri::command]
fn set_license(state: State<AppState>, token: String) -> Result<LicenseStatus, String> {
    let dev = device_id_for(&state.data_dir);
    // Validate (signature, expiry, and device binding) BEFORE storing.
    core_license::verify_on_device(token.trim(), &VENDOR_PUBLIC, now_secs(), &dev)
        .map_err(|e| e.to_string())?;
    std::fs::write(license_path(&state.data_dir), token.trim()).map_err(|e| e.to_string())?;
    Ok(check_license(&state.data_dir))
}

/// Search the on-device catalog index (name + tags). Query never leaves the device.
#[tauri::command]
fn catalog_search(query: String) -> Vec<CatalogSummary> {
    let catalog = demo_catalog();
    search(&catalog, &query).into_iter().map(|e| e.summary()).collect()
}

/// Get a full catalog entry (incl. the field-map with coordinates) for creating
/// widgets on a flat PDF.
#[tauri::command]
fn catalog_get(entry_id: String) -> Result<CatalogEntry, String> {
    get(&demo_catalog(), &entry_id)
        .cloned()
        .ok_or_else(|| format!("unknown form: {entry_id}"))
}

/// Catalog-first autofill: fill a chosen catalogued form from a Profile's vault.
#[tauri::command]
fn autofill_for(
    state: State<AppState>,
    profile_id: String,
    entry_id: String,
) -> Result<AutofillResult, String> {
    require_unlocked(&state)?;
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
    require_unlocked(&state)?;
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

/// Summary of one saved (filled) form for the "Past forms" tab.
#[derive(Serialize)]
struct SavedFormSummary {
    instance_id: String,
    name: String,
    version_no: i64,
    saves: i64,
    created_at: i64,
    fields_filled: i64,
    fields_total: i64,
    signed: bool,
}

/// Sanitize a form name into a stable id fragment (so re-filling the same form appends
/// a version instead of creating a new instance).
fn slug(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "form".into() } else { s }
}

/// Save a *brought* form (opened from the device, a network location, a URL, or a web
/// search) to the on-device history: append an immutable, encrypted version holding the
/// filled-PDF bytes plus fill metadata, keyed by the form's name so re-fills accumulate
/// versions. Entirely on-device — nothing leaves the machine.
#[tauri::command]
fn save_brought_form(
    state: State<AppState>,
    profile_id: String,
    name: String,
    fields_filled: i64,
    fields_total: i64,
    pdf: Vec<u8>,
) -> Result<SaveInfo, String> {
    require_unlocked(&state)?;
    let store = state.store.lock().unwrap();
    let display = if name.trim().is_empty() { "form".to_string() } else { name.trim().to_string() };
    let instance_id = format!("{profile_id}:brought:{}", slug(&display));
    let at = now_secs();
    store
        .create_instance(
            &FormInstance {
                id: instance_id.clone(),
                profile_id: profile_id.clone(),
                entry_id: display.clone(),
            },
            at,
        )
        .map_err(|e| e.to_string())?;
    let meta: BTreeMap<String, String> = BTreeMap::from([
        ("name".to_string(), display),
        ("fields_filled".to_string(), fields_filled.to_string()),
        ("fields_total".to_string(), fields_total.to_string()),
    ]);
    let version_no = store.add_version(&instance_id, &meta, at).map_err(|e| e.to_string())?;
    store
        .add_version_blob(&instance_id, version_no, &pdf)
        .map_err(|e| e.to_string())?;
    store.record_event(&instance_id, "save", at).map_err(|e| e.to_string())?;
    let saves = store.event_count(&instance_id, "save").map_err(|e| e.to_string())?;
    Ok(SaveInfo { instance_id, version_no, saves })
}

/// List every saved form for a profile (newest first) for the "Past forms" tab.
#[tauri::command]
fn list_saved_forms(state: State<AppState>, profile_id: String) -> Result<Vec<SavedFormSummary>, String> {
    require_unlocked(&state)?;
    let store = state.store.lock().unwrap();
    let mut out = Vec::new();
    for inst in store.list_instances(&profile_id).map_err(|e| e.to_string())? {
        let versions = store.list_versions(&inst.id).map_err(|e| e.to_string())?;
        let Some(latest) = versions.last() else { continue };
        let meta = store.version_values(&inst.id, latest.version_no).map_err(|e| e.to_string())?;
        let saves = store.event_count(&inst.id, "save").map_err(|e| e.to_string())?;
        let signed = !store.list_signatures(&inst.id).map_err(|e| e.to_string())?.is_empty();
        out.push(SavedFormSummary {
            name: meta.get("name").cloned().unwrap_or_else(|| inst.entry_id.clone()),
            fields_filled: meta.get("fields_filled").and_then(|s| s.parse().ok()).unwrap_or(0),
            fields_total: meta.get("fields_total").and_then(|s| s.parse().ok()).unwrap_or(0),
            instance_id: inst.id,
            version_no: latest.version_no,
            saves,
            created_at: latest.created_at,
            signed,
        });
    }
    Ok(out)
}

/// Return the filled-PDF bytes of a saved form version so the UI can re-download it.
#[tauri::command]
fn saved_form_pdf(
    state: State<AppState>,
    instance_id: String,
    version_no: i64,
) -> Result<tauri::ipc::Response, String> {
    require_unlocked(&state)?;
    let store = state.store.lock().unwrap();
    let bytes = store.version_blob(&instance_id, version_no).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Sign the latest saved version of a brought form on-device (device Ed25519 key),
/// binding a provenance manifest over the version's metadata. Keyed by instance id.
#[tauri::command]
fn sign_saved_form(state: State<AppState>, instance_id: String) -> Result<SignInfo, String> {
    require_unlocked(&state)?;
    let store = state.store.lock().unwrap();
    let versions = store.list_versions(&instance_id).map_err(|e| e.to_string())?;
    let latest = versions.last().ok_or("no saved version to sign")?;
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
    Ok(SignInfo { version_no: latest.version_no, signer_public, doc_hash })
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
    require_unlocked(&state)?;
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
    require_unlocked(&state)?;
    let store = state.store.lock().unwrap();
    store
        .list_signatures(&format!("{profile_id}:{entry_id}"))
        .map_err(|e| e.to_string())
}

/// Open the vendor's submission page in the default browser so the user submits
/// there directly (device -> vendor; we never proxy). Warns on insecure HTTP.
#[tauri::command]
fn open_submit_url(url: String) -> Result<String, String> {
    let lower = url.trim().to_lowercase();
    if lower.starts_with("https://") {
        open::that(url.trim()).map_err(|e| e.to_string())?;
        Ok("Opened the submission page (secure https). Submit there — your data goes device → vendor directly.".into())
    } else if lower.starts_with("http://") {
        open::that(url.trim()).map_err(|e| e.to_string())?;
        Ok("WARNING: this page uses insecure HTTP — data would cross the network in cleartext. Opened at your request.".into())
    } else {
        Err("Enter an http(s) URL.".into())
    }
}

/// Save a filled/signed PDF straight to the user's Desktop (on-device), with a safe, unique
/// filename. Returns the full path so the UI can tell the user exactly where it landed.
#[tauri::command]
fn save_to_desktop(app: tauri::AppHandle, bytes: Vec<u8>, filename: String) -> Result<String, String> {
    // Prefer the real Desktop; fall back to Documents, then home, then app-data.
    let dir = app
        .path()
        .desktop_dir()
        .or_else(|_| app.path().document_dir())
        .or_else(|_| app.path().home_dir())
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Sanitize the base name and force a .pdf extension.
    let raw = filename.trim();
    let stem: String = std::path::Path::new(raw)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("filled")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' })
        .collect();
    let stem = stem.trim().trim_matches('-');
    let stem = if stem.is_empty() { "filled" } else { stem };

    // Avoid clobbering an existing file: name, name (1), name (2), …
    let mut path = dir.join(format!("{stem}.pdf"));
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).pdf"));
        n += 1;
    }
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Download a web-hosted form on-device (SSRF-guarded, size-capped) and return its
/// raw bytes to the UI, which runs the same auto-fill pipeline. Inbound only — the
/// user directs the download; no user content goes up.
#[tauri::command]
async fn download_form(url: String) -> Result<tauri::ipc::Response, String> {
    let bytes = core_fetch::fetch_form(url.trim())
        .await
        .map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---- App-only hosted guide video (ADR-0019) --------------------------------------
// The guide video is NOT bundled; it's served DOWNWARD by our asset host and fetched on
// demand, verified against a pinned hash, and cached on-device for offline playback. The
// request carries an APP-LEVEL capability (same for every install of a release) so the edge
// can serve it only to genuine app builds — it identifies an app, never a user (no tracking).
const GUIDE_URL: &str = "https://polyglotformfill.mooo.com/app-assets/guide.mp4";
const GUIDE_SHA256: &str = "98fe5e0370b9c333aee659855141ca28b167c8cde4f9e5afc592e612fc65ead7";
/// Per-release app capability. Rotated each release; NOT a user/device identifier.
const APP_ASSET_TOKEN: &str = "ppf-app-2026-07-beta";

/// Return the guide video bytes: from the on-device cache if present & intact, else fetched
/// downward from the asset host (app-gated), integrity-verified, and cached. Inbound only.
#[tauri::command]
async fn guide_video(state: State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
    let cache = state.data_dir.join("guide.mp4");
    if let Ok(b) = std::fs::read(&cache) {
        if core_crypto::sha256_hex(&b) == GUIDE_SHA256 {
            return Ok(tauri::ipc::Response::new(b));
        }
    }
    let bytes = core_fetch::fetch_app_asset(GUIDE_URL, APP_ASSET_TOKEN)
        .await
        .map_err(|e| e.to_string())?;
    if core_crypto::sha256_hex(&bytes) != GUIDE_SHA256 {
        return Err("guide video failed its integrity check (pinned hash mismatch)".into());
    }
    let _ = std::fs::write(&cache, &bytes);
    Ok(tauri::ipc::Response::new(bytes))
}

// ---- Script fonts, fetched on demand (same pattern as the OCR packs, ADR-0019) ----------
// Writing a value in Tamil, Japanese, Arabic … into a PDF needs that script's font EMBEDDED in
// the file. Bundling them all would add tens of MB to the installer and would mean a new release
// for every script we add, so — exactly like the Tesseract language packs — a font is fetched
// from our asset host the first time a script is met and then kept in app-data. Flow is DOWNWARD
// only: a public font file comes onto the device. The form, its values, and any identifier never
// leave. The name is validated against a strict pattern, so this cannot be pointed anywhere else.
const FONT_BASE: &str = "https://objectstorage.us-ashburn-1.oraclecloud.com/p/MeK_72_tOM4xQH7J-bSokMlJ14erObpr5QYjeVFi-Oh7PsQt-jtjyzA4YGyJRSyP/n/idlqdkwlstnb/b/polyglotformfill-dl/o/fonts/";

/// Is this a plain `NotoSans…-Regular.ttf|otf` file name? No path separators, no traversal,
/// no query — the name is concatenated onto our own asset base, so it must not be able to
/// steer the request. Deliberately strict: an unknown-but-safe name simply 404s at the host.
fn is_font_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.starts_with("NotoSans")
        && (name.ends_with(".ttf") || name.ends_with(".otf"))
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.contains("..")
}

/// Return a script font's bytes: from the on-device cache when present, else fetched downward
/// from the asset host once and cached. The UI (fill/fonts.ts) embeds it into the PDF.
#[tauri::command]
async fn script_font(name: String, state: State<'_, AppState>) -> Result<tauri::ipc::Response, String> {
    if !is_font_name(&name) {
        return Err("not a valid font name".into());
    }
    let dir = state.data_dir.join("fonts");
    let cache = dir.join(&name);
    if let Ok(b) = std::fs::read(&cache) {
        if !b.is_empty() {
            return Ok(tauri::ipc::Response::new(b));
        }
    }
    let bytes = core_fetch::fetch_app_asset(&format!("{FONT_BASE}{name}"), APP_ASSET_TOKEN)
        .await
        .map_err(|e| e.to_string())?;
    // A font file begins with one of a few known signatures. Refuse anything else rather than
    // caching an error page that would then fail to embed on every future fill.
    let sig = bytes.get(0..4).unwrap_or(&[]);
    let known = matches!(sig, [0x00, 0x01, 0x00, 0x00] | b"OTTO" | b"true" | b"ttcf" | b"wOFF");
    if !known {
        return Err("the downloaded font file is not a font".into());
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&cache, &bytes);
    Ok(tauri::ipc::Response::new(bytes))
}

/// A web-search hit (title + URL) returned to the UI.
#[derive(serde::Serialize)]
struct SearchHit {
    title: String,
    url: String,
}

/// Search the web for a form (DuckDuckGo). **User-directed egress exception:** the
/// query leaves the device (device → DuckDuckGo directly, never via our servers).
/// The chosen result URL is then downloaded + filled on-device.
#[tauri::command]
async fn web_search(query: String) -> Result<Vec<SearchHit>, String> {
    let hits = core_fetch::web_search(query.trim())
        .await
        .map_err(|e| e.to_string())?;
    Ok(hits
        .into_iter()
        .map(|(title, url)| SearchHit { title, url })
        .collect())
}

// --- Browser companion: register the native-messaging host for the extension ---

fn resolve_host_exe(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let name = if cfg!(windows) { "projectpdfs-host.exe" } else { "projectpdfs-host" };
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(name));
        }
    }
    if let Ok(rd) = app.path().resource_dir() {
        candidates.push(rd.join(name));
        candidates.push(rd.join("target").join("release").join(name));
    }
    candidates.push(std::path::PathBuf::from("target").join("release").join(name));
    candidates.into_iter().find(|p| p.exists())
}

#[cfg(windows)]
fn write_host_registry(browser_root: &str, manifest_path: &str) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = format!("{browser_root}\\NativeMessagingHosts\\com.projectpdfs.host");
    let (key, _) = hkcu.create_subkey(path).map_err(|e| e.to_string())?;
    key.set_value("", &manifest_path.to_string()).map_err(|e| e.to_string())
}

/// Write the native-messaging manifest + Chrome/Edge registry entry for `ext`.
fn do_register_companion(app: &tauri::AppHandle, ext: &str) -> Result<String, String> {
    let ext = ext.trim();
    if ext.is_empty() {
        return Err("Enter your extension id (from chrome://extensions).".into());
    }
    let host = resolve_host_exe(app)
        .ok_or("Companion host binary not found. Build it: cargo build -p native-host --release")?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let manifest = serde_json::json!({
        "name": "com.projectpdfs.host",
        "description": "PolyglotFormFill native messaging host (companion trust anchor)",
        "path": host.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [format!("chrome-extension://{ext}/")]
    });
    let manifest_path = dir.join("com.projectpdfs.host.json");
    std::fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest).unwrap())
        .map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        let mp = manifest_path.to_string_lossy().to_string();
        write_host_registry("Software\\Google\\Chrome", &mp)?;
        let _ = write_host_registry("Software\\Microsoft\\Edge", &mp);
    }
    Ok(format!("Companion registered. Host: {}", host.to_string_lossy()))
}

/// Register the native-messaging host so the browser extension can reach this app.
/// User-initiated (they supply their extension id).
#[tauri::command]
fn register_companion(app: tauri::AppHandle, extension_id: String) -> Result<String, String> {
    do_register_companion(&app, &extension_id)
}

/// The published extension id to auto-register on first run. Empty until the
/// extension ships to a store; set it (or drop the id in `companion-extension-id.txt`
/// under the app-data dir) to have the installer/app register the companion for you.
const COMPANION_EXTENSION_ID: &str = "ikocicibacolgmamehagnpcgfabcamfk";

/// Auto-register the companion on startup (idempotent). Uses the compiled id, else an
/// `companion-extension-id.txt` file in the app-data dir. Best-effort, never fatal.
fn auto_register_companion(app: &tauri::AppHandle) {
    let mut ext = COMPANION_EXTENSION_ID.trim().to_string();
    if ext.is_empty() {
        if let Ok(dir) = app.path().app_data_dir() {
            if let Ok(s) = std::fs::read_to_string(dir.join("companion-extension-id.txt")) {
                ext = s.trim().to_string();
            }
        }
    }
    if ext.is_empty() {
        return; // nothing configured yet — skip silently
    }
    match do_register_companion(app, &ext) {
        Ok(msg) => eprintln!("[companion] {msg}"),
        Err(e) => eprintln!("[companion] auto-register skipped: {e}"),
    }
}

/// App entry (also the mobile entry point under Tauri v2).
/// Minimal percent-decode for the model file path (ASCII paths; `%XX` → byte).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Serve the on-device translation models to the WebView from the app-data `models/` dir
        // (NOT embedded in the binary — that bloated the build). transformers.js is pointed at
        // `ppfmodel://…` (see translate.ts); this reads the requested file and returns it. On
        // Windows the WebView addresses it as `http://ppfmodel.localhost/<path>`.
        .register_uri_scheme_protocol("ppfmodel", |ctx, request| {
            let rel = percent_decode(request.uri().path().trim_start_matches('/'));
            let base = ctx
                .app_handle()
                .path()
                .app_data_dir()
                .map(|d| d.join("models"))
                .unwrap_or_default();
            let path = base.join(&rel);
            // Stay inside the models dir (no path traversal).
            let safe = path.starts_with(&base);
            match if safe { std::fs::read(&path) } else { Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)) } {
                Ok(bytes) => {
                    let ct = if rel.ends_with(".json") { "application/json" } else { "application/octet-stream" };
                    tauri::http::Response::builder()
                        .status(200)
                        .header("Content-Type", ct)
                        .header("Access-Control-Allow-Origin", "*")
                        .body(bytes)
                        .unwrap()
                }
                Err(_) => tauri::http::Response::builder().status(404).body(Vec::new()).unwrap(),
            }
        })
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
                unlocked: Mutex::new(false), // locked until the user enters their passphrase
                data_dir: dir.clone(),
            });
            // Start locked: clear any stale unlock sentinel (e.g. left by a prior crash) so the
            // shared vault is gated until the user actually unlocks this session.
            clear_session(&dir);
            // Heartbeat: while unlocked (sentinel present), keep it fresh so the host keeps serving;
            // once locked/quit it goes stale within SESSION_MAX_AGE_SECS and the host denies access.
            let hb_dir = dir.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                if session_path(&hb_dir).exists() {
                    touch_session(&hb_dir);
                }
            });
            // Auto-register the browser companion on first run (idempotent, best-effort).
            auto_register_companion(&app.handle().clone());
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
            catalog_get,
            autofill_for,
            save_filled_form,
            sign_form,
            save_brought_form,
            list_saved_forms,
            saved_form_pdf,
            sign_saved_form,
            form_signatures,
            open_submit_url,
            download_form,
            save_to_desktop,
            guide_video,
            script_font,
            web_search,
            register_companion,
            lock_status,
            set_passphrase,
            unlock,
            lock_app,
            export_vault,
            import_vault,
            device_id,
            license_status,
            set_license
        ])
        .run(tauri::generate_context!())
        .expect("error while running PolyglotFormFill");
}
