//! Native-messaging **companion host** for the browser extension.
//!
//! The extension talks to this local binary over the browser native-messaging
//! protocol (4-byte little-endian length prefix + JSON, over stdio). The host opens
//! the SAME on-device encrypted vault the native app uses (OS-keystore key + SQLite),
//! so the sensitive material (vault, keys) stays in the trusted native binary and
//! never lives in store-served extension code. Nothing leaves the device.
#![forbid(unsafe_code)]

use std::path::{Path, PathBuf};

/// Native-messaging stdio framing: `u32` little-endian length prefix + payload.
pub mod frame {
    use std::io::{self, Read};

    /// Frame a payload with its little-endian length prefix.
    pub fn encode(payload: &[u8]) -> Vec<u8> {
        let len = payload.len() as u32;
        let mut out = Vec::with_capacity(4 + payload.len());
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(payload);
        out
    }

    /// Read one length-prefixed message; `Ok(None)` at clean end of stream.
    pub fn read_message<R: Read>(r: &mut R) -> io::Result<Option<Vec<u8>>> {
        let mut lenb = [0u8; 4];
        match r.read_exact(&mut lenb) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e),
        }
        let len = u32::from_le_bytes(lenb) as usize;
        // Browsers cap host→extension at 64 MB; refuse anything larger.
        if len > 64 * 1024 * 1024 {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "message too large"));
        }
        let mut buf = vec![0u8; len];
        r.read_exact(&mut buf)?;
        Ok(Some(buf))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn encode_prefixes_little_endian_length() {
            assert_eq!(&encode(b"ab")[..4], &[2, 0, 0, 0]);
        }

        #[test]
        fn roundtrip_then_eof() {
            let enc = encode(br#"{"type":"ping"}"#);
            let mut cur = std::io::Cursor::new(enc);
            let got = read_message(&mut cur).unwrap().unwrap();
            assert_eq!(got, br#"{"type":"ping"}"#);
            assert!(read_message(&mut cur).unwrap().is_none()); // clean EOF
        }
    }
}

// --- vault key + store (mirrors apps/app/src-tauri so it reads the same vault) ---

const KEYRING_SERVICE: &str = "com.projectpdfs.app";
const KEYRING_USER: &str = "vault-key";

/// The app-data dir used by the native app (Tauri identifier `com.projectpdfs.app`).
pub fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.projectpdfs.app")
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

fn file_key(dir: &Path) -> core_crypto::SealKey {
    let key_path = dir.join("vault.key");
    if let Ok(bytes) = std::fs::read(&key_path) {
        if bytes.len() == 32 {
            let mut k = [0u8; 32];
            k.copy_from_slice(&bytes);
            return k;
        }
    }
    // Do not create a new key here — a missing key means the app hasn't run yet.
    core_crypto::generate_key()
}

/// Load the vault key from the OS keystore (same entry the app writes), else file.
pub fn load_key(dir: &Path) -> core_crypto::SealKey {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        if let Ok(hex) = entry.get_password() {
            if let Some(k) = hex_to_key(&hex) {
                return k;
            }
        }
    }
    file_key(dir)
}

/// Open the on-device vault store (read the app's encrypted SQLite vault).
pub fn open_store() -> Result<core_store::Store, String> {
    let dir = data_dir();
    let key = load_key(&dir);
    let db = dir.join("vault.db");
    core_store::Store::open(db.to_string_lossy().as_ref(), key).map_err(|e| format!("{e:?}"))
}

