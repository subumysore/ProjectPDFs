// Verify a license token against a vendor public key + device id (proves JS-issued
// tokens verify in Rust). Usage: cargo run -p core-license --example verify -- <pubhex> <token> <device> <now>
fn hex32(s: &str) -> [u8; 32] {
    let b: Vec<u8> = (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect();
    let mut out = [0u8; 32];
    out.copy_from_slice(&b[..32]);
    out
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let pubkey = hex32(&a[1]);
    let token = &a[2];
    let device = a.get(3).map(|s| s.as_str()).unwrap_or("");
    let now: i64 = a.get(4).and_then(|s| s.parse().ok()).unwrap_or(1_000_000_100);
    match core_license::verify_on_device(token, &pubkey, now, device) {
        Ok(lic) => println!("OK tier={} subject={} device={} features={:?}", lic.tier, lic.subject, lic.device_id, lic.features),
        Err(e) => println!("FAIL {e}"),
    }
}
