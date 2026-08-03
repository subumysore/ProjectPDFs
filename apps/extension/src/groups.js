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

/** Detect the card BRAND from its number (IIN/BIN prefix) — for showing the right logo.
 *  Returns "visa" | "mastercard" | "amex" | "discover" | "diners" | "jcb" | "unionpay" | "rupay" | "". */
export function detectCardBrand(number) {
  const n = String(number || "").replace(/\D/g, "");
  if (!n) return "";
  if (/^4/.test(n)) return "visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return "mastercard";
  if (/^3[47]/.test(n)) return "amex";
  if (/^(6011|65|64[4-9]|622)/.test(n)) return "discover";
  if (/^(30[0-5]|3[68]|39)/.test(n)) return "diners";
  if (/^35(2[89]|[3-8]\d)/.test(n)) return "jcb";
  if (/^62/.test(n)) return "unionpay";
  if (/^(60|65|81|82|508)/.test(n)) return "rupay";
  return "";
}

/** Human label for a card sub-type value (credit/debit/cash/prepaid) — evident on the card row. */
export function cardTypeLabel(t) {
  const s = String(t || "").toLowerCase();
  if (s.includes("debit")) return "Debit";
  if (s.includes("credit")) return "Credit";
  if (s.includes("cash")) return "Cash";
  if (s.includes("prepaid")) return "Prepaid";
  return t ? String(t) : "";
}

/** Whether storing this record is safe as-is; flags CVV (should be optional / off by default). */
export function cardSecurityNotes(record) {
  const notes = [];
  if (record && record.fields && (record.fields.card_cvv || record.fields.cc_csc || record.fields.cvv)) notes.push("CVV stored — PCI discourages this; keep it optional/off by default.");
  return notes;
}
