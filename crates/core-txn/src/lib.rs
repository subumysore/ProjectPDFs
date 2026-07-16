//! `core-txn` — multi-party document orchestration (Seller/Buyer, Plaintiff/Defendant…).
//!
//! One document is assembled from several Profiles: each party consents + shares
//! data, then each provides their **own non-delegable signature**. Editing content
//! after any signature invalidates prior signatures (re-sign required). All of this
//! happens on-device; joint content moves only via user-directed E2E bundles.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use serde::{Deserialize, Serialize};

/// Lifecycle state of a multi-party document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TxnState {
    /// Roles defined, not yet inviting.
    Draft,
    /// Inviting parties, collecting consent + data.
    Gathering,
    /// All party data present; document assembled.
    Assembled,
    /// Out for signature.
    Circulating,
    /// Some but not all required parties have signed.
    PartiallySigned,
    /// All required signatures present.
    FullyExecuted,
    /// A party asked for changes; signatures cleared, back to assembly.
    ChangesRequested,
    /// Cancelled.
    Withdrawn,
}

/// A participant in the document: a role played by a Profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Party {
    /// Role name (Seller, Buyer, Plaintiff, Witness…).
    pub role: String,
    /// The Profile acting in this role.
    pub profile_id: String,
    /// Whether this party consented to appear in this joint document.
    pub consented: bool,
    /// Whether this party has signed the current assembled content.
    pub signed: bool,
}

impl Party {
    /// A fresh, un-consented, un-signed party.
    pub fn new(role: impl Into<String>, profile_id: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            profile_id: profile_id.into(),
            consented: false,
            signed: false,
        }
    }
}

/// Errors from invalid workflow transitions.
#[derive(Debug, PartialEq, Eq)]
pub enum TxnError {
    /// The operation isn't allowed from the current state.
    InvalidTransition(TxnState),
    /// No party with that profile id.
    UnknownParty,
    /// Not every party has consented yet.
    NotAllConsented,
    /// A document needs at least one party.
    NoParties,
}

impl std::fmt::Display for TxnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TxnError::InvalidTransition(s) => write!(f, "invalid transition from {s:?}"),
            TxnError::UnknownParty => write!(f, "unknown party"),
            TxnError::NotAllConsented => write!(f, "not all parties have consented"),
            TxnError::NoParties => write!(f, "a document needs at least one party"),
        }
    }
}
impl std::error::Error for TxnError {}

type Result<T> = std::result::Result<T, TxnError>;

/// A multi-party document workflow instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    /// Stable id.
    pub id: String,
    /// Current lifecycle state.
    pub state: TxnState,
    /// The participating parties.
    pub parties: Vec<Party>,
}

impl Transaction {
    /// Start a new transaction in `Draft` with the given parties.
    pub fn new(id: impl Into<String>, parties: Vec<Party>) -> Result<Self> {
        if parties.is_empty() {
            return Err(TxnError::NoParties);
        }
        Ok(Self {
            id: id.into(),
            state: TxnState::Draft,
            parties,
        })
    }

    /// Every party has consented.
    pub fn all_consented(&self) -> bool {
        self.parties.iter().all(|p| p.consented)
    }
    /// Every party has signed the current content.
    pub fn all_signed(&self) -> bool {
        self.parties.iter().all(|p| p.signed)
    }

    /// Draft → Gathering (begin inviting parties).
    pub fn start_gathering(&mut self) -> Result<()> {
        self.expect(TxnState::Draft)?;
        self.state = TxnState::Gathering;
        Ok(())
    }

    /// Record a party's consent (only while Gathering).
    pub fn consent(&mut self, profile_id: &str) -> Result<()> {
        self.expect(TxnState::Gathering)?;
        self.party_mut(profile_id)?.consented = true;
        Ok(())
    }

    /// Gathering → Assembled (requires all parties consented).
    pub fn assemble(&mut self) -> Result<()> {
        self.expect(TxnState::Gathering)?;
        if !self.all_consented() {
            return Err(TxnError::NotAllConsented);
        }
        self.state = TxnState::Assembled;
        Ok(())
    }

    /// Assembled → Circulating (send for signatures).
    pub fn circulate(&mut self) -> Result<()> {
        self.expect(TxnState::Assembled)?;
        self.state = TxnState::Circulating;
        Ok(())
    }

    /// Record a party's signature (while Circulating / PartiallySigned).
    /// Transitions to `FullyExecuted` once every required party has signed.
    pub fn sign(&mut self, profile_id: &str) -> Result<()> {
        if self.state != TxnState::Circulating && self.state != TxnState::PartiallySigned {
            return Err(TxnError::InvalidTransition(self.state));
        }
        self.party_mut(profile_id)?.signed = true;
        self.state = if self.all_signed() {
            TxnState::FullyExecuted
        } else {
            TxnState::PartiallySigned
        };
        Ok(())
    }

