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

/// Where each Chromium-family browser keeps its own autofill store. Firefox is absent on purpose:
/// it keeps form history in `formhistory.sqlite`, a different schema, and can be added later.
fn browser_autofill_paths() -> Vec<(&'static str, std::path::PathBuf)> {
    let local = match dirs::data_local_dir() {
        Some(d) => d,
        None => return vec![],
    };
    [
        ("Chrome", "Google/Chrome/User Data/Default/Web Data"),
        ("Edge", "Microsoft/Edge/User Data/Default/Web Data"),
        ("Brave", "BraveSoftware/Brave-Browser/User Data/Default/Web Data"),
    ]
    .iter()
    .map(|(name, rel)| (*name, local.join(rel)))
    .filter(|(_, p)| p.exists())
    .collect()
}

/// READ the browser's own autofill history so the user can bring it into their vault.
///
/// This exists because a fresh extension install starts empty even though the browser has been
/// remembering what this person types for years. Browsing history cannot give that back - it holds
/// URLs, not values - and no extension API exposes the autofill store. The native host can read the
/// file, so this does, and ONLY this: it reads, deduplicates, and hands the pairs back.
///
/// It never writes to the vault. Nothing is saved until the user ticks it in the popup, exactly
/// like capture-from-a-page. That is the whole point: this file contains far more than identity -
/// search boxes, one-off codes, details typed on someone else's behalf - and importing it blindly
/// would be the opposite of what this product is for.
///
/// The file stays where it is: it is copied first, because the browser holds a lock while running.
fn read_browser_autofill(limit: usize) -> serde_json::Value {
    use serde_json::json;
    let mut entries: Vec<serde_json::Value> = Vec::new();
    let mut sources: Vec<&str> = Vec::new();

    for (browser, path) in browser_autofill_paths() {
        // Copy first: Chromium keeps an exclusive lock on Web Data while the browser is open, and
        // opening it read-only in place fails with "database is locked".
        let tmp = std::env::temp_dir().join(format!("ppf-autofill-{browser}.db"));
        if std::fs::copy(&path, &tmp).is_err() {
            continue;
        }
        let conn = match rusqlite::Connection::open(&tmp) {
            Ok(c) => c,
            Err(_) => {
                let _ = std::fs::remove_file(&tmp);
                continue;
            }
        };
        // date_last_used orders by "how recently was this actually used", which is a far better
        // signal of what still matters than insertion order.
        let sql = "SELECT name, value, count, date_last_used FROM autofill \
                   ORDER BY date_last_used DESC, count DESC LIMIT ?1";
        if let Ok(mut stmt) = conn.prepare(sql) {
            if let Ok(rows) = stmt.query_map([limit as i64], |r| {
                Ok((
                    r.get::<_, String>(0).unwrap_or_default(),
                    r.get::<_, String>(1).unwrap_or_default(),
                    r.get::<_, i64>(2).unwrap_or(0),
                ))
            }) {
                for row in rows.flatten() {
                    let (name, value, count) = row;
                    if name.trim().is_empty() || value.trim().is_empty() {
                        continue;
                    }
                    entries.push(json!({
                        "name": name, "value": value, "count": count, "browser": browser
                    }));
                }
            }
        }
        drop(conn);
        let _ = std::fs::remove_file(&tmp);
        sources.push(browser);
    }

    json!({ "ok": true, "entries": entries, "browsers": sources })
}

