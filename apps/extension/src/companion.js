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

/**
 * Reconcile two vaults by LAST-WRITE-WINS per field so both converge with nothing lost.
 * Each side is `{ key: { value, updated_at } }` (updated_at = epoch secs; missing → 0).
 * Returns the writes each side must apply:
 *   - `toLocal`  : `{ key: { value, updated_at } }` the extension applies to its own vault
 *   - `toRemote` : `{ key: { value, updated_at } }` the extension pushes to the desktop vault
 *
 * Per key: present on one side → copy to the other; present on both → the greater `updated_at`
 * wins; on an exact timestamp tie with differing values, the remote (desktop) value wins so the
 * result is deterministic. A side that already holds the winning value gets no write.
 */
export function reconcileVaults(local, remote) {
  local = local || {};
  remote = remote || {};
  const toLocal = {};
  const toRemote = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    const L = local[k];
    const R = remote[k];
    const lt = (L && L.updated_at) || 0;
    const rt = (R && R.updated_at) || 0;
    if (L && !R) {
      toRemote[k] = { value: L.value, updated_at: lt };
    } else if (R && !L) {
      toLocal[k] = { value: R.value, updated_at: rt };
    } else if (L && R) {
      if (lt > rt) {
        toRemote[k] = { value: L.value, updated_at: lt };
      } else if (rt > lt) {
        if (R.value !== L.value) toLocal[k] = { value: R.value, updated_at: rt };
      } else if (L.value !== R.value) {
        toLocal[k] = { value: R.value, updated_at: rt }; // deterministic tie-break: remote wins
      }
    }
  }
  return { toLocal, toRemote };
}
