// Turning a form LABEL into a stable vault KEY, for capturing new information the user typed
// onto a form into their vault.
//
// This used to live as a private helper inside apps/app/src/App.tsx and was ASCII-only:
//   label.toLowerCase().replace(/[^a-z0-9]+/g, "_")
// Every non-Latin label therefore collapsed to an EMPTY key and the captured pair was silently
// dropped — so new key/value capture could never work on a Hindi, Tamil, Telugu, Chinese, Arabic
// or Russian form. For a product whose whole premise is any-language forms, that is the one place
// it must not be ASCII-only. (Found 2026-07-23 by end-to-end testing.)
//
// Now shared, Unicode-aware, and tested. Keys keep their own script: पूरा_नाम, 全名, full_name.

/**
 * A form label ("Date of expiry", "पूरा नाम", "全名 (Full Name)") -> a stable vault key.
 *
 * - Parenthesised asides are dropped: "Name (as in passport)" -> "name".
 * - Letters and digits of ANY script are kept; everything else becomes a separator.
 * - Case is folded where the script has case; scripts without case are unaffected.
 * - Returns "" for a label with no letters or digits at all, so callers can skip it.
 */
export function keyFromLabel(label) {
  return String(label ?? "")
    .replace(/\([^)]*\)/g, " ")   // drop "(as shown in passport)" style asides
    .toLowerCase()
    // \p{M} (combining marks) is essential, not optional: Devanagari vowel signs, Tamil/Telugu
    // matras, Arabic diacritics and Thai tone marks are Marks, NOT Letters. Omitting it turns
    // "पूरा" into "प_र" — a mangled key that also breaks matching on the next visit.
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");         // slice(60) may have left a trailing separator
}

/**
 * Is this label worth capturing as a vault key at all?
 * Rejects labels that yield no key, and pure-digit keys ("1", "2") which are row numbers or
 * question numbers rather than field names.
 */
export function isCapturableLabel(label) {
  const k = keyFromLabel(label);
  return k.length > 0 && !/^[\p{N}_]+$/u.test(k);
}
