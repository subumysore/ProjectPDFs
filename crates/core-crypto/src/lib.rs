//! `core-crypto` — on-device cryptography.
//!
//! - **AES-256-GCM sealing** for encryption at rest (vault values, blobs).
//! - **Ed25519 signing** for signatures + provenance.
//! - **X25519 sealed bundles** for user-directed E2E export/import (`.pdfxfer`, ADR-0003).
//!
//! Keys come from the OS secure keystore in production. No user data ever leaves
//! the device except a user-directed, E2E-encrypted bundle they choose to send.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

/// A 256-bit symmetric key for at-rest sealing.
pub type SealKey = [u8; 32];

const NONCE_LEN: usize = 12;

/// Failure opening a sealed value.
#[derive(Debug, PartialEq, Eq)]
pub enum CryptoError {
    /// Authentication failed — wrong key or tampered ciphertext.
    Open,
    /// Input too short / malformed.
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

fn random_32() -> [u8; 32] {
    use rand_core::RngCore;
    let mut b = [0u8; 32];
    rand_core::OsRng.fill_bytes(&mut b);
    b
}

// --- Symmetric sealing (AES-256-GCM) ---

/// Generate a fresh random 256-bit key from the OS CSPRNG.
pub fn generate_key() -> SealKey {
    random_32()
}

/// Seal (encrypt + authenticate) `plaintext` under `key`. Output: `nonce || ciphertext+tag`.
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

// --- Passphrase-based encrypted export/import (user-directed backup/transfer, ADR-0003) ---
//
// A vault backup the user can move to another device. Encrypted with a key derived from
// an export PASSPHRASE (PBKDF2-HMAC-SHA256) — the passphrase is never stored and the file
// alone is useless. Whoever knows the passphrase (i.e. the owner) can import. Any identity
// binding (e.g. an SSO account/subject) lives inside the encrypted, authenticated payload
// the caller supplies, so it cannot be altered. There is NO plaintext export.

const EXPORT_MAGIC: &[u8; 8] = b"PPFVLT01";
const EXPORT_ITERS: u32 = 600_000;
const EXPORT_ITERS_MAX: u32 = 5_000_000; // reject a hostile file that would DoS import
const EXPORT_HLEN: usize = 8 + 4 + 16; // magic | iters(LE) | salt

fn random_16() -> [u8; 16] {
    use rand_core::RngCore;
    let mut b = [0u8; 16];
    rand_core::OsRng.fill_bytes(&mut b);
    b
}

fn derive_passphrase_key(passphrase: &str, salt: &[u8], iters: u32) -> SealKey {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, iters, &mut key);
    key
}

/// Encrypt `plaintext` under an export passphrase for user-directed backup/transfer.
/// Layout: `MAGIC(8) | iters(4 LE) | salt(16) | nonce(12) | ciphertext+tag`. The header
/// is authenticated as AES-GCM associated data, so it cannot be tampered with.
pub fn export_encrypted(passphrase: &str, plaintext: &[u8]) -> Vec<u8> {
    let salt = random_16();
    let key = derive_passphrase_key(passphrase, &salt, EXPORT_ITERS);
    let mut header = Vec::with_capacity(EXPORT_HLEN);
    header.extend_from_slice(EXPORT_MAGIC);
    header.extend_from_slice(&EXPORT_ITERS.to_le_bytes());
    header.extend_from_slice(&salt);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher
        .encrypt(&nonce, aes_gcm::aead::Payload { msg: plaintext, aad: &header })
        .expect("AES-GCM encrypt");
    let mut out = header;
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&ct);
    out
}

/// Decrypt a blob produced by [`export_encrypted`]. A wrong passphrase or ANY tampering
/// (header, nonce, or ciphertext) yields [`CryptoError::Open`].
pub fn import_encrypted(passphrase: &str, blob: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if blob.len() < EXPORT_HLEN + NONCE_LEN {
        return Err(CryptoError::Malformed);
    }
    let (header, rest) = blob.split_at(EXPORT_HLEN);
    if &header[0..8] != EXPORT_MAGIC {
        return Err(CryptoError::Malformed);
    }
    let iters = u32::from_le_bytes(header[8..12].try_into().unwrap());
    if iters == 0 || iters > EXPORT_ITERS_MAX {
        return Err(CryptoError::Malformed);
    }
    let salt = &header[12..28];
    let key = derive_passphrase_key(passphrase, salt, iters);
    let (nonce_bytes, ct) = rest.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, aes_gcm::aead::Payload { msg: ct, aad: header })
        .map_err(|_| CryptoError::Open)
}

// --- Ed25519 signing (signatures + provenance) ---

/// An Ed25519 signing keypair (the signer's own key; produced by their authenticator).
pub struct SignKeypair {
    signing: SigningKey,
}

