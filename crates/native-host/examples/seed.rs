// Test helper: seed the on-device vault (key + DB + a profile) so the native host
// can serve real data to the extension during integration testing. Writes the key to
// BOTH the OS keystore and the vault.key fallback so `load_key` finds a matching key.
use native_host::data_dir;

fn main() {
    let dir = data_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let key = core_crypto::generate_key();

    // Persist the key the same way the app would (keyring + file fallback).
    if let Ok(entry) = keyring::Entry::new("com.projectpdfs.app", "vault-key") {
        let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
        let _ = entry.set_password(&hex);
    }
    std::fs::write(dir.join("vault.key"), key).unwrap();

    let db = dir.join("vault.db");
    let store = core_store::Store::open(db.to_string_lossy().as_ref(), key).unwrap();
    store
        .put_profile(&core_store::Profile { id: "p1".into(), name: "Asha Rao".into() })
        .unwrap();
    for (k, v) in [("full_name", "Asha Rao"), ("nationality", "Indian"), ("phone", "+91 98765 43210")] {
        store
            .put_data_point("p1", &core_store::DataPoint { key: k.into(), value: v.into() })
            .unwrap();
    }
    println!("seeded vault at {}", db.display());
}
