//! `core-store` — on-device store: per-Profile vault (Profiles + DataPoints).
//!
//! **DataPoint values are AES-256-GCM sealed at rest** (`core-crypto`) with a key
//! from the OS keystore; the DB holds only ciphertext. The DB may additionally
//! move to SQLCipher later. No user data ever leaves the device.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use core_crypto::{open, seal, CryptoError, SealKey};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Errors from the store (database or decryption).
#[derive(Debug)]
pub enum StoreError {
    /// Underlying SQLite error.
    Db(rusqlite::Error),
    /// Decryption/authentication failure (wrong key or tampered data).
    Crypto(CryptoError),
    /// A sealed value did not decrypt to valid UTF-8.
    Utf8,
}
impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Db(e) => write!(f, "db: {e}"),
            StoreError::Crypto(e) => write!(f, "crypto: {e}"),
            StoreError::Utf8 => write!(f, "decrypted value was not valid UTF-8"),
        }
    }
}
impl std::error::Error for StoreError {}
impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Db(e)
    }
}
impl From<CryptoError> for StoreError {
    fn from(e: CryptoError) -> Self {
        StoreError::Crypto(e)
    }
}

/// Store result type.
pub type Result<T> = std::result::Result<T, StoreError>;

/// A person/role whose data lives on-device. Everything personal hangs off a Profile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Profile {
    /// Stable id.
    pub id: String,
    /// Display name.
    pub name: String,
}

/// A reusable `key -> value` a Profile holds (e.g. `full_name`, `date_of_birth`).
/// The `value` is plaintext in memory; it is **sealed** before it touches disk.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataPoint {
    /// Canonical key (matches catalog field-map ontology keys).
    pub key: String,
    /// The user's value (plaintext in memory only).
    pub value: String,
}

/// A filled form for a Profile (an immutable chain of versions hangs off it).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FormInstance {
    /// Stable id.
    pub id: String,
    /// Owning Profile.
    pub profile_id: String,
    /// The catalog entry (form) this instance fills.
    pub entry_id: String,
}

/// Metadata for one immutable version of a FormInstance.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VersionMeta {
    /// 1-based version number.
    pub version_no: i64,
    /// Creation time (epoch seconds; caller-provided).
    pub created_at: i64,
}

/// A signature over a specific version of a FormInstance (non-delegable — the
/// signer's own key). Bytes are hex to cross the bridge cleanly.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignatureRecord {
    /// Version signed.
    pub version_no: i64,
    /// Signer public key (hex).
    pub signer_public: String,
    /// Signature (hex).
    pub signature: String,
    /// Algorithm (e.g. "ed25519").
    pub alg: String,
    /// Time signed (epoch seconds).
    pub created_at: i64,
}

/// On-device store handle. Holds the sealing key for value encryption at rest.
pub struct Store {
    conn: Connection,
    key: SealKey,
}