impl SignKeypair {
    /// Generate a new keypair from the OS CSPRNG.
    pub fn generate() -> Self {
        Self {
            signing: SigningKey::generate(&mut rand_core::OsRng),
        }
    }
    /// Restore from a 32-byte secret seed.
    pub fn from_secret(bytes: &[u8; 32]) -> Self {
        Self {
            signing: SigningKey::from_bytes(bytes),
        }
    }
    /// The 32-byte secret seed (store in the OS keystore).
    pub fn secret_bytes(&self) -> [u8; 32] {
        self.signing.to_bytes()
    }
    /// The 32-byte public key (the verifiable identity binding).
    pub fn public_bytes(&self) -> [u8; 32] {
        self.signing.verifying_key().to_bytes()
    }
    /// Sign a message (typically a document hash). Returns a 64-byte signature.
    pub fn sign(&self, msg: &[u8]) -> [u8; 64] {
        self.signing.sign(msg).to_bytes()
    }
}

/// Verify an Ed25519 signature against a public key. Returns false on any error.
pub fn verify(public: &[u8; 32], msg: &[u8], signature: &[u8; 64]) -> bool {
    match VerifyingKey::from_bytes(public) {
        Ok(vk) => vk.verify(msg, &ed25519_dalek::Signature::from_bytes(signature)).is_ok(),
        Err(_) => false,
    }
}

// --- X25519 sealed bundles (user-directed E2E export/import) ---

/// An X25519 keypair for receiving sealed bundles.
pub struct BoxKeypair {
    secret: StaticSecret,
}

impl BoxKeypair {
    /// Generate a new recipient keypair.
    pub fn generate() -> Self {
        Self {
            secret: StaticSecret::from(random_32()),
        }
    }
    /// Restore from a 32-byte secret.
    pub fn from_secret(bytes: [u8; 32]) -> Self {
        Self {
            secret: StaticSecret::from(bytes),
        }
    }
    /// The 32-byte secret (store in the OS keystore).
    pub fn secret_bytes(&self) -> [u8; 32] {
        self.secret.to_bytes()
    }
    /// The 32-byte public key to share with senders.
    pub fn public_bytes(&self) -> [u8; 32] {
        PublicKey::from(&self.secret).to_bytes()
    }
}

/// Seal `plaintext` to a recipient's public key (ECIES-style). Output:
/// `ephemeral_public (32) || nonce || ciphertext+tag`.
///
/// NOTE: the DH output is used directly as the AES key here; production derives it
/// via HKDF. Suitable for the `.pdfxfer` bundle format (ADR-0003, to be finalised).
pub fn seal_to(recipient_public: &[u8; 32], plaintext: &[u8]) -> Vec<u8> {
    let ephemeral = StaticSecret::from(random_32());
    let eph_pub = PublicKey::from(&ephemeral).to_bytes();
    let shared = ephemeral.diffie_hellman(&PublicKey::from(*recipient_public));
    let key: SealKey = *shared.as_bytes();
    let sealed = seal(&key, plaintext);
    let mut out = Vec::with_capacity(32 + sealed.len());
    out.extend_from_slice(&eph_pub);
    out.extend_from_slice(&sealed);
    out
}

/// Open a bundle produced by [`seal_to`] with the recipient's secret.
pub fn open_from(recipient_secret: &[u8; 32], bundle: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if bundle.len() < 32 + NONCE_LEN {
        return Err(CryptoError::Malformed);
    }
    let (eph_pub, sealed) = bundle.split_at(32);
    let mut epk = [0u8; 32];
    epk.copy_from_slice(eph_pub);
    let secret = StaticSecret::from(*recipient_secret);
    let shared = secret.diffie_hellman(&PublicKey::from(epk));
    let key: SealKey = *shared.as_bytes();
    open(&key, sealed)
}

// --- Provenance (verifiable manifest, ADR-0009) ---

/// SHA-256 of `bytes` as lowercase hex — the canonical document hash.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut s = String::with_capacity(64);
    for b in digest {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// The public, verifiable part of a provenance manifest embedded in a document.
///
/// It binds the document hash, the signer's public key (identity), a timestamp,
/// and the acting roles. Signing/verifying is over its canonical bytes. The
/// authority-scoped sensitive block (encrypted to a named authority's key) is a
/// separate field added when ADR-0009 is finalised.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvenanceManifest {
    /// Hex SHA-256 of the finalised document.
    pub doc_hash: String,
    /// The signer's Ed25519 public key (identity binding).
    pub signer_public: [u8; 32],
    /// Creation time (epoch seconds; caller-provided for determinism/trusted timestamp).
    pub created_at: u64,
    /// The roles that acted (e.g. "Seller", "Notary").
    pub roles: Vec<String>,
}

