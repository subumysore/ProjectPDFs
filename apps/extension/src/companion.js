// Pure helpers for the AUTOMATIC single-vault behavior.
//
// There is no user-facing "companion mode" toggle: whenever the desktop app's companion
// bridge is reachable, the desktop's encrypted vault is THE one source of truth, and the
// extension reads/writes it. When the desktop isn't installed/running, the extension
// transparently falls back to its own local vault. The goal is zero configuration.

/** Use the desktop vault iff the companion host answered a ping. */
export function shouldUseDesktopVault(ping) {
  return !!(ping && ping.ok);
}

/**
 * On the first successful connect, move any data already in the extension's LOCAL vault
 * into the desktop vault so nothing is lost and there is exactly ONE vault afterwards.
 *
 * Order-independent: whichever app created data first, the result is a single unified vault.
 * It is a SAFE UNION — a local field is pushed up only when the desktop vault has no value
 * for that key yet, so pre-existing desktop data is never clobbered. (Either app can be
 * started first: desktop-first → nothing to push; extension-first → the local data seeds
 * the desktop vault.)
 *
 * Returns the list of `{ key, value }` to upsert, or `[]` when migration must not run:
 * already migrated, the local vault is locked (defer to a later unlock), or nothing to move.
 */
export function migrationPlan(localVault, desktopVault, state) {
  if (!state || state.migrated || !state.unlocked) return [];
  const local = localVault || {};
  const desk = desktopVault || {};
  return Object.keys(local)
    .filter((k) => desk[k] === undefined || desk[k] === "")
    .map((key) => ({ key, value: local[key] }));
}
