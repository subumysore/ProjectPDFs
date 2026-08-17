//! `projectpdfs-host` — the native-messaging companion binary the browser launches.
//! Reads length-prefixed JSON requests on stdin, replies on stdout. Opens the app's
//! on-device vault; if it isn't there yet, every request answers with a clear error.
use std::io::{self, Write};

use native_host::{data_dir, dispatch_gated, frame, may_serve, open_store};
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
        // Serve the vault when the desktop app is unlocked OR when the user has allowed app-free
        // bridging and Windows Hello confirms them (see may_serve). Browser-only use no longer needs
        // the desktop app open.
        let unlocked = may_serve(&dir, now_secs());
        let resp = match &store {
            Ok(s) => dispatch_gated(s, &req, unlocked),
            Err(e) => serde_json::json!({
                "ok": false,
                "error": format!("vault unavailable ({e}). Run the PolyglotFormFill app once to create it.")
            }),
        };
        // Record real extension usage (a served, non-ping request) so the desktop app does NOT
        // idle-lock the shared vault while the user is actively working in the browser extension.
        let ty = req.get("type").and_then(|t| t.as_str()).unwrap_or("");
        if unlocked && ty != "ping" {
            let _ = std::fs::write(dir.join("bridge-activity.flag"), now_secs().to_string());
        }
        let bytes = serde_json::to_vec(&resp).unwrap_or_default();
        if output.write_all(&frame::encode(&bytes)).is_err() || output.flush().is_err() {
            break;
        }
    }
}
