//! `core-license` — **offline, privacy-preserving** licensing.
//!
//! The vendor signs a small license (tier + features + expiry) with an Ed25519
//! private key. The app embeds only the vendor **public** key and verifies the
//! license token **on-device** — no activation server, no phone-home, no telemetry.
//! This lets the product be paid while keeping the "nothing leaves your device"
//! invariant intact: a license is data the user holds, verified locally.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use base64::Engine;
use serde::{Deserialize, Serialize};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;
const HEADER: &str = "PPDF1";

/// A license's contents (the signed payload).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct License {
    /// Who it's for (email / org id) — shown to the user, not sent anywhere.
    pub subject: String,
    /// Tier name (e.g. "free", "pro", "team").
    pub tier: String,
    /// Entitled feature flags (e.g. "docx", "ocr", "translate", "companion").
    pub features: Vec<String>,
    /// Unix seconds issued.
    pub issued_at: i64,
    /// Unix seconds expiry; `0` = perpetual.
    pub expires_at: i64,
}

impl License {
    /// True if the license grants `feature`.
    pub fn has(&self, feature: &str) -> bool {
        self.features.iter().any(|f| f == feature)
    }
    /// True if not expired at `now` (unix seconds).
    pub fn is_current(&self, now: i64) -> bool {
        self.expires_at == 0 || now <= self.expires_at
    }
}

/// Why a token was rejected.
#[derive(Debug, PartialEq, Eq)]
pub enum LicenseError {
    /// Not a well-formed `PPDF1.<payload>.<sig>` token.
    Malformed,
    /// Signature does not verify against the vendor public key.
    BadSignature,
    /// The license has expired.
    Expired,
}

impl std::fmt::Display for LicenseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LicenseError::Malformed => write!(f, "malformed license token"),
            LicenseError::BadSignature => write!(f, "license signature is invalid"),
            LicenseError::Expired => write!(f, "license has expired"),
        }
    }
}
impl std::error::Error for LicenseError {}

/// Vendor-side: sign a license into a portable token. (Used by the vendor's key
/// holder / this crate's tests — the app never needs the private key.)
pub fn issue(license: &License, keypair: &core_crypto::SignKeypair) -> String {
    let json = serde_json::to_vec(license).expect("serialize license");
    let sig = keypair.sign(&json);
    format!("{HEADER}.{}.{}", B64.encode(&json), B64.encode(sig))
}

/// App-side: verify a token against the embedded vendor public key at time `now`.
pub fn verify(token: &str, vendor_public: &[u8; 32], now: i64) -> Result<License, LicenseError> {
    let mut parts = token.trim().split('.');
    if parts.next() != Some(HEADER) {
        return Err(LicenseError::Malformed);
    }
    let json = B64
        .decode(parts.next().ok_or(LicenseError::Malformed)?)
        .map_err(|_| LicenseError::Malformed)?;
    let sig_bytes = B64
        .decode(parts.next().ok_or(LicenseError::Malformed)?)
        .map_err(|_| LicenseError::Malformed)?;
    if parts.next().is_some() {
        return Err(LicenseError::Malformed);
    }
    let sig: [u8; 64] = sig_bytes.try_into().map_err(|_| LicenseError::Malformed)?;
    if !core_crypto::verify(vendor_public, &json, &sig) {
        return Err(LicenseError::BadSignature);
    }
    let license: License = serde_json::from_slice(&json).map_err(|_| LicenseError::Malformed)?;
    if !license.is_current(now) {
        return Err(LicenseError::Expired);
    }
    Ok(license)
}

/// Returns this crate's stable module name.
pub fn module_name() -> &'static str {
    "core-license"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pro() -> License {
        License {
            subject: "asha@example.com".into(),
            tier: "pro".into(),
            features: vec!["docx".into(), "ocr".into(), "translate".into()],
            issued_at: 1_000,
            expires_at: 2_000,
        }
    }

    #[test]
    fn issue_then_verify_roundtrips_and_gates_features() {
        let kp = core_crypto::SignKeypair::generate();
        let token = issue(&pro(), &kp);
        let lic = verify(&token, &kp.public_bytes(), 1_500).expect("valid");
        assert_eq!(lic.tier, "pro");
        assert!(lic.has("docx") && lic.has("ocr"));
        assert!(!lic.has("team"));
    }

    #[test]
    fn wrong_vendor_key_is_rejected() {
        let kp = core_crypto::SignKeypair::generate();
        let other = core_crypto::SignKeypair::generate();
        let token = issue(&pro(), &kp);
        assert_eq!(verify(&token, &other.public_bytes(), 1_500), Err(LicenseError::BadSignature));
    }

    #[test]
    fn tampered_payload_is_rejected() {
        let kp = core_crypto::SignKeypair::generate();
        let token = issue(&pro(), &kp);
        // Flip a char in the payload segment.
        let mut parts: Vec<&str> = token.split('.').collect();
        let mut payload = B64.decode(parts[1]).unwrap();
        payload[0] ^= 0x01;
        let bad = B64.encode(payload);
        parts[1] = &bad;
        assert_eq!(verify(&parts.join("."), &kp.public_bytes(), 1_500), Err(LicenseError::BadSignature));
    }

    #[test]
    fn expired_is_rejected_but_perpetual_is_ok() {
        let kp = core_crypto::SignKeypair::generate();
        let token = issue(&pro(), &kp);
        assert_eq!(verify(&token, &kp.public_bytes(), 3_000), Err(LicenseError::Expired));
        let mut perpetual = pro();
        perpetual.expires_at = 0;
        let t2 = issue(&perpetual, &kp);
        assert!(verify(&t2, &kp.public_bytes(), 9_999_999).is_ok());
    }

    #[test]
    fn malformed_tokens_rejected() {
        let kp = core_crypto::SignKeypair::generate();
        assert_eq!(verify("nope", &kp.public_bytes(), 0), Err(LicenseError::Malformed));
        assert_eq!(verify("PPDF1.only-two", &kp.public_bytes(), 0), Err(LicenseError::Malformed));
    }
}