    /// A party requests changes. **Clears all signatures** (editing invalidates them)
    /// and moves to `ChangesRequested`.
    pub fn request_changes(&mut self) -> Result<()> {
        match self.state {
            TxnState::Assembled | TxnState::Circulating | TxnState::PartiallySigned => {
                for p in &mut self.parties {
                    p.signed = false;
                }
                self.state = TxnState::ChangesRequested;
                Ok(())
            }
            other => Err(TxnError::InvalidTransition(other)),
        }
    }

    /// After edits, re-assemble (ChangesRequested → Assembled). Signatures already cleared.
    pub fn reassemble(&mut self) -> Result<()> {
        self.expect(TxnState::ChangesRequested)?;
        self.state = TxnState::Assembled;
        Ok(())
    }

    /// Withdraw (cancel) the transaction from any non-terminal state.
    pub fn withdraw(&mut self) -> Result<()> {
        match self.state {
            TxnState::FullyExecuted | TxnState::Withdrawn => {
                Err(TxnError::InvalidTransition(self.state))
            }
            _ => {
                self.state = TxnState::Withdrawn;
                Ok(())
            }
        }
    }

    fn expect(&self, s: TxnState) -> Result<()> {
        if self.state == s {
            Ok(())
        } else {
            Err(TxnError::InvalidTransition(self.state))
        }
    }
    fn party_mut(&mut self, profile_id: &str) -> Result<&mut Party> {
        self.parties
            .iter_mut()
            .find(|p| p.profile_id == profile_id)
            .ok_or(TxnError::UnknownParty)
    }
}

/// Returns this crate's stable module name.
pub fn module_name() -> &'static str {
    "core-txn"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seller_buyer() -> Transaction {
        Transaction::new(
            "deal-1",
            vec![Party::new("Seller", "p-seller"), Party::new("Buyer", "p-buyer")],
        )
        .unwrap()
    }

    #[test]
    fn happy_path_to_fully_executed() {
        let mut t = seller_buyer();
        t.start_gathering().unwrap();
        t.consent("p-seller").unwrap();
        t.consent("p-buyer").unwrap();
        t.assemble().unwrap();
        t.circulate().unwrap();
        t.sign("p-seller").unwrap();
        assert_eq!(t.state, TxnState::PartiallySigned);
        t.sign("p-buyer").unwrap();
        assert_eq!(t.state, TxnState::FullyExecuted);
    }

    #[test]
    fn cannot_assemble_without_all_consent() {
        let mut t = seller_buyer();
        t.start_gathering().unwrap();
        t.consent("p-seller").unwrap();
        assert_eq!(t.assemble(), Err(TxnError::NotAllConsented));
    }

    #[test]
    fn edit_after_signature_invalidates_signatures() {
        let mut t = seller_buyer();
        t.start_gathering().unwrap();
        t.consent("p-seller").unwrap();
        t.consent("p-buyer").unwrap();
        t.assemble().unwrap();
        t.circulate().unwrap();
        t.sign("p-seller").unwrap();
        // buyer asks for changes -> seller's signature is cleared
        t.request_changes().unwrap();
        assert_eq!(t.state, TxnState::ChangesRequested);
        assert!(t.parties.iter().all(|p| !p.signed));
        // re-assemble and everyone must sign again
        t.reassemble().unwrap();
        t.circulate().unwrap();
        t.sign("p-seller").unwrap();
        t.sign("p-buyer").unwrap();
        assert_eq!(t.state, TxnState::FullyExecuted);
    }

    #[test]
    fn invalid_transitions_and_unknown_party() {
        let mut t = seller_buyer();
        assert_eq!(t.assemble(), Err(TxnError::InvalidTransition(TxnState::Draft)));
        t.start_gathering().unwrap();
        assert_eq!(t.consent("p-nobody"), Err(TxnError::UnknownParty));
        assert!(Transaction::new("x", vec![]).is_err());
    }

    #[test]
    fn withdraw_blocks_after_execution() {
        let mut t = seller_buyer();
        t.start_gathering().unwrap();
        t.consent("p-seller").unwrap();
        t.consent("p-buyer").unwrap();
        t.assemble().unwrap();
        t.circulate().unwrap();
        t.sign("p-seller").unwrap();
        t.sign("p-buyer").unwrap();
        assert_eq!(t.withdraw(), Err(TxnError::InvalidTransition(TxnState::FullyExecuted)));
    }

    #[test]
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-txn");
    }
}
