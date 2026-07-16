//! `core-store` — on-device store: per-Profile vault (Profiles + DataPoints).
//!
//! Phase 1 uses bundled SQLite. Production swaps to **SQLCipher** (encryption at
//! rest) via the `bundled-sqlcipher` feature, keyed from the OS keystore
//! (`core-crypto`). No user data ever leaves the device.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A person/role whose data lives on-device. Everything personal hangs off a Profile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Profile {
    /// Stable id.
    pub id: String,
    /// Display name.
    pub name: String,
}

/// A reusable `key -> value` a Profile holds (e.g. `full_name`, `date_of_birth`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DataPoint {
    /// Canonical key (matches catalog field-map ontology keys).
    pub key: String,
    /// The user's value.
    pub value: String,
}

/// On-device store handle.
pub struct Store {
    conn: Connection,
}

impl Store {
    /// Open a store at `path` (use `":memory:"` for tests) and run migrations.
    pub fn open(path: &str) -> rusqlite::Result<Self> {
        let s = Self {
            conn: Connection::open(path)?,
        };
        s.migrate()?;
        Ok(s)
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS profiles(
                 id   TEXT PRIMARY KEY,
                 name TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS data_points(
                 profile_id TEXT NOT NULL,
                 key        TEXT NOT NULL,
                 value      TEXT NOT NULL,
                 PRIMARY KEY(profile_id, key),
                 FOREIGN KEY(profile_id) REFERENCES profiles(id)
             );",
        )
    }

    /// Insert or update a Profile.
    pub fn put_profile(&self, p: &Profile) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO profiles(id, name) VALUES(?1, ?2)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![p.id, p.name],
        )?;
        Ok(())
    }

    /// Insert or update a DataPoint for a Profile.
    pub fn put_data_point(&self, profile_id: &str, dp: &DataPoint) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO data_points(profile_id, key, value) VALUES(?1, ?2, ?3)
             ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value",
            params![profile_id, dp.key, dp.value],
        )?;
        Ok(())
    }

    /// All Profiles, ordered by name.
    pub fn list_profiles(&self) -> rusqlite::Result<Vec<Profile>> {
        let mut stmt = self.conn.prepare("SELECT id, name FROM profiles ORDER BY name")?;
        let rows = stmt.query_map([], |r| {
            Ok(Profile {
                id: r.get(0)?,
                name: r.get(1)?,
            })
        })?;
        rows.collect()
    }

    /// All DataPoints for a Profile, ordered by key.
    pub fn data_points(&self, profile_id: &str) -> rusqlite::Result<Vec<DataPoint>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value FROM data_points WHERE profile_id = ?1 ORDER BY key")?;
        let rows = stmt.query_map(params![profile_id], |r| {
            Ok(DataPoint {
                key: r.get(0)?,
                value: r.get(1)?,
            })
        })?;
        rows.collect()
    }

    /// Delete a DataPoint by key.
    pub fn delete_data_point(&self, profile_id: &str, key: &str) -> rusqlite::Result<()> {
        self.conn.execute(
            "DELETE FROM data_points WHERE profile_id = ?1 AND key = ?2",
            params![profile_id, key],
        )?;
        Ok(())
    }

    /// The whole vault for a Profile as `key -> value`.
    pub fn vault(&self, profile_id: &str) -> rusqlite::Result<BTreeMap<String, String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value FROM data_points WHERE profile_id = ?1")?;
        let rows = stmt.query_map(params![profile_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut map = BTreeMap::new();
        for r in rows {
            let (k, v) = r?;
            map.insert(k, v);
        }
        Ok(map)
    }
}

/// Returns this crate's stable module name.
pub fn module_name() -> &'static str {
    "core-store"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_roundtrip_and_upsert() {
        let s = Store::open(":memory:").unwrap();
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
                key: "date_of_birth".into(),
                value: "1990-01-01".into(),
            },
        )
        .unwrap();
        // upsert overwrites the existing key
        s.put_data_point(
            "p1",
            &DataPoint {
                key: "full_name".into(),
                value: "Asha K. Rao".into(),
            },
        )
        .unwrap();

        let v = s.vault("p1").unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v.get("full_name").unwrap(), "Asha K. Rao");
        assert_eq!(v.get("date_of_birth").unwrap(), "1990-01-01");
    }

    #[test]
    fn profiles_and_delete() {
        let s = Store::open(":memory:").unwrap();
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
        assert_eq!(ps[0].name, "Asha"); // ordered by name

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