/// Dispatch one request object to a response object (pure given a store).
pub fn dispatch(store: &core_store::Store, req: &serde_json::Value) -> serde_json::Value {
    use serde_json::json;
    match req.get("type").and_then(|t| t.as_str()) {
        Some("ping") => json!({ "ok": true, "pong": true }),
        // Read-only, and it writes nothing: the popup shows every pair for the user to tick.
        Some("readBrowserAutofill") => {
            let limit = req.get("limit").and_then(|l| l.as_u64()).unwrap_or(500) as usize;
            read_browser_autofill(limit.min(5000))
        }
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
        // Vault WITH per-field timestamps — the input the extension needs for last-write-wins sync.
        Some("getVaultMeta") => {
            let pid = req.get("profileId").and_then(|p| p.as_str()).unwrap_or("");
            match store.data_points_meta(pid) {
                Ok(rows) => {
                    let meta: serde_json::Map<String, serde_json::Value> = rows
                        .into_iter()
                        .map(|(k, v, t)| (k, json!({ "value": v, "updated_at": t })))
                        .collect();
                    json!({ "ok": true, "meta": meta })
                }
                Err(e) => json!({ "ok": false, "error": format!("{e:?}") }),
            }
        }
        // Write-through so the extension can act as a thin client over the ONE authoritative desktop
        // vault. An `updatedAt` may be supplied (last-write-wins sync); otherwise it stamps 0.
        Some("upsertData") => {
            let pid = req.get("profileId").and_then(|p| p.as_str()).unwrap_or("");
            let key = req.get("key").and_then(|p| p.as_str()).unwrap_or("");
            let value = req.get("value").and_then(|p| p.as_str()).unwrap_or("");
            let updated_at = req.get("updatedAt").and_then(|p| p.as_i64()).unwrap_or(0);
            if pid.is_empty() || key.is_empty() {
                json!({ "ok": false, "error": "profileId and key are required" })
            } else {
                let dp = core_store::DataPoint { key: key.to_string(), value: value.to_string() };
                match store.put_data_point_at(pid, &dp, updated_at) {
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

/// Max age of the desktop app's unlock sentinel for the shared vault to be served.
pub const SESSION_MAX_AGE_SECS: i64 = 120;

/// Pure freshness test: is the sentinel timestamp present and within `max_age` of `now`?
pub fn is_fresh(ts: Option<i64>, now: i64, max_age: i64) -> bool {
    match ts {
        Some(t) => now >= t && now - t <= max_age,
        None => false,
    }
}

/// Read the desktop app's unlock sentinel and decide whether the vault may be served now.
/// The sentinel is written/kept-fresh by the app ONLY while it is unlocked, so this makes the
/// passphrase gate also protect companion access.
pub fn session_fresh(dir: &Path, now: i64) -> bool {
    let ts = std::fs::read_to_string(dir.join("app-session.flag"))
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok());
    is_fresh(ts, now, SESSION_MAX_AGE_SECS)
}

/// Gate every request that touches the vault on the desktop app being unlocked. `ping` is always
/// allowed (so the extension can detect the bridge and show a helpful "unlock the desktop app"
/// message); everything else requires a fresh session.
pub fn dispatch_gated(store: &core_store::Store, req: &serde_json::Value, unlocked: bool) -> serde_json::Value {
    use serde_json::json;
    let ty = req.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if ty != "ping" && !unlocked {
        return json!({ "ok": false, "locked": true, "error": "the desktop app is locked — unlock it to use the shared vault" });
    }
    dispatch(store, req)
}

#[cfg(test)]
mod dispatch_tests {
    use super::{dispatch, dispatch_gated, is_fresh};
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

    #[test]
    fn is_fresh_bounds() {
        assert!(is_fresh(Some(1000), 1000, 120)); // exactly now
        assert!(is_fresh(Some(1000), 1120, 120)); // at the edge
        assert!(!is_fresh(Some(1000), 1121, 120)); // stale
        assert!(!is_fresh(None, 1000, 120)); // no sentinel → locked
        assert!(!is_fresh(Some(2000), 1000, 120)); // future timestamp → reject
    }

    #[test]
    fn gated_denies_when_locked_allows_when_unlocked() {
        let s = store();
        // ping is always allowed
        assert!(dispatch_gated(&s, &json!({"type":"ping"}), false)["ok"].as_bool().unwrap());
        // vault ops denied while locked
        let denied = dispatch_gated(&s, &json!({"type":"listProfiles"}), false);
        assert_eq!(denied["ok"], false);
        assert_eq!(denied["locked"], true);
        assert_eq!(dispatch_gated(&s, &json!({"type":"createProfile","id":"p1","name":"A"}), false)["ok"], false);
        // allowed while unlocked
        assert!(dispatch_gated(&s, &json!({"type":"createProfile","id":"p1","name":"A"}), true)["ok"].as_bool().unwrap());
        assert!(dispatch_gated(&s, &json!({"type":"listProfiles"}), true)["ok"].as_bool().unwrap());
    }
}