impl Store {
    /// Open a store at `path` (`":memory:"` for tests) with the given sealing `key`.
    pub fn open(path: &str, key: SealKey) -> Result<Self> {
        let s = Self {
            conn: Connection::open(path)?,
            key,
        };
        s.migrate()?;
        Ok(s)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS profiles(
                 id   TEXT PRIMARY KEY,
                 name TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS data_points(
                 profile_id  TEXT NOT NULL,
                 key         TEXT NOT NULL,
                 value_enc    BLOB NOT NULL,
                 updated_at  INTEGER NOT NULL DEFAULT 0,
                 PRIMARY KEY(profile_id, key),
                 FOREIGN KEY(profile_id) REFERENCES profiles(id)
             );
             CREATE TABLE IF NOT EXISTS form_instances(
                 id         TEXT PRIMARY KEY,
                 profile_id TEXT NOT NULL,
                 entry_id   TEXT NOT NULL,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS form_versions(
                 instance_id TEXT NOT NULL,
                 version_no  INTEGER NOT NULL,
                 values_enc  BLOB NOT NULL,
                 created_at  INTEGER NOT NULL,
                 PRIMARY KEY(instance_id, version_no)
             );
             CREATE TABLE IF NOT EXISTS form_blobs(
                 instance_id TEXT NOT NULL,
                 version_no  INTEGER NOT NULL,
                 blob_enc    BLOB NOT NULL,
                 PRIMARY KEY(instance_id, version_no)
             );
             CREATE TABLE IF NOT EXISTS history_events(
                 instance_id TEXT NOT NULL,
                 kind        TEXT NOT NULL,
                 at          INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS signatures(
                 instance_id   TEXT NOT NULL,
                 version_no    INTEGER NOT NULL,
                 signer_public TEXT NOT NULL,
                 signature     TEXT NOT NULL,
                 alg           TEXT NOT NULL,
                 created_at    INTEGER NOT NULL,
                 PRIMARY KEY(instance_id, version_no, signer_public)
             );",
        )?;
        // Add per-field timestamps to pre-existing data_points tables (for last-write-wins sync).
        // Ignored if the column already exists.
        let _ = self
            .conn
            .execute("ALTER TABLE data_points ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0", []);
        Ok(())
    }

    /// Record a signature over a version (idempotent per signer + version).
    pub fn add_signature(&self, instance_id: &str, s: &SignatureRecord) -> Result<()> {
        self.conn.execute(
            "INSERT INTO signatures(instance_id, version_no, signer_public, signature, alg, created_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(instance_id, version_no, signer_public) DO UPDATE
               SET signature = excluded.signature, created_at = excluded.created_at",
            params![instance_id, s.version_no, s.signer_public, s.signature, s.alg, s.created_at],
        )?;
        Ok(())
    }

    /// Signatures on a FormInstance, newest version first.
    pub fn list_signatures(&self, instance_id: &str) -> Result<Vec<SignatureRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT version_no, signer_public, signature, alg, created_at
             FROM signatures WHERE instance_id = ?1 ORDER BY version_no DESC",
        )?;
        let rows = stmt.query_map(params![instance_id], |r| {
            Ok(SignatureRecord {
                version_no: r.get(0)?,
                signer_public: r.get(1)?,
                signature: r.get(2)?,
                alg: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Create a FormInstance (a filled form for a Profile). Idempotent by id, so a
    /// stable `profile:entry` id accumulates versions across saves.
    pub fn create_instance(&self, fi: &FormInstance, created_at: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO form_instances(id, profile_id, entry_id, created_at) VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO NOTHING",
            params![fi.id, fi.profile_id, fi.entry_id, created_at],
        )?;
        Ok(())
    }

    /// Append a new **immutable** version with the filled `values` (sealed). Returns the version number.
    pub fn add_version(
        &self,
        instance_id: &str,
        values: &BTreeMap<String, String>,
        created_at: i64,
    ) -> Result<i64> {
        let next: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(version_no), 0) + 1 FROM form_versions WHERE instance_id = ?1",
            params![instance_id],
            |r| r.get(0),
        )?;
        let json = serde_json::to_vec(values).expect("serialize values");
        let sealed = seal(&self.key, &json);
        self.conn.execute(
            "INSERT INTO form_versions(instance_id, version_no, values_enc, created_at)
             VALUES(?1, ?2, ?3, ?4)",
            params![instance_id, next, sealed, created_at],
        )?;
        Ok(next)
    }

    /// Versions of a FormInstance, oldest first.
    pub fn list_versions(&self, instance_id: &str) -> Result<Vec<VersionMeta>> {
        let mut stmt = self.conn.prepare(
            "SELECT version_no, created_at FROM form_versions WHERE instance_id = ?1 ORDER BY version_no",
        )?;
        let rows = stmt.query_map(params![instance_id], |r| {
            Ok(VersionMeta {
                version_no: r.get(0)?,
                created_at: r.get(1)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// The filled values of a specific version (decrypted).
    pub fn version_values(
        &self,
        instance_id: &str,
        version_no: i64,
    ) -> Result<BTreeMap<String, String>> {
        let enc: Vec<u8> = self.conn.query_row(
            "SELECT values_enc FROM form_versions WHERE instance_id = ?1 AND version_no = ?2",
            params![instance_id, version_no],
            |r| r.get(0),
        )?;
        let json = open(&self.key, &enc)?;
        serde_json::from_slice(&json).map_err(|_| StoreError::Utf8)
    }

    /// Store the sealed filled-PDF bytes for a version (idempotent per version), so a past
    /// filled form can be re-downloaded on-device without regenerating it.
    pub fn add_version_blob(&self, instance_id: &str, version_no: i64, bytes: &[u8]) -> Result<()> {
        let sealed = seal(&self.key, bytes);
        self.conn.execute(
            "INSERT INTO form_blobs(instance_id, version_no, blob_enc) VALUES(?1, ?2, ?3)
             ON CONFLICT(instance_id, version_no) DO UPDATE SET blob_enc = excluded.blob_enc",
            params![instance_id, version_no, sealed],
        )?;
        Ok(())
    }

    /// The filled-PDF bytes of a specific version (decrypted).
    pub fn version_blob(&self, instance_id: &str, version_no: i64) -> Result<Vec<u8>> {
        let enc: Vec<u8> = self.conn.query_row(
            "SELECT blob_enc FROM form_blobs WHERE instance_id = ?1 AND version_no = ?2",
            params![instance_id, version_no],
            |r| r.get(0),
        )?;
        Ok(open(&self.key, &enc)?)
    }

    /// All FormInstances for a Profile, most-recently-created first.
    pub fn list_instances(&self, profile_id: &str) -> Result<Vec<FormInstance>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, profile_id, entry_id FROM form_instances WHERE profile_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![profile_id], |r| {
            Ok(FormInstance {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                entry_id: r.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Record a history event (`save` / `submit` / `print`).
    pub fn record_event(&self, instance_id: &str, kind: &str, at: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO history_events(instance_id, kind, at) VALUES(?1, ?2, ?3)",
            params![instance_id, kind, at],
        )?;
        Ok(())
    }

    /// Count history events of a given kind for a FormInstance.
    pub fn event_count(&self, instance_id: &str, kind: &str) -> Result<i64> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM history_events WHERE instance_id = ?1 AND kind = ?2",
            params![instance_id, kind],
            |r| r.get(0),
        )?)
    }

    /// Insert or update a Profile.
    pub fn put_profile(&self, p: &Profile) -> Result<()> {
        self.conn.execute(
            "INSERT INTO profiles(id, name) VALUES(?1, ?2)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![p.id, p.name],
        )?;
        Ok(())
    }

    /// Delete a Profile and EVERYTHING that belongs to it: its data points, and every saved form
    /// instance with its versions, blobs, history and signatures. Runs in a single transaction so
    /// a profile is never left half-deleted. Returns the number of data points that were removed.
    ///
    /// This is a real erase, not a hide - the encrypted rows are gone from vault.db. There is no
    /// separate "trash": deleting a profile is how a user removes data they no longer want on the
    /// device, so it must actually remove it.
    pub fn delete_profile(&self, profile_id: &str) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        // Collect the profile's form instances first, so their child rows can be cleared by id.
        let instance_ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT id FROM form_instances WHERE profile_id = ?1")?;
            let rows = stmt.query_map(params![profile_id], |r| r.get::<_, String>(0))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        for iid in &instance_ids {
            tx.execute("DELETE FROM form_blobs WHERE instance_id = ?1", params![iid])?;
            tx.execute("DELETE FROM form_versions WHERE instance_id = ?1", params![iid])?;
            tx.execute("DELETE FROM history_events WHERE instance_id = ?1", params![iid])?;
            tx.execute("DELETE FROM signatures WHERE instance_id = ?1", params![iid])?;
        }
        tx.execute("DELETE FROM form_instances WHERE profile_id = ?1", params![profile_id])?;
        let removed = tx.execute("DELETE FROM data_points WHERE profile_id = ?1", params![profile_id])?;
        tx.execute("DELETE FROM profiles WHERE id = ?1", params![profile_id])?;
        tx.commit()?;
        Ok(removed)
    }

    /// All Profiles, ordered by name.
    pub fn list_profiles(&self) -> Result<Vec<Profile>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM profiles ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(Profile {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// How many fields each profile holds, keyed by profile id. A plain COUNT(*) — it does NOT
    /// decrypt any values, so it is cheap even for a vault full of large base64 images. The
    /// companion uses it to pick the profile that actually has data without reading whole vaults.
    pub fn profile_field_counts(&self) -> Result<std::collections::HashMap<String, i64>> {
        let mut stmt = self
            .conn
            .prepare("SELECT profile_id, COUNT(*) FROM data_points GROUP BY profile_id")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()?)
    }

    /// Insert or update a DataPoint for a Profile, stamping it `updated_at` (epoch secs) for
    /// last-write-wins sync. The value is **sealed** before storage.
    pub fn put_data_point_at(&self, profile_id: &str, dp: &DataPoint, updated_at: i64) -> Result<()> {
        let sealed = seal(&self.key, dp.value.as_bytes());
        self.conn.execute(
            "INSERT INTO data_points(profile_id, key, value_enc, updated_at) VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(profile_id, key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at",
            params![profile_id, dp.key, sealed, updated_at],
        )?;
        Ok(())
    }

    /// Back-compat convenience: upsert without an explicit timestamp (stamps 0). Prefer
    /// [`put_data_point_at`] so the field participates in last-write-wins sync.
    pub fn put_data_point(&self, profile_id: &str, dp: &DataPoint) -> Result<()> {
        self.put_data_point_at(profile_id, dp, 0)
    }

    /// All DataPoints for a Profile with their `updated_at` (decrypted), ordered by key —
    /// the input to last-write-wins reconciliation.
    pub fn data_points_meta(&self, profile_id: &str) -> Result<Vec<(String, String, i64)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value_enc, updated_at FROM data_points WHERE profile_id = ?1 ORDER BY key")?;
        let rows = stmt.query_map(params![profile_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?, r.get::<_, i64>(2)?))
        })?;
        let mut out = Vec::new();
        for r in rows {
            let (key, enc, t) = r?;
            out.push((key, self.decrypt(&enc)?, t));
        }
        Ok(out)
    }

    /// All DataPoints for a Profile (decrypted), ordered by key.
    pub fn data_points(&self, profile_id: &str) -> Result<Vec<DataPoint>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value_enc FROM data_points WHERE profile_id = ?1 ORDER BY key")?;
        let rows = stmt.query_map(params![profile_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
        })?;
        let mut out = Vec::new();
        for r in rows {
            let (key, enc) = r?;
            out.push(DataPoint {
                key,
                value: self.decrypt(&enc)?,
            });
        }
        Ok(out)
    }

    /// Delete a DataPoint by key.
    pub fn delete_data_point(&self, profile_id: &str, key: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM data_points WHERE profile_id = ?1 AND key = ?2",
            params![profile_id, key],
        )?;
        Ok(())
    }

    /// The whole vault for a Profile as `key -> value` (decrypted).
    pub fn vault(&self, profile_id: &str) -> Result<BTreeMap<String, String>> {
        Ok(self
            .data_points(profile_id)?
            .into_iter()
            .map(|dp| (dp.key, dp.value))
            .collect())
    }

    fn decrypt(&self, enc: &[u8]) -> Result<String> {
        let bytes = open(&self.key, enc)?;
        String::from_utf8(bytes).map_err(|_| StoreError::Utf8)
    }
}

/// Returns this crate's stable module name.
pub fn module_name() -> &'static str {
    "core-store"
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_crypto::generate_key;