/// Dispatch one request object to a response object (pure given a store).
pub fn dispatch(store: &core_store::Store, req: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    match req.get("type").and_then(|t| t.as_str()) {
        Some("ping") => json!({ "ok": true, "pong": true }),
        Some("listProfiles") => match store.list_profiles() {
            Ok(ps) => json!({
                "ok": true,
                "profiles": ps.iter().map(|p| json!({ "id": p.id, "name": p.name })).collect::<Vec<_>>()
            }),
            Err(e) => json!({ "ok": false, "error": format!("{e:?}") }),
        },
        Some("getVault") => {
            let pid = req.get("profileId").and_then(|p| p.as_str()).unwrap_or("");
            match store.vault(pid) {
                Ok(v) => json!({ "ok": true, "vault": v }),
                Err(e) => json!({ "ok": false, "error": format!("{e:?}") }),
            }
        }
        // Write-through so the extension can act as a thin client over the ONE
        // authoritative desktop vault (single source of truth).
        Some("upsertData") => {
            let pid = req.get("profileId").and_then(|p| p.as_str()).unwrap_or("");
            let key = req.get("key").and_then(|p| p.as_str()).unwrap_or("");
            let value = req.get("value").and_then(|p| p.as_str()).unwrap_or("");
            if pid.is_empty() || key.is_empty() {
                json!({ "ok": false, "error": "profileId and key are required" })
            } else {
                let dp = core_store::DataPoint { key: key.to_string(), value: value.to_string() };
                match store.put_data_point(pid, &dp) {
                    Ok(()) => json!({ "ok": true }),
                    Err(e) => json!({ "ok": false, "error": format!("{e:?}") }),
                }
            }
        }
        Some("deleteData") => {
            let pid = req.get("profileId").and_then(|p| p.as_str()).unwrap_or("");
            let key = req.get("key").and_then(|p| p.as_str()).unwrap_or("");
            if pid.is_empty() || key.is_empty() {
                json!({ "ok": false, "error": "profileId and key are required" })
            } else {
                match store.delete_data_point(pid, key) {
                    Ok(()) => json!({ "ok": true }),
                    Err(e) => json!({ "ok": false, "error": format!("{e:?}") }),
                }
            }
        }
        Some("createProfile") => {
            let id = req.get("id").and_then(|p| p.as_str()).unwrap_or("");
            let name = req.get("name").and_then(|p| p.as_str()).unwrap_or("");
            if id.is_empty() {
                json!({ "ok": false, "error": "id is required" })
            } else {
                let p = core_store::Profile { id: id.to_string(), name: name.to_string() };
                match store.put_profile(&p) {
                    Ok(()) => json!({ "ok": true }),
                    Err(e) => json!({ "ok": false, "error": format!("{e:?}") }),
                }
            }
        }
        _ => json!({ "ok": false, "error": "unknown message" }),
    }
}

#[cfg(test)]
mod dispatch_tests {
    use super::dispatch;
    use serde_json::json;

    fn store() -> core_store::Store {
        core_store::Store::open(":memory:", core_crypto::generate_key()).unwrap()
    }

    #[test]
    fn write_through_roundtrip() {
        let s = store();
        // create a profile, upsert a value, read it back via getVault
        assert!(dispatch(&s, &json!({"type":"createProfile","id":"p1","name":"Asha"}))["ok"].as_bool().unwrap());
        assert!(dispatch(&s, &json!({"type":"upsertData","profileId":"p1","key":"first_name","value":"Asha"}))["ok"].as_bool().unwrap());
        let v = dispatch(&s, &json!({"type":"getVault","profileId":"p1"}));
        assert_eq!(v["vault"]["first_name"], "Asha");
        // update, then delete
        assert!(dispatch(&s, &json!({"type":"upsertData","profileId":"p1","key":"first_name","value":"Meera"}))["ok"].as_bool().unwrap());
        assert_eq!(dispatch(&s, &json!({"type":"getVault","profileId":"p1"}))["vault"]["first_name"], "Meera");
        assert!(dispatch(&s, &json!({"type":"deleteData","profileId":"p1","key":"first_name"}))["ok"].as_bool().unwrap());
        assert!(dispatch(&s, &json!({"type":"getVault","profileId":"p1"}))["vault"].get("first_name").is_none());
    }

    #[test]
    fn missing_args_error() {
        let s = store();
        assert_eq!(dispatch(&s, &json!({"type":"upsertData","key":"k","value":"v"}))["ok"], false);
        assert_eq!(dispatch(&s, &json!({"type":"deleteData","profileId":"p1"}))["ok"], false);
    }
}
