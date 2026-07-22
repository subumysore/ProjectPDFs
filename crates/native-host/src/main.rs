//! `projectpdfs-host` — the native-messaging companion binary the browser launches.
//! Reads length-prefixed JSON requests on stdin, replies on stdout. Opens the app's
//! on-device vault; if it isn't there yet, every request answers with a clear error.
use std::io::{self, Write};

use native_host::{data_dir, dispatch_gated, frame, open_store, session_fresh};
use std::time::{SystemTime, UNIX_EPOCH};

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn main() {
    let store = open_store();
    let dir = data_dir();
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();

    while let Ok(Some(buf)) = frame::read_message(&mut input) {
        let req: serde_json::Value = serde_json::from_slice(&buf).unwrap_or(serde_json::json!({}));
        // Serve the vault only while the desktop app is unlocked (fresh session sentinel).
        let unlocked = session_fresh(&dir, now_secs());
        let resp = match &store {
            Ok(s) => dispatch_gated(s, &req, unlocked),
            Err(e) => serde_json::json!({
                "ok": false,
                "error": format!("vault unavailable ({e}). Run the PolyglotFormFill app once to create it.")
            }),
        };
        let bytes = serde_json::to_vec(&resp).unwrap_or_default();
        if output.write_all(&frame::encode(&bytes)).is_err() || output.flush().is_err() {
            break;
        }
    }
}