    #[test]
    fn delete_profile_erases_everything_it_owns_and_nothing_else() {
        let s = Store::open(":memory:", generate_key()).unwrap();
        for (id, name) in [("keep", "Keeper"), ("gone", "Goner")] {
            s.put_profile(&Profile { id: id.into(), name: name.into() }).unwrap();
            s.put_data_point(id, &DataPoint { key: "full_name".into(), value: name.into() }).unwrap();
            s.put_data_point(id, &DataPoint { key: "email".into(), value: format!("{id}@x.test") }).unwrap();
        }
        // Give the doomed profile a saved form with a version + blob, so the cascade is exercised.
        s.create_instance(&FormInstance { id: "inst1".into(), profile_id: "gone".into(), entry_id: "e".into() }, 100).unwrap();
        s.add_version_blob("inst1", 1, b"pdf-bytes").unwrap();

        let removed = s.delete_profile("gone").unwrap();
        assert_eq!(removed, 2, "both of the deleted profile's data points should be gone");

        // The deleted profile and all its rows are gone.
        assert!(!s.list_profiles().unwrap().iter().any(|p| p.id == "gone"));
        assert!(s.vault("gone").unwrap().is_empty());
        assert!(s.list_instances("gone").unwrap().is_empty());
        assert!(s.version_blob("inst1", 1).is_err(), "the form blob must be erased too");

        // The OTHER profile is completely untouched.
        assert!(s.list_profiles().unwrap().iter().any(|p| p.id == "keep"));
        let kept = s.vault("keep").unwrap();
        assert_eq!(kept.len(), 2);
        assert_eq!(kept.get("full_name").unwrap(), "Keeper");
    }

