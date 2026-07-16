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
                 PRIMARY KEY(profile_id, key),
                 FOREIGN KEY(profile_id) REFERENCES profiles(id)
             );",
        )?;
        Ok(())
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

    /// Insert or update a DataPoint for a Profile. The value is **sealed** before storage.
    pub fn put_data_point(&self, profile_id: &str, dp: &DataPoint) -> Result<()> {
        let sealed = seal(&self.key, dp.value.as_bytes());
        self.conn.execute(
            "INSERT INTO data_points(profile_id, key, value_enc) VALUES(?1, ?2, ?3)
             ON CONFLICT(profile_id, key) DO UPDATE SET value_enc = excluded.value_enc",
            params![profile_id, dp.key, sealed],
        )?;
        Ok(())
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
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-store");
    }
}
