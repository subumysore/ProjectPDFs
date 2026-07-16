//! `core-identity` — registered roles + role-scoped capabilities.
//!
//! Institutions/authorities register with a **role**; on sign-in the role is
//! asserted and it **scopes what they may do**. Crucially, **`Sign` is
//! non-delegable**: no role — not even `InstitutionAdmin` — can sign on behalf of
//! another (REQ-09). WebAuthn/OIDC authentication itself lands later.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use serde::{Deserialize, Serialize};

/// A capability a role may hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Capability {
    /// Fill a form (own or, for an admin, on behalf of a member).
    Fill,
    /// Translate a form for viewing/filling.
    Translate,
    /// Save a filled form.
    Save,
    /// Submit online.
    Submit,
    /// Share via an E2E-encrypted bundle.
    Share,
    /// **Sign a document — always for oneself; never delegable.**
    Sign,
    /// Manage member Profiles.
    ManageProfiles,
    /// Coordinate a multi-party document.
    CoordinateMultiParty,
    /// Audit on-behalf actions.
    Audit,
    /// Contribute a field-map to the catalog.
    ContributeFieldMap,
}

/// A registered role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Role {
    /// An individual acting for themselves.
    Individual,
    /// An institution admin acting on behalf of members (but never signing for them).
    InstitutionAdmin,
    /// A registrar.
    Registrar,
    /// A notary (can sign as themselves; witnesses in-person signings).
    Notary,
    /// A bank KYC officer.
    KycOfficer,
    /// A court clerk.
    CourtClerk,
    /// An escrow agent.
    EscrowAgent,
}

impl Role {
    /// The capabilities this role holds. `Sign` is present only for roles that sign
    /// **as themselves**; it is never a delegated/on-behalf capability.
    pub fn capabilities(&self) -> &'static [Capability] {
        use Capability::*;
        match self {
            Role::Individual => &[Fill, Translate, Save, Submit, Share, Sign, ContributeFieldMap],
            // Admin does everything on behalf of a member EXCEPT sign.
            Role::InstitutionAdmin => &[
                Fill,
                Translate,
                Save,
                Submit,
                Share,
                ManageProfiles,
                CoordinateMultiParty,
                Audit,
                ContributeFieldMap,
            ],
            Role::Registrar | Role::CourtClerk => &[Fill, Save, Submit, Audit],
            Role::Notary => &[Fill, Save, Sign, Audit],
            Role::KycOfficer => &[Fill, Save, Submit],
            Role::EscrowAgent => &[Fill, Save, Submit, CoordinateMultiParty, Audit],
        }
    }

    /// Whether this role holds `cap`.
    pub fn can(&self, cap: Capability) -> bool {
        self.capabilities().contains(&cap)
    }
}

/// A registered organisational identity (org metadata — never user content).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegisteredIdentity {
    /// Stable identity id (e.g. an OIDC subject).
    pub id: String,
    /// The asserted role.
    pub role: Role,
}

/// A registry of institutions/authorities and their roles (down-only, no user content).
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Registry {
    entries: Vec<RegisteredIdentity>,
}

impl Registry {
    /// A new, empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register (or re-assert) an identity's role.
    pub fn register(&mut self, id: impl Into<String>, role: Role) {
        let id = id.into();
        if let Some(e) = self.entries.iter_mut().find(|e| e.id == id) {
            e.role = role;
        } else {
            self.entries.push(RegisteredIdentity { id, role });
        }
    }

    /// The role asserted for an id, if registered.
    pub fn role_of(&self, id: &str) -> Option<Role> {
        self.entries.iter().find(|e| e.id == id).map(|e| e.role)
    }

    /// Whether a registered id may perform `cap`. Unregistered ids can do nothing.
    pub fn can(&self, id: &str, cap: Capability) -> bool {
        self.role_of(id).map(|r| r.can(cap)).unwrap_or(false)
    }
}

/// Returns this crate's stable module name.
pub fn module_name() -> &'static str {
    "core-identity"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_is_non_delegable_for_admin() {
        // The core rule: an institution admin can do a member's tasks but NOT sign.
        assert!(!Role::InstitutionAdmin.can(Capability::Sign));
        assert!(Role::InstitutionAdmin.can(Capability::Fill));
        assert!(Role::InstitutionAdmin.can(Capability::CoordinateMultiParty));
        // An individual signs for themselves.
        assert!(Role::Individual.can(Capability::Sign));
    }

    #[test]
    fn registry_asserts_role_and_scopes_capabilities() {
        let mut reg = Registry::new();
        reg.register("did:admin:1", Role::InstitutionAdmin);
        reg.register("did:notary:1", Role::Notary);

        assert_eq!(reg.role_of("did:admin:1"), Some(Role::InstitutionAdmin));
        assert!(reg.can("did:admin:1", Capability::ManageProfiles));
        assert!(!reg.can("did:admin:1", Capability::Sign));
        assert!(reg.can("did:notary:1", Capability::Sign));
        // unregistered id can do nothing
        assert!(!reg.can("did:unknown", Capability::Fill));
    }

    #[test]
    fn re_register_updates_role() {
        let mut reg = Registry::new();
        reg.register("x", Role::KycOfficer);
        reg.register("x", Role::Registrar);
        assert_eq!(reg.role_of("x"), Some(Role::Registrar));
    }

    #[test]
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-identity");
    }
}