    #[test]
    fn profile_field_counts_reports_per_profile_totals() {
        let s = Store::open(":memory:", generate_key()).unwrap();
        s.put_profile(&Profile { id: "full".into(), name: "Full".into() }).unwrap();
        s.put_profile(&Profile { id: "empty".into(), name: "Empty".into() }).unwrap();
        for k in ["first_name", "last_name", "email"] {
            s.put_data_point("full", &DataPoint { key: k.into(), value: "x".into() }).unwrap();
        }
        let counts = s.profile_field_counts().unwrap();
        assert_eq!(counts.get("full").copied().unwrap_or(0), 3);
        // A profile with no data points has no row in the GROUP BY result (treated as 0).
        assert_eq!(counts.get("empty").copied().unwrap_or(0), 0);
    }

    #[test]
    fn vault_roundtrip_and_upsert() {
        let s = Store::open(":memory:", generate_key()).unwrap();
        s.put_profile(&Profile {
            id: "p1".into(),
            name: "Asha".into(),
        })
        .unwrap();
        s.put_data_point(
            "p1",
            &DataPoint {
                key: "full_name".into(),
                value: "Asha Rao".into(),
            },
        )
        .unwrap();
        s.put_data_point(
            "p1",
            &DataPoint {
                key: "full_name".into(),
                value: "Asha K. Rao".into(),
            },
        )
        .unwrap();
        let v = s.vault("p1").unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v.get("full_name").unwrap(), "Asha K. Rao");
    }

    #[test]
    fn values_are_encrypted_at_rest() {
        let s = Store::open(":memory:", generate_key()).unwrap();
        s.put_profile(&Profile {
            id: "p1".into(),
            name: "Asha".into(),
        })
        .unwrap();
        s.put_data_point(
            "p1",
            &DataPoint {
                key: "secret".into(),
                value: "TOP-SECRET-VALUE".into(),
            },
        )
        .unwrap();
        // Read the raw stored bytes and confirm the plaintext is NOT present.
        let raw: Vec<u8> = s
            .conn
            .query_row(
                "SELECT value_enc FROM data_points WHERE profile_id='p1' AND key='secret'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let needle = b"TOP-SECRET-VALUE";
        assert!(!raw.windows(needle.len()).any(|w| w == needle));
        // ...but it decrypts back correctly.
        assert_eq!(s.vault("p1").unwrap().get("secret").unwrap(), "TOP-SECRET-VALUE");
    }

    #[test]
    fn profiles_and_delete() {
        let s = Store::open(":memory:", generate_key()).unwrap();
        s.put_profile(&Profile {
            id: "b".into(),
            name: "Bhavna".into(),
        })
        .unwrap();
        s.put_profile(&Profile {
            id: "a".into(),
            name: "Asha".into(),
        })
        .unwrap();
        let ps = s.list_profiles().unwrap();
        assert_eq!(ps.len(), 2);
        assert_eq!(ps[0].name, "Asha");

        s.put_data_point(
            "a",
            &DataPoint {
                key: "phone".into(),
                value: "123".into(),
            },
        )
        .unwrap();
        assert_eq!(s.data_points("a").unwrap().len(), 1);
        s.delete_data_point("a", "phone").unwrap();
        assert_eq!(s.data_points("a").unwrap().len(), 0);
    }

    #[test]
    fn versions_are_immutable_and_encrypted() {
        let s = Store::open(":memory:", generate_key()).unwrap();
        s.put_profile(&Profile {
            id: "p1".into(),
            name: "Asha".into(),
        })
        .unwrap();
        s.create_instance(
            &FormInstance {
                id: "fi1".into(),
                profile_id: "p1".into(),
                entry_id: "sample.passport.v1".into(),
            },
            1_700_000_000,
        )
        .unwrap();

        let mut v1 = BTreeMap::new();
        v1.insert("full_name".to_string(), "Asha Rao".to_string());
        assert_eq!(s.add_version("fi1", &v1, 1_700_000_001).unwrap(), 1);

        let mut v2 = v1.clone();
        v2.insert("nationality".to_string(), "IN".to_string());
        assert_eq!(s.add_version("fi1", &v2, 1_700_000_002).unwrap(), 2);

        // both versions retained (immutable chain), oldest first
        let versions = s.list_versions("fi1").unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].version_no, 1);

        // each version decrypts to its own values
        assert_eq!(s.version_values("fi1", 1).unwrap().len(), 1);
        assert_eq!(
            s.version_values("fi1", 2).unwrap().get("nationality").unwrap(),
            "IN"
        );

        // stored values are ciphertext (plaintext absent)
        let raw: Vec<u8> = s
            .conn
            .query_row(
                "SELECT values_enc FROM form_versions WHERE instance_id='fi1' AND version_no=1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!raw.windows(8).any(|w| w == b"Asha Rao"));
    }

    #[test]
    fn brought_form_blobs_and_instance_listing() {
        let s = Store::open(":memory:", generate_key()).unwrap();
        s.put_profile(&Profile { id: "p1".into(), name: "Asha".into() }).unwrap();
        // Two brought forms for the same profile; the first accumulates two versions.
        s.create_instance(&FormInstance { id: "p1:brought:visa".into(), profile_id: "p1".into(), entry_id: "Visa".into() }, 1_700_000_100).unwrap();
        s.create_instance(&FormInstance { id: "p1:brought:kyc".into(), profile_id: "p1".into(), entry_id: "KYC".into() }, 1_700_000_200).unwrap();

        let meta = BTreeMap::from([("name".to_string(), "Visa".to_string())]);
        let v1 = s.add_version("p1:brought:visa", &meta, 1_700_000_101).unwrap();
        s.add_version_blob("p1:brought:visa", v1, b"%PDF-1.7 filled-bytes").unwrap();
        let v2 = s.add_version("p1:brought:visa", &meta, 1_700_000_102).unwrap();
        s.add_version_blob("p1:brought:visa", v2, b"%PDF-1.7 newer").unwrap();

        // Blob round-trips and is sealed at rest (plaintext absent).
        assert_eq!(s.version_blob("p1:brought:visa", v2).unwrap(), b"%PDF-1.7 newer");
        let raw: Vec<u8> = s.conn.query_row(
            "SELECT blob_enc FROM form_blobs WHERE instance_id='p1:brought:visa' AND version_no=2",
            [], |r| r.get(0),
        ).unwrap();
        assert!(!raw.windows(5).any(|w| w == b"newer"));

        // Instances list newest-created first, scoped to the profile.
        let inst = s.list_instances("p1").unwrap();
        assert_eq!(inst.len(), 2);
        assert_eq!(inst[0].id, "p1:brought:kyc"); // created later → first
        assert!(s.list_instances("p2").unwrap().is_empty());
    }

    #[test]
    fn signatures_roundtrip() {
        let s = Store::open(":memory:", generate_key()).unwrap();
        s.add_signature(
            "fi1",
            &SignatureRecord {
                version_no: 1,
                signer_public: "aabb".into(),
                signature: "ccdd".into(),
                alg: "ed25519".into(),
                created_at: 42,
            },
        )
        .unwrap();
        let sigs = s.list_signatures("fi1").unwrap();
        assert_eq!(sigs.len(), 1);
        assert_eq!(sigs[0].alg, "ed25519");
        assert_eq!(sigs[0].signer_public, "aabb");
    }

    #[test]
    fn history_event_counters() {
        let s = Store::open(":memory:", generate_key()).unwrap();
        s.record_event("fi1", "save", 1).unwrap();
        s.record_event("fi1", "save", 2).unwrap();
        s.record_event("fi1", "print", 3).unwrap();
        assert_eq!(s.event_count("fi1", "save").unwrap(), 2);
        assert_eq!(s.event_count("fi1", "print").unwrap(), 1);
        assert_eq!(s.event_count("fi1", "submit").unwrap(), 0);
    }

    #[test]
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-store");
    }
}
