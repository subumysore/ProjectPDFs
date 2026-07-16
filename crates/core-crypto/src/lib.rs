//! `core-crypto` — on-device cryptography.
//!
//! Phase 1: **AES-256-GCM sealing** for encryption at rest (vault values, blobs).
//! Later: Ed25519 signing, passphrase KDF, E2E `.pdfxfer` bundles, provenance —
//! keys sourced from the OS secure keystore. No user data ever leaves the device.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};

/// A 256-bit symmetric key for at-rest sealing. Production stores this in the OS keystore.
pub type SealKey = [u8; 32];

const NONCE_LEN: usize = 12;

/// Failure opening a sealed value.
#[derive(Debug, PartialEq, Eq)]
pub enum CryptoError {
    /// Authentication failed — wrong key or tampered ciphertext.
    Open,
    /// Input too short to contain a nonce.
    Malformed,
}

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CryptoError::Open => write!(f, "decryption failed (wrong key or tampered data)"),
            CryptoError::Malformed => write!(f, "sealed value is malformed"),
        }
    }
}
impl std::error::Error for CryptoError {}

/// Generate a fresh random 256-bit key from the OS CSPRNG.
pub fn generate_key() -> SealKey {
    use aes_gcm::aead::rand_core::RngCore;
    let mut k = [0u8; 32];
    OsRng.fill_bytes(&mut k);
    k
}

/// Seal (encrypt + authenticate) `plaintext` under `key`.
///
/// Output layout: `nonce (12 bytes) || ciphertext+tag`. A fresh random nonce is
/// used per call, so sealing the same value twice yields different bytes.
pub fn seal(key: &SealKey, plaintext: &[u8]) -> Vec<u8> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext).expect("AES-GCM encrypt");
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&ciphertext);
    out
}

/// Open (decrypt + verify) a value produced by [`seal`].
pub fn open(key: &SealKey, sealed: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if sealed.len() < NONCE_LEN {
        return Err(CryptoError::Malformed);
    }
    let (nonce_bytes, ciphertext) = sealed.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher.decrypt(nonce, ciphertext).map_err(|_| CryptoError::Open)
}

/// Returns this crate's stable module name.
pub fn module_name() -> &'static str {
    "core-crypto"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_open_roundtrip() {
        let key = generate_key();
        let msg = b"Asha Rao";
        let sealed = seal(&key, msg);
        assert!(sealed.len() > NONCE_LEN);
        // ciphertext must not equal the plaintext
        assert_ne!(&sealed[NONCE_LEN..NONCE_LEN + msg.len()], &msg[..]);
        assert_eq!(open(&key, &sealed).unwrap(), msg);
    }

    #[test]
    fn nonce_is_random_per_call() {
        let key = generate_key();
        assert_ne!(seal(&key, b"same"), seal(&key, b"same"));
    }

    #[test]
    fn wrong_key_is_rejected() {
        let sealed = seal(&generate_key(), b"secret");
        assert_eq!(open(&generate_key(), &sealed), Err(CryptoError::Open));
    }

    #[test]
    fn tamper_is_rejected() {
        let key = generate_key();
        let mut sealed = seal(&key, b"secret");
        let last = sealed.len() - 1;
        sealed[last] ^= 0x01;
        assert_eq!(open(&key, &sealed), Err(CryptoError::Open));
    }

    #[test]
    fn short_input_is_malformed() {
        assert_eq!(open(&generate_key(), b"abc"), Err(CryptoError::Malformed));
    }

    #[test]
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-crypto");
    }
}
