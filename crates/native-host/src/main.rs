//! `projectpdfs-host` — the native-messaging companion binary the browser launches.
//! Reads length-prefixed JSON requests on stdin, replies on stdout. Opens the app's
//! on-device vault; if it isn't there yet, every request answers with a clear error.
use std::io::{self, Write};

use native_host::{dispatch, frame, open_store};

fn main() {
    let store = open_store();
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();

    while let Ok(Some(buf)) = frame::read_message(&mut input) {
        let req: serde_json::Value = serde_json::from_slice(&buf).unwrap_or(serde_json::json!({}));
        let resp = match &store {
            Ok(s) => dispatch(s, &req),
            Err(e) => serde_json::json!({
                "ok": false,
                "error": format!("vault unavailable ({e}). Run the ProjectPDFs app once to create it.")
            }),
        };
        let bytes = serde_json::to_vec(&resp).unwrap_or_default();
        if output.write_all(&frame::encode(&bytes)).is_err() || output.flush().is_err() {
            break;
        }
    }
}
