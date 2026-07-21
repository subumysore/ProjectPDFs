// Repeatable NAMED record GROUPS (shared engine — extension + desktop). The vault holds a flat
// identity PLUS a list of records, each a named group of fields: credit cards, extra addresses,
// passports, and PROFILES (other people the user fills for). At fill time the user picks WHICH
// record; its fields are merged over the base vault so the resolver fills from the chosen one.
//
// Record shape:  { type: "card"|"profile"|"address"|…, id, label, primary?, fields: {…} }
// Vault shape:   { …flat identity…, records: [ …records… ] }

/** All records of a given type (e.g. "card"), primary first then by label. */
export function listRecords(vault, type) {
  const all = (vault && Array.isArray(vault.records) ? vault.records : []).filter((r) => r && r.type === type);
  return all.slice().sort((a, b) => (b.primary === true) - (a.primary === true) || String(a.label || "").localeCompare(String(b.label || "")));
}

/** Pick a record by id; fall back to the primary/first of that type. Returns null if none. */
export function pickRecord(vault, type, id) {
  const list = listRecords(vault, type);
  if (!list.length) return null;
  return (id != null && list.find((r) => r.id === id)) || list.find((r) => r.primary) || list[0];
}

/** Merge a chosen record's fields OVER the base vault, so the resolver fills from that record. */
export function recordVault(baseVault, record) {
  const base = { ...(baseVault || {}) };
  delete base.records;
  return record && record.fields ? { ...base, ...record.fields } : base;
}

/** Mask a card number for display — never show the full PAN in the UI (•••• 1234). */
export function maskCard(number) {
  const d = String(number || "").replace(/\D/g, "");
  return d ? "•••• " + d.slice(-4) : "";
}

/** Whether storing this record is safe as-is; flags CVV (should be optional / off by default). */
export function cardSecurityNotes(record) {
  const notes = [];
  if (record && record.fields && (record.fields.cc_csc || record.fields.cvv)) notes.push("CVV stored — PCI discourages this; keep it optional/off by default.");
  return notes;
}
