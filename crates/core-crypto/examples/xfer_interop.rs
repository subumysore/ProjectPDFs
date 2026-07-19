// Interop harness: import a blob the JS extension wrote, and export one for it to read.
// Proves the desktop (core-crypto) and extension (backup.js) share one backup format.
use std::fs;

fn main() {
    let pass = "correct horse";
    // 1) Import the extension-written file (proves extension -> desktop).
    if let Ok(bytes) = fs::read("scratch_a.ppfvault") {
        match core_crypto::import_encrypted(pass, &bytes) {
            Ok(pt) => println!("RUST_IMPORT_OK {}", String::from_utf8_lossy(&pt)),
            Err(e) => println!("RUST_IMPORT_ERR {e}"),
        }
    }
    // 2) Export a file for the extension to read (proves desktop -> extension).
    let inner = br#"{"v":1,"subject":"from-rust","data":{"city":"Bengaluru"}}"#;
    let blob = core_crypto::export_encrypted(pass, inner);
    fs::write("scratch_b.ppfvault", &blob).unwrap();
    println!("RUST_EXPORT_OK {} bytes", blob.len());
}