impl ProvenanceManifest {
    fn canonical_bytes(&self) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(self.doc_hash.as_bytes());
        b.push(0);
        b.extend_from_slice(&self.signer_public);
        b.extend_from_slice(&self.created_at.to_be_bytes());
        for r in &self.roles {
            b.extend_from_slice(r.as_bytes());
            b.push(0);
        }
        b
    }

    /// Sign this manifest with `kp` (whose public key must be `signer_public`).
    pub fn sign(&self, kp: &SignKeypair) -> [u8; 64] {
        kp.sign(&self.canonical_bytes())
    }

    /// Verify a signature over this manifest against its embedded `signer_public`.
    pub fn verify(&self, signature: &[u8; 64]) -> bool {
        verify(&self.signer_public, &self.canonical_bytes(), signature)
    }
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
        let sealed = seal(&key, b"Asha Rao");
        assert_ne!(&sealed[NONCE_LEN..NONCE_LEN + 8], b"Asha Rao");
        assert_eq!(open(&key, &sealed).unwrap(), b"Asha Rao");
    }

    #[test]
    fn nonce_is_random_per_call() {
        let key = generate_key();
        assert_ne!(seal(&key, b"same"), seal(&key, b"same"));
    }

    #[test]
    fn wrong_key_and_tamper_rejected() {
        let key = generate_key();
        let mut sealed = seal(&key, b"secret");
        assert_eq!(open(&generate_key(), &sealed), Err(CryptoError::Open));
        let last = sealed.len() - 1;
        sealed[last] ^= 1;
        assert_eq!(open(&key, &sealed), Err(CryptoError::Open));
    }

    #[test]
    fn short_input_is_malformed() {
        assert_eq!(open(&generate_key(), b"abc"), Err(CryptoError::Malformed));
    }

    #[test]
    fn ed25519_sign_verify_roundtrip() {
        let kp = SignKeypair::generate();
        let msg = b"document-hash";
        let sig = kp.sign(msg);
        assert!(verify(&kp.public_bytes(), msg, &sig));
        // tampered message fails
        assert!(!verify(&kp.public_bytes(), b"other", &sig));
        // wrong key fails
        assert!(!verify(&SignKeypair::generate().public_bytes(), msg, &sig));
    }

    #[test]
    fn ed25519_key_is_restorable() {
        let kp = SignKeypair::generate();
        let restored = SignKeypair::from_secret(&kp.secret_bytes());
        assert_eq!(kp.public_bytes(), restored.public_bytes());
        let msg = b"x";
        assert!(verify(&kp.public_bytes(), msg, &restored.sign(msg)));
    }

    #[test]
    fn x25519_sealed_bundle_roundtrip() {
        let recipient = BoxKeypair::generate();
        let bundle = seal_to(&recipient.public_bytes(), b"share me");
        assert_eq!(open_from(&recipient.secret_bytes(), &bundle).unwrap(), b"share me");
        // a different recipient cannot open it
        let other = BoxKeypair::generate();
        assert!(open_from(&other.secret_bytes(), &bundle).is_err());
    }

    #[test]
    fn sha256_known_vector() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn provenance_sign_and_tamper() {
        let kp = SignKeypair::generate();
        let manifest = ProvenanceManifest {
            doc_hash: sha256_hex(b"the finalised filled document"),
            signer_public: kp.public_bytes(),
            created_at: 1_700_000_000,
            roles: vec!["Signer".into()],
        };
        let sig = manifest.sign(&kp);
        assert!(manifest.verify(&sig));

        // tampering the document hash invalidates the signature
        let mut tampered = manifest.clone();
        tampered.doc_hash = sha256_hex(b"a different document");
        assert!(!tampered.verify(&sig));
    }

    #[test]
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-crypto");
    }

    #[test]
    fn export_import_roundtrips() {
        let data = br#"{"subject":"asha@example.com","data":{"first_name":"Asha"}}"#;
        let blob = export_encrypted("correct horse battery staple", data);
        let out = import_encrypted("correct horse battery staple", &blob).expect("import");
        assert_eq!(&out, data);
    }

    #[test]
    fn wrong_passphrase_fails() {
        let blob = export_encrypted("right-pass", b"secret vault");
        assert_eq!(import_encrypted("wrong-pass", &blob), Err(CryptoError::Open));
    }

    #[test]
    fn no_plaintext_leak_and_tamper_detected() {
        let secret = b"home address 12 MG Road";
        let mut blob = export_encrypted("pw", secret);
        // Ciphertext must not contain the plaintext.
        assert!(!blob.windows(secret.len()).any(|w| w == secret));
        // Flip a ciphertext byte -> authentication fails.
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert_eq!(import_encrypted("pw", &blob), Err(CryptoError::Open));
    }

    #[test]
    fn tampered_header_is_rejected() {
        let mut blob = export_encrypted("pw", b"x");
        blob[9] ^= 0x01; // change the iteration count in the authenticated header
        assert!(import_encrypted("pw", &blob).is_err());
    }

    #[test]
    fn hostile_iteration_count_rejected() {
        let mut blob = export_encrypted("pw", b"x");
        blob[8..12].copy_from_slice(&u32::MAX.to_le_bytes()); // would DoS the KDF
        assert_eq!(import_encrypted("pw", &blob), Err(CryptoError::Malformed));
    }
}
