import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { check as checkUpdate } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { extractFromImage, documentImageKey, type ExtractedField } from "./ocr";
import { downloadBytes, fillAndExport, fillXfaByWidgets, generateFlatSamplePdf, imageToPdf, makeFillableAndFill, renderFirstPage, listReviewFields, listWidgetReviewFields, applyReviewEdits, type ReviewField } from "./pdf";
import { fillOfficeForm, officeToPdf } from "./office";
import type { OfficeKind } from "./office";
import { detectFields } from "./detect";
import { translateText } from "./translate";
import { parseAamva } from "@engine/parse.js";
import { SignPad, type Stamp } from "./SignPad";
import { FormView } from "./FormView";
// SHARED registry — the desktop offers EVERY language the engine supports (not a fixed 8),
// so the universal on-device translation is actually reachable from the UI.
import { allLangs, langName } from "@engine/langcodes.js";
import { keyFromLabel } from "@engine/vaultkey.js";
import { listRecords, pickRecord, recordVault, maskCard, detectCardBrand, cardTypeLabel } from "@engine/groups.js";
import { UI_LANGS, translator, dirOf, detectUiLang } from "@engine/i18n.js";

// { iso: displayName } for every supported language.
const LANGS: Record<string, string> = Object.fromEntries(
  (allLangs() as string[]).map((c) => [c, langName(c) as string]),
);
type Lang = string;

// Reusable "glass/aero" button — raised, tactile, clearly a control (not flat text). Used on the
// form toolbar so Pen/Text/Signature/Image read as obvious buttons.
const GLASS_BTN: React.CSSProperties = {
  padding: "7px 13px",
  border: "1px solid #b7c4cc",
  borderRadius: 9,
  background: "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(232,240,242,0.9) 100%)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  color: "#22343a",
  fontWeight: 650,
  fontSize: 13.5,
  cursor: "pointer",
  boxShadow: "0 1px 3px rgba(35,55,60,0.16), inset 0 1px 0 rgba(255,255,255,0.75)",
};

// Recognisable card-brand mark (self-contained inline SVG/badges — no external images, CSP-safe).
function BrandLogo({ brand }: { brand: string }) {
  const box: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", height: 22, minWidth: 40, borderRadius: 4, fontSize: 10.5, fontWeight: 800, padding: "0 6px", color: "#fff", letterSpacing: 0.4 };
  switch (brand) {
    case "visa": return <span style={{ ...box, background: "#1a1f71", fontStyle: "italic" }} title="Visa">VISA</span>;
    case "mastercard": return (
      <span style={{ display: "inline-flex", alignItems: "center", height: 22 }} title="Mastercard">
        <svg width="40" height="22" viewBox="0 0 40 22" aria-label="Mastercard"><circle cx="16" cy="11" r="8" fill="#EB001B" /><circle cx="24" cy="11" r="8" fill="#F79E1B" fillOpacity="0.85" /></svg>
      </span>
    );
    case "amex": return <span style={{ ...box, background: "#2e77bb" }} title="American Express">AMEX</span>;
    case "discover": return <span style={{ ...box, background: "#e66a1e" }} title="Discover">DISCOVER</span>;
    case "diners": return <span style={{ ...box, background: "#0079be" }} title="Diners Club">DINERS</span>;
    case "jcb": return <span style={{ ...box, background: "#0b4ea2" }} title="JCB">JCB</span>;
    case "unionpay": return <span style={{ ...box, background: "#d10429" }} title="UnionPay">UNIONPAY</span>;
    case "rupay": return <span style={{ ...box, background: "#097969" }} title="RuPay">RuPay</span>;
    default: return <span style={{ ...box, background: "#8a949b", minWidth: 22 }} title="Card">💳</span>;
  }
}

// Stripe checkout links (SSOT: docs/business/stripe-config.json). The in-app Buy buttons open these
// with the current device id as `client_reference_id`, so the issued licence binds to THIS device
// automatically — the buyer never has to copy a device id. USD pricing in-app; regional PPP is
// applied on the website. Opening the URL sends nothing but the checkout request (no user content),
// so the privacy invariant is unaffected.
const STRIPE_LINKS: Record<string, string> = {
  pro: "https://buy.stripe.com/5kQdR9gxTd0OfAB7Ps3F600",
  duo: "https://buy.stripe.com/5kQ3cv3L70e29cd8Tw3F601",
  business: "https://buy.stripe.com/dRmdR93L70e21JL6Lo3F602",
};

// Offline entitlement (paid license OR active trial). days_left: -1 = perpetual, >=0 = dated.
type Lic = { licensed: boolean; tier: string; subject: string; reason: string; days_left: number };

interface Profile {
  id: string;
  name: string;
}
interface DataPoint {
  key: string;
  value: string;
}
interface SaveInfo {
  instance_id: string;
  version_no: number;
  saves: number;
}
interface SignInfo {
  version_no: number;
  signer_public: string;
  doc_hash: string;
}
interface SavedFormSummary {
  instance_id: string;
  name: string;
  version_no: number;
  saves: number;
  created_at: number;
  fields_filled: number;
  fields_total: number;
  signed: boolean;
}

const cardStyle: React.CSSProperties = {
  border: "1.5px solid #93c2ba",
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
};
const h2Style: React.CSSProperties = {
  fontSize: 13.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "#0b7d72",
  fontWeight: 800,
  margin: "0 0 3px",
};
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };

// Standard fields seeded (EMPTY) into every new profile, so the user just fills them in. Keys are the
// canonical ontology keys the resolver recognises, so once filled they auto-populate forms. signature and
// profile_photo are IMAGE fields (attach a picture, not type a value).
const DEFAULT_PROFILE_KEYS = [
  "first_name", "middle_name", "last_name", "email",
  "address_1", "address_2", "address_3", "city", "state", "county", "zip",
  "cell_phone", "home_phone", "signature", "profile_photo",
];
// A vault key that holds an IMAGE (attach/replace a picture) rather than a typed value.
const isImageKey = (k: string) => /signature|photo|driver_license|passport|document_image/i.test(k);
// Friendly display names for the standard keys, so a row reads clearly (Signature vs Profile picture are
// unmistakable) while the underlying ontology key still shows small beneath it.
const KEY_LABELS: Record<string, string> = {
  first_name: "First name", middle_name: "Middle name", last_name: "Last name", email: "Email",
  address_1: "Address line 1", address_2: "Address line 2", address_3: "Address line 3",
  city: "City", state: "State", county: "County", zip: "ZIP",
  cell_phone: "Cell phone", home_phone: "Land line", signature: "Signature", profile_photo: "Profile picture",
};

/**
 * PolyglotFormFill — Phase-1 shell. All on-device: Profiles + encrypted DataPoints in
 * the SQLite vault (core-store), catalog search + field-maps (core-catalog).
 * Pick a profile, find a form, and autofill it from that profile's vault.
 */
export function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [points, setPoints] = useState<DataPoint[]>([]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [replaceKey, setReplaceKey] = useState<string | null>(null); // which image row is showing Scan/File choice
  const [cardsOpen, setCardsOpen] = useState(false); // Saved cards section expanded? (collapsed by default)
  const [newProfile, setNewProfile] = useState("");
  // Two-step delete: null = idle, or the id of the profile whose removal is being confirmed inline.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletePass, setDeletePass] = useState("");
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const [savedForms, setSavedForms] = useState<SavedFormSummary[]>([]);
  const [savedMsg, setSavedMsg] = useState("");
  const [guideUrl, setGuideUrl] = useState<string | null>(null);
  const [guideMsg, setGuideMsg] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [signing, setSigning] = useState(false);
  const [reviewFields, setReviewFields] = useState<ReviewField[]>([]);
  const [reviewEdits, setReviewEdits] = useState<Record<string, string>>({});
  // Printed caption per form-field NAME (from the XFA widget fill). Lets us turn an answer on a form
  // whose field names are meaningless (form1[0].#subform…) into a sensible vault key.
  const [fieldCaptions, setFieldCaptions] = useState<Record<string, string>>({});
  // "Add a saved card / address" mini-form state (grouped records).
  const [recLabel, setRecLabel] = useState("");
  const [recFields, setRecFields] = useState<Record<string, string>>({});
  const [reviewName, setReviewName] = useState("");
  const [viewLang, setViewLang] = useState<Record<string, string>>({});
  const [viewVals, setViewVals] = useState<Record<string, string>>({});
  const [transStatus, setTransStatus] = useState("");
  // "New information found" review: which proposed pairs the user unticked, and the outcome message.
  const [skipNew, setSkipNew] = useState<Record<string, boolean>>({});
  const [learnMsg, setLearnMsg] = useState("");
  const [baseLang, setBaseLang] = useState<Lang>("en");
  // UI LANGUAGE — the language the app itself speaks, from the catalogue shared with the
  // extension and the website. Chosen on first run (pre-selected from the OS/WebView languages)
  // and remembered on this device. Separate from the FORM's language, and separate from the
  // vault: keys and values keep whatever script the user typed them in.
  const [uiLang, setUiLang] = useState<string>(
    () => localStorage.getItem("ppf.uiLang") || detectUiLang([...(navigator.languages || [navigator.language])]) || "en",
  );
  const tr = useMemo(() => translator(uiLang), [uiLang]);
  useEffect(() => {
    localStorage.setItem("ppf.uiLang", uiLang);
    document.documentElement.lang = uiLang;
    document.documentElement.dir = dirOf(uiLang); // Arabic/Hebrew/Urdu/Persian flip the whole app
  }, [uiLang]);
  const [locked, setLocked] = useState(true);
  // The app version, shown always in the header so the user knows exactly which build they're running.
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);
  const [hasPass, setHasPass] = useState(false);
  const [unlocking, setUnlocking] = useState(false); // show a live spinner while the vault decrypts
  const [pass, setPass] = useState("");
  const [lockMsg, setLockMsg] = useState("");
  const [extracted, setExtracted] = useState<ExtractedField[]>([]);
  // The source document image itself (passport / licence front / licence back) is retained
  // alongside the recognised fields — the picture is saved, not just the text — so the profile
  // can later render the actual document. Everything stays on-device (a data URL in the vault).
  const [docImage, setDocImage] = useState<{ url: string; key: string; label: string } | null>(null);
  const [saveDocImage, setSaveDocImage] = useState(true);
  const [ocrPct, setOcrPct] = useState<number | null>(null);
  const [filling, setFilling] = useState(false); // form-fill in progress → show the live spinner
  const fillingRef = useRef(false); // SYNCHRONOUS re-entry guard: block repeated Fill clicks / a load-autofill overlapping a manual fill (state is async, a ref is not)
  const [fillStatus, setFillStatus] = useState(""); // live verbal status shown next to the hourglass
  // Which labelling engine fills the form. "standard" = the shipped proximity+tooltip engine.
  // "granite" = the experimental on-device Granite-Docling VLM (RFC-0010) — lets the owner swap and
  // compare manually. Granite is beta and needs the on-device model; until present it notes + falls back.
  const [fillEngine, setFillEngine] = useState<"standard" | "granite">("standard");
  // PARKED (RFC-0010): Granite's model download works, but its on-device inference isn't producing usable
  // output yet, so the whole Granite UI is hidden and Standard is the only engine. Flip to re-enable the
  // toggle/modal/panel when milestone 2 lands — all the code below stays intact.
  const GRANITE_ENABLED = false;
  // Granite = the on-device layout VLM (RFC-0010). Milestone 1: its ~310 MB model is fetched ONCE into
  // app-data (prompted on first use), downward/inbound-only. Filling still uses Standard until the
  // on-device inference (milestone 2) lands — stated honestly to the user.
  const [graniteModal, setGraniteModal] = useState(false);
  const [graniteReady, setGraniteReady] = useState(false);
  const [graniteDL, setGraniteDL] = useState<{ on: boolean; i: number; total: number; file: string; err?: string }>({ on: false, i: 0, total: 16, file: "" });

  async function selectGranite() {
    setFillEngine("granite");
    try {
      const present = await invoke<boolean>("granite_model_present");
      setGraniteReady(present);
      if (present) setPdfMsg("Granite's model is on your device ✓. Its on-device inference is the next milestone (RFC-0010); Standard fills for now.");
      else setGraniteModal(true);
    } catch { setGraniteModal(true); }
  }
  async function downloadGranite() {
    setGraniteDL({ on: true, i: 0, total: 16, file: "starting…" });
    const un = await listen<{ file: string; index: number; total: number; done: boolean }>("granite-dl", (e) => {
      const p = e.payload;
      setGraniteDL((d) => ({ ...d, on: !p.done, i: p.index, total: p.total, file: p.file }));
      if (p.done) { setGraniteReady(true); setGraniteModal(false); setPdfMsg("Granite model downloaded to your device ✓ — on-device inference (milestone 2) is next; Standard fills for now."); }
    });
    try { await invoke("download_granite_model"); }
    catch (e) { setGraniteDL((d) => ({ ...d, on: false, err: String(e) })); }
    finally { un(); }
  }
  // Milestone 2: run Granite on a page ON-DEVICE and SHOW what it read (DocTags).
  const [gBusy, setGBusy] = useState(false);
  const [gStatus, setGStatus] = useState("");
  const [gPage, setGPage] = useState(1);
  const [gOut, setGOut] = useState<{ doctags: string; ms: number; chars: number } | null>(null);
  const [gErr, setGErr] = useState("");
  async function runGranite() {
    if (!pdfBytes) return;
    setGBusy(true); setGErr(""); setGOut(null); setGStatus("Starting…");
    try {
      const { graniteReadPage } = await import("./granite");
      const r = await graniteReadPage(pdfBytes, Math.max(0, gPage - 1), setGStatus);
      setGOut(r); setGStatus(`Done in ${(r.ms / 1000).toFixed(1)}s`);
    } catch (e) { setGErr(String((e as Error)?.message || e)); setGStatus(""); }
    finally { setGBusy(false); }
  }
  const [scanned, setScanned] = useState(false);
  const [uncheckedKeys, setUncheckedKeys] = useState<Set<string>>(new Set());
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [manualFields, setManualFields] = useState<Array<{ key: string; value: string }>>([]);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdfMsg, setPdfMsg] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Once a form is loaded, the big chooser (upload/URL/search) has done its job — collapse it so the
  // actual form rises to the top of the view instead of sitting 700px down behind the picker chrome.
  const [showPicker, setShowPicker] = useState(false);
  // Auto-collapse the "choose a form" picker once a form is loaded — otherwise its upload UI stays open
  // ABOVE the form and pushes it off-screen (this was the real cause of the tiny-form / scrolling issue).
  useEffect(() => { if (pdfBytes) setShowPicker(false); }, [pdfBytes]);
  const [formUrl, setFormUrl] = useState("");
  const [officeFilled, setOfficeFilled] = useState<{ data: Uint8Array; kind: OfficeKind } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<Array<{ title: string; url: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [companionId, setCompanionId] = useState("");
  const [companionMsg, setCompanionMsg] = useState("");
  const [submitUrl, setSubmitUrl] = useState("");
  const [submitMsg, setSubmitMsg] = useState("");
  // When a form is open the page can't scroll, so "Submit online" moves off the page flow into a
  // toggled bottom bar (nothing lives below the form → the form fills the viewport).
  const [showSubmit, setShowSubmit] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const passInputRef = useRef<HTMLInputElement | null>(null); // focus the passphrase box whenever the lock screen shows
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [err, setErr] = useState("");
  const [bkPass, setBkPass] = useState("");
  const [bkMsg, setBkMsg] = useState("");
  const [exporting, setExporting] = useState(false); // encrypted-backup export in progress (shows a spinner)
  const [deviceId, setDeviceId] = useState("");
  const [lic, setLic] = useState<Lic | null>(null);
  const [licKey, setLicKey] = useState("");
  // Desktop auto-update (ADR-0028): check our signed feed on launch; offer a one-click install.
  const [update, setUpdate] = useState<{ version: string; notes?: string } | null>(null);
  const [updating, setUpdating] = useState(false);
  const updateRef = useRef<{ downloadAndInstall: () => Promise<void> } | null>(null);
  // Step-based tabs instead of one long scrolling page.
  const [tab, setTab] = useState<"license" | "setup" | "forms" | "history" | "docs">("license");
  // Cursor lands in the passphrase box the moment the lock screen appears (autoFocus alone misses cases
  // like a relaunch/HMR where the window wasn't focused). No click needed to start typing.
  useEffect(() => { if (locked) { const t = setTimeout(() => passInputRef.current?.focus(), 60); return () => clearTimeout(t); } }, [locked]);
  // While a form is open, lock the document itself so the PAGE cannot scroll (main is viewport-height;
  // only the form's own scroll area moves). Reverts on leaving the form — general, not per-form.
  useEffect(() => {
    const lock = tab === "forms" && !!pdfBytes;
    const el = document.documentElement, bd = document.body;
    if (lock) { el.style.overflow = "hidden"; bd.style.overflow = "hidden"; bd.style.margin = "0"; }
    else { el.style.overflow = ""; bd.style.overflow = ""; bd.style.margin = ""; }
    return () => { el.style.overflow = ""; bd.style.overflow = ""; bd.style.margin = ""; };
  }, [tab, pdfBytes]);
  // Auto-lock after extended INACTIVITY. An idle unlocked session is a security + cleanup risk and keeps
  // the shared-vault bridge open to the extension; locking clears the native-host session sentinel. Any
  // real interaction resets the 15-minute timer.
  useEffect(() => {
    if (locked) return;
    const IDLE_MS = 15 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => { clearTimeout(timer); timer = setTimeout(() => { void lockNow(); }, IDLE_MS); };
    const evs: (keyof WindowEventMap)[] = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { clearTimeout(timer); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, [locked]);

  const guard = (p: Promise<unknown>) => p.catch((e) => setErr(String(e)));

  // Load per-device id once unlocked, and ensure an entitlement: ensure_trial returns the paid
  // license if present, an active trial, or — on first run — mints a 7-day device-bound trial.
  // Falls back to license_status if the (network) mint can't run, so we never crash the UI.
  useEffect(() => {
    if (locked) return;
    invoke<string>("device_id").then(setDeviceId).catch(() => {});
    invoke<Lic>("ensure_trial")
      .then(setLic)
      .catch(() => invoke<Lic>("license_status").then(setLic).catch(() => {}));
  }, [locked]);

  // Check our signed update feed once on launch (independent of unlock). Silent on failure/offline.
  useEffect(() => {
    checkUpdate()
      .then((u) => { if (u) { updateRef.current = u; setUpdate({ version: u.version, notes: (u as { body?: string }).body }); } })
      .catch(() => {});
  }, []);

  // Attach the live camera stream to the preview element when the camera turns on.
  useEffect(() => {
    if (camOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [camOn]);

  // Fetch + cache the (unbundled) guide video the first time the Docs tab is opened.
  useEffect(() => {
    if (tab === "docs" && !locked && !guideUrl) loadGuideVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, locked]);

  async function doExport() {
    if (!selected) return;
    if (bkPass.length < 8) return setBkMsg("Choose a backup passphrase (8+ characters).");
    setExporting(true);
    setBkMsg("⏳ Encrypting your vault on-device…");
    try {
      const arr = await invoke<number[]>("export_vault", { profileId: selected, passphrase: bkPass });
      const blob = new Blob([new Uint8Array(arr)], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "polyglotformfill-vault.ppfvault";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBkMsg(`Exported ${points.length} field(s), encrypted. Keep the passphrase safe.`);
    } catch (e) {
      setBkMsg("Export failed: " + String(e));
    } finally {
      setExporting(false);
    }
  }

  async function activateLicense() {
    if (!licKey.trim()) return setBkMsg("Paste your license key first.");
    try {
      const st = await invoke<Lic>(
        "set_license",
        { token: licKey.trim() },
      );
      setLic(st);
      setBkMsg(`Activated: ${st.tier} license for ${st.subject}.`);
      setLicKey("");
    } catch (e) {
      setBkMsg("Activation failed: " + String(e));
    }
  }

  // Open Stripe checkout for a tier, attaching THIS device's id as client_reference_id so the
  // issued licence binds to this device — no manual device-id entry. Opened in the default browser
  // via the existing https-validating Rust command; nothing but the checkout request leaves.
  function buyLicense(tier: "pro" | "duo" | "business") {
    const base = STRIPE_LINKS[tier];
    if (!base) return;
    const url = deviceId ? `${base}?client_reference_id=${encodeURIComponent(deviceId)}` : base;
    invoke("open_submit_url", { url }).catch((e) => setBkMsg("Could not open checkout: " + String(e)));
  }

  // Download + install the pending update (verified against the embedded updater pubkey), then relaunch.
  async function installUpdate() {
    if (!updateRef.current) return;
    setUpdating(true);
    try {
      await updateRef.current.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setErr("Update failed: " + String(e));
      setUpdating(false);
    }
  }

  async function doImport(file: File) {
    if (!selected) return;
    if (!bkPass) return setBkMsg("Enter the backup passphrase to import.");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const n = await invoke<number>("import_vault", {
        profileId: selected,
        passphrase: bkPass,
        bytes: Array.from(bytes),
      });
      setBkMsg(`Imported ${n} field(s).`);
      loadPoints(selected);
    } catch (e) {
      setBkMsg("Import failed: " + String(e));
    }
  }

  // A form label ("Date of expiry", "पूरा नाम", "全名") → a stable vault key. Now the SHARED,
  // Unicode-aware implementation: the previous local ASCII-only version collapsed every
  // non-Latin label to an empty key, so new information typed onto a Hindi/Tamil/Telugu/Chinese
  // form was silently discarded instead of being offered for capture.

  const known = useMemo(() => new Map(points.map((p) => [p.key, p.value])), [points]);

  // Repeatable NAMED record GROUPS (credit cards, extra addresses) — the shared feature the extension
  // engine (@engine/groups.js) defines. Stored as ONE JSON data point ("__records") inside the shared
  // vault, so it travels with the profile and is hidden from the flat key/value table.
  const RECORDS_KEY = "__records";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const records = useMemo<any[]>(() => {
    const r = points.find((p) => p.key === RECORDS_KEY);
    if (!r) return [];
    try { const v = JSON.parse(r.value); return Array.isArray(v) ? v : []; } catch { return []; }
  }, [points]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saveRecords = async (next: any[]) => {
    if (!selected) return;
    await guard(invoke("upsert_data_point", { profileId: selected, key: RECORDS_KEY, value: JSON.stringify(next) }));
    await loadPoints(selected);
  };
  // The vault used for FILLING: the flat identity with the PRIMARY address + card record merged OVER it,
  // so a form that asks for card/address fields fills from the chosen record. (A per-fill chooser can
  // pick a non-primary record later; today the primary of each type is used.)
  const buildVault = (): Record<string, string> => {
    let v: Record<string, string> = Object.fromEntries(points.filter((p) => p.key !== RECORDS_KEY).map((p) => [p.key, p.value]));
    // The PRIMARY card's fields (incl. its billing address) merge OVER the vault so a payment form fills
    // from it. Billing uses billing_* keys, so it never overwrites the plain mailing address.
    const card = pickRecord({ records }, "card");
    if (card) v = recordVault(v, card) as Record<string, string>;
    return v;
  };
  // A saved CARD carries the payment fields PLUS its own BILLING address (defaulted from the mailing
  // address). Keys are the exact ontology the resolver fills from (see @engine/resolver.js).
  const CARD_FIELDS: Array<{ key: string; label: string; opt?: boolean; sensitive?: boolean; billing?: boolean; wide?: boolean }> = [
    { key: "card_name", label: "Name on card", wide: true },
    { key: "card_number", label: "Card number", wide: true },
    { key: "card_expiry", label: "Expiry (MM/YY)" },
    { key: "card_cvv", label: "CVV (optional)", opt: true, sensitive: true },
    { key: "billing_address_1", label: "Billing address", billing: true, wide: true },
    { key: "billing_address_2", label: "Billing address 2", opt: true, billing: true, wide: true },
    { key: "billing_city", label: "Billing city", billing: true },
    { key: "billing_state", label: "Billing state", billing: true },
    { key: "billing_zip", label: "Billing ZIP", billing: true },
  ];
  const CARD_TYPES = ["Credit", "Debit", "Cash", "Prepaid"];
  // Billing address DEFAULTS to the profile's MAILING address (the user can override per card).
  const billingDefaults = (): Record<string, string> => ({
    card_type: "Credit",
    billing_address_1: known.get("address_1") || "",
    billing_address_2: known.get("address_2") || "",
    billing_city: known.get("city") || "",
    billing_state: known.get("state") || "",
    billing_zip: known.get("zip") || "",
  });
  const addRecord = async () => {
    const fields: Record<string, string> = {};
    for (const f of CARD_FIELDS) { const val = (recFields[f.key] || "").trim(); if (val) fields[f.key] = val; }
    fields.card_type = recFields.card_type || "Credit";
    if (!fields.card_number && !fields.card_name) { setLearnMsg("Enter at least the card number or the name on the card."); return; }
    const brand = detectCardBrand(fields.card_number || "");
    const brandName = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card";
    const id = `card_${[...JSON.stringify(fields)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)}`;
    const label = recLabel.trim() || `${brandName} ${cardTypeLabel(fields.card_type)} ${maskCard(fields.card_number)}`.replace(/\s+/g, " ").trim();
    const isFirst = listRecords({ records }, "card").length === 0;
    await saveRecords([...records.filter((r) => r.id !== id), { type: "card", id, label, primary: isFirst, fields }]);
    setRecLabel(""); setRecFields(billingDefaults());
    setLearnMsg(`Saved card “${label}”. It fills automatically when a form asks for payment details.`);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteRecord = (id: string) => saveRecords(records.filter((r: any) => r.id !== id));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makePrimary = (rec: any) => saveRecords(records.map((r: any) => r.type === rec.type ? { ...r, primary: r.id === rec.id } : r));
  // Pre-fill the "add a card" billing address from the mailing address when a profile loads — unless the
  // user is already mid-entering a card (don't clobber their typing).
  useEffect(() => {
    if (!selected) return;
    setRecFields((prev) => (prev.card_number || prev.card_name) ? prev : billingDefaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, known]);


  /**
   * Anything typed onto the form that the vault does NOT already hold (or holds differently) is
   * NEW information. It is never saved silently — we show exactly what we found and ask.
   * Stays on-device: this only ever writes to the local vault.
   */
  const newPairs = useMemo(() => {
    const out: Array<{ key: string; label: string; value: string; existing?: string }> = [];
    const seen = new Set<string>();
    for (const [name, raw] of Object.entries(reviewEdits)) {
      const value = (raw ?? "").trim();
      // Skip empties, unticked boxes and images. A ticked box ("Yes") IS worth saving when we have a
      // real question caption for it (e.g. "are_you_at_least_18_years_of_age" = Yes).
      if (!value || value === "Off" || value.startsWith("data:")) continue;
      const f = reviewFields.find((x) => x.name === name);
      const caption = fieldCaptions[name];
      // Without a real PRINTED caption, an XFA field name (form1[0].#subform…, pdf417barcode…) makes a
      // meaningless vault key — don't offer junk. Only save such a field when we have its caption.
      if (!caption && (name.includes("[") || /_\d+_|form\d|subform|pdf417/i.test(name))) continue;
      // Prefer the caption (meaningful) over the raw field name.
      const label = ((caption || f?.label || name) as string).trim();
      const key = keyFromLabel(label);
      if (!key || seen.has(key)) continue;
      if (value === "Yes" && key.length < 4) continue; // a bare "Yes" with no real question → skip
      const existing = known.get(key);
      if (existing === value) continue; // already known, unchanged
      seen.add(key);
      out.push({ key, label, value, existing });
    }
    return out;
  }, [reviewEdits, reviewFields, known, fieldCaptions]);

  async function saveNewPairs() {
    if (!selected) { setLearnMsg("Choose a profile first."); return; }
    let n = 0;
    for (const p of newPairs) {
      if (skipNew[p.key]) continue;
      try {
        await invoke("upsert_data_point", { profileId: selected, key: p.key, value: p.value });
        n++;
      } catch (e) {
        setLearnMsg(`Couldn't save “${p.label}”: ${String(e)}`);
        return;
      }
    }
    await loadPoints(selected);
    setSkipNew({});
    setLearnMsg(n ? `Saved ${n} new item(s) to your vault — they'll fill automatically next time.` : "Nothing ticked, so nothing was saved.");
  }

  const refreshProfiles = () => guard(invoke<Profile[]>("list_profiles").then((pts) => {
    setProfiles(pts);
    // Land ready-to-fill: auto-select a LONE profile, or the LAST-used one (persisted), so the user
    // doesn't have to pick every session. Only when nothing is selected yet.
    setSelected((cur) => {
      if (cur && pts.some((p) => p.id === cur)) return cur;
      const last = localStorage.getItem("ppf.lastProfile");
      const pick = pts.length === 1 ? pts[0]?.id : (last && pts.some((p) => p.id === last) ? last : null);
      if (pick) { loadPoints(pick); loadSavedForms(pick); return pick; }
      return cur;
    });
  }));
  const loadPoints = (id: string) =>
    guard(
      invoke<DataPoint[]>("list_data_points", { profileId: id }).then((pts) => {
        setPoints(pts);
        // native_language is a PROFILE field (spec: language-aware filling) — hydrate
        // the "Your language" selector from it.
        const nl = pts.find((p) => p.key === "native_language")?.value;
        if (nl && nl in LANGS) setBaseLang(nl as Lang);
      }),
    );
  useEffect(() => {
    checkLock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkLock() {
    try {
      const s = (await invoke("lock_status")) as { has_passphrase: boolean; unlocked: boolean };
      setHasPass(s.has_passphrase);
      setLocked(!s.unlocked);
      if (s.unlocked) {
        refreshProfiles();
      }
    } catch {
      /* leave locked */
    }
  }
  async function submitLock() {
    if (unlocking || !pass) return;
    setLockMsg("");
    setUnlocking(true);
    try {
      if (hasPass) await invoke("unlock", { passphrase: pass });
      else await invoke("set_passphrase", { passphrase: pass });
      setPass("");
      setLocked(false);
      refreshProfiles();
    } catch (e) {
      setLockMsg(String(e));
    } finally {
      setUnlocking(false);
    }
  }
  async function lockNow() {
    await invoke("lock_app");
    setSelected(null);
    setLocked(true);
  }

  function selectProfile(id: string) {
    setSelected(id);
    localStorage.setItem("ppf.lastProfile", id); // remembered across sessions (auto-selected next launch)
    loadPoints(id);
    loadSavedForms(id);
  }

  // Re-download the filled PDF of a saved form version (decrypted on-device).
  async function redownloadSaved(f: SavedFormSummary) {
    try {
      const buf = (await invoke("saved_form_pdf", { instanceId: f.instance_id, versionNo: f.version_no })) as ArrayBuffer;
      const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : (buf as ArrayBufferLike));
      await saveOut(bytes, `${f.name.replace(/\.[^.]+$/, "") || "form"}-filled`);
      setSavedMsg(`Re-downloaded “${f.name}” (version ${f.version_no}) to your Desktop.`);
    } catch (e) {
      setErr(String(e));
    }
  }
  // Sign the latest version of a saved form on-device (device Ed25519 key).
  async function signSaved(f: SavedFormSummary) {
    try {
      const info = await invoke<SignInfo>("sign_saved_form", { instanceId: f.instance_id });
      if (selected) await loadSavedForms(selected);
      setSavedMsg(`Signed “${f.name}” v${info.version_no} · doc ${info.doc_hash.slice(0, 12)}… (on-device Ed25519).`);
    } catch (e) {
      setErr(String(e));
    }
  }

  async function addProfile() {
    const name = newProfile.trim();
    if (!name) return;
    const id = crypto.randomUUID();
    await guard(invoke("create_profile", { id, name }));
    // Seed the standard fields EMPTY so the user just fills them in (blank values fill nothing).
    for (const key of DEFAULT_PROFILE_KEYS) {
      try { await invoke("upsert_data_point", { profileId: id, key, value: "" }); } catch { /* keep going */ }
    }
    setNewProfile("");
    await refreshProfiles();
    selectProfile(id);
  }
  async function removeProfile(id: string) {
    // Destructive and irreversible, so beyond the two-step confirm the backend also requires the
    // vault passphrase. A wrong passphrase deletes nothing and shows an inline, localized error.
    if (!deletePass.trim()) { setDeleteErr(tr("profile.removePassWrong")); return; }
    try {
      await invoke("delete_profile", { id, passphrase: deletePass });
    } catch {
      setDeleteErr(tr("profile.removePassWrong"));
      return;
    }
    setConfirmDeleteId(null);
    setDeletePass("");
    setDeleteErr(null);
    if (selected === id) { setSelected(null); setPoints([]); }
    await refreshProfiles();
  }
  function cancelDelete() {
    setConfirmDeleteId(null);
    setDeletePass("");
    setDeleteErr(null);
  }
  async function addPoint() {
    if (!selected || !k.trim()) return;
    await guard(invoke("upsert_data_point", { profileId: selected, key: k.trim(), value: v }));
    setK("");
    setV("");
    loadPoints(selected);
  }
  // Store an image (profile photo, signature, …) against a key as a sealed base64
  // data-URI — encrypted at rest like any value, entirely on-device.
  async function addImagePoint(key: string, file: File) {
    if (!selected || !key.trim()) return;
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    await guard(invoke("upsert_data_point", { profileId: selected, key: key.trim(), value: dataUrl }));
    loadPoints(selected);
  }
  async function removePoint(key: string) {
    if (!selected) return;
    await guard(invoke("delete_data_point", { profileId: selected, key }));
    loadPoints(selected);
  }
  function startEdit(dp: DataPoint) {
    setEditKey(dp.key);
    setEditVal(dp.value);
  }
  async function saveEdit() {
    if (!selected || editKey === null) return;
    await guard(invoke("upsert_data_point", { profileId: selected, key: editKey, value: editVal.trim() }));
    setEditKey(null);
    setEditVal("");
    loadPoints(selected);
  }
  // Read an ID/licence image. The BACK of a US/Canada licence is a PDF417 barcode carrying exact
  // AAMVA data — try that first (no OCR guessing); otherwise OCR the printed FRONT. All on-device.
  async function readIdBarcode(file: File): Promise<ExtractedField[]> {
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      // Vendored zxing PDF417 reader (same engine the extension uses for the back of a licence).
      const mod: any = await import("../../extension/vendor/zxing.bundle.mjs");
      const result: any = await new mod.BrowserPDF417Reader().decodeFromImageUrl(dataUrl);
      const text: string = result?.getText ? result.getText() : (result?.text ?? "");
      return text ? (parseAamva(text) as ExtractedField[]) : [];
    } catch {
      return []; // no barcode in this image → fall back to OCR
    }
  }
  async function onDataSource(file: File) {
    setExtracted([]);
    setDocImage(null);
    setScanned(false);
    setUncheckedKeys(new Set());
    setEditedValues({});
    setManualFields([]);
    setOcrPct(0);
    // Keep the source image as an on-device data URL so the picture itself can be saved too.
    const url = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    }).catch(() => "");
    try {
      // 1) PDF417 barcode (back of a licence) → exact AAMVA fields.
      let fields = await readIdBarcode(file);
      const isBarcodeBack = fields.length > 0;
      // 2) else OCR the printed side. Keep the recognised TEXT too — it lets us classify a licence
      //    BACK (class/restrictions boilerplate, no identity fields) even without a scannable barcode.
      let ocrText = "";
      if (!fields.length) { const r = await extractFromImage(file, setOcrPct, baseLang); fields = r.fields; ocrText = r.text; }
      setExtracted(fields);
      // Classify the document so the retained image gets a meaningful key (shared ontology with the
      // extension): decoded barcode = licence BACK; identity fields = FRONT; class/restriction text
      // = BACK; a passport number/marking = passport.
      if (url) {
        const { key, label } = documentImageKey(fields, { isBarcodeBack, text: ocrText });
        setDocImage({ url, key, label });
        setSaveDocImage(true);
      }
      // Only warn if we got NOTHING usable — no text fields AND no document image to retain. A
      // licence BACK (class/restriction boilerplate) yields no vault text fields but is still worth
      // keeping as its image (driver_license_back), so that path must not show a scary error.
      if (!fields.length && !url) {
        setErr("Couldn’t read that image. For a driver’s licence: the BACK (barcode) gives exact data; or take a sharper, well-lit photo of the FRONT.");
      }
    } catch (e) {
      setErr(String(e));
    }
    setOcrPct(null);
    setScanned(true);
  }
  async function saveExtracted() {
    if (!selected) return;
    for (const f of extracted) {
      if (uncheckedKeys.has(f.ontology_key)) continue; // user unticked this field — don't save it
      const value = editedValues[f.ontology_key] ?? f.value; // user may have corrected the value
      await guard(invoke("upsert_data_point", { profileId: selected, key: f.ontology_key, value }));
    }
    // Fields the user added by hand (e.g. a surname the OCR couldn't read).
    for (const m of manualFields) {
      const key = m.key.trim().toLowerCase().replace(/\s+/g, "_");
      if (key && m.value.trim()) await guard(invoke("upsert_data_point", { profileId: selected, key, value: m.value.trim() }));
    }
    // Save the document picture itself too (passport / licence front / licence back), on-device.
    if (docImage && saveDocImage) {
      await guard(invoke("upsert_data_point", { profileId: selected, key: docImage.key, value: docImage.url }));
    }
    setExtracted([]);
    setDocImage(null);
    loadPoints(selected);
  }
  // Camera capture → OCR → key/value (snap an ID/form and your profile fills itself).
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setCamOn(true);
    } catch (e) {
      setErr("Camera unavailable (grant permission?): " + String(e));
    }
  }
  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }
  async function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    stopCamera();
    if (blob) onDataSource(new File([blob], "capture.png", { type: "image/png" }));
  }
  // Open a form (PDF or image) and AUTOMATICALLY make it fillable + fill it:
  //   already has fields → fill them; no fields → OCR-detect, create, fill.
  // Everything on-device; nothing is uploaded.
  async function onOpenForm(file: File) {
    setPdfMsg("");
    setErr("");
    setOfficeFilled(null);
    if (/\.(docx?|xlsx?)$/i.test(file.name)) {
      await fillOfficeAndExport(file);
      return;
    }
    let bytes = await file.arrayBuffer();
    const isImage = /^image\//i.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
    if (isImage) {
      // A photo/scan of a form → wrap it into a PDF page on-device first.
      const wrapped = await imageToPdf(bytes, file.type);
      bytes = wrapped.buffer.slice(wrapped.byteOffset, wrapped.byteOffset + wrapped.byteLength) as ArrayBuffer;
    }
    setPdfBytes(bytes);
    if (canvasRef.current) await renderFirstPage(bytes, canvasRef.current).catch((e) => setErr(String(e)));
    await autoFillForm(bytes, isImage, file.name);
  }

  // Fill a Word/Excel form's NAMED fields (content controls / named ranges) from the
  // vault, on-device (RFC-0002 Phase A), and export the filled .docx/.xlsx.
  async function fillOfficeAndExport(file: File) {
    if (/\.(doc|xls)$/i.test(file.name)) {
      setPdfMsg("Legacy .doc/.xls (binary) aren’t supported — please save as .docx/.xlsx.");
      return;
    }
    const kind = /\.xlsx$/i.test(file.name) ? "xlsx" : "docx";
    try {
      const buf = await file.arrayBuffer();
      const vault = buildVault();
      const { created, filled, data, fields } = fillOfficeForm(buf, kind, vault);
      if (created === 0) {
        setPdfMsg(
          "Couldn’t find fillable fields in this Word/Excel file (no named fields, table labels, or “Label:” lines matched your vault keys).",
        );
        return;
      }
      setPdfBytes(null);
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      const mime =
        kind === "xlsx"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const blob = new Blob([data as unknown as BlobPart], { type: mime });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `filled.${kind}`;
      a.click();
      setOfficeFilled({ data, kind });
      const summary = fields.map((f) => `${f.name}${f.value ? " ✓" : " —"}`).join(", ");
      setPdfMsg(`Filled ${filled} of ${created} field(s) from your vault; exported filled.${kind}. (${summary}) — “Export as PDF” below to make a signable PDF.`);
    } catch (e) {
      setErr(String(e));
    }
  }

  // Export the filled Word/Excel as a content PDF on-device (RFC-0003 Tier 1).
  // Trial/license gate. Filling & exporting require an ACTIVE entitlement — a paid licence or a
  // trial that hasn't expired. `lic.licensed` is true for both (a trial is a signed 7-day token);
  // it flips false only when the trial lapses with no purchase. No free-forever tier.
  function requireEntitlement(): boolean {
    if (lic?.licensed) return true;
    const expired = (lic?.reason || "").toLowerCase().includes("expire");
    setErr(expired
      ? "Your free trial has ended. Activate a licence to keep filling forms — open the License tab to buy."
      : "Start your free trial or activate a licence (License tab) to fill forms.");
    setTab("license");
    return false;
  }

  async function exportOfficePdf() {
    if (!requireEntitlement()) return;
    if (!officeFilled) return;
    try {
      const { data, kind } = officeFilled;
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const pdf = await officeToPdf(ab, kind);
      const pab = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
      setPdfBytes(pab);
      if (canvasRef.current) await renderFirstPage(pab, canvasRef.current);
      await saveOut(pdf, "filled");
      setPdfMsg(
        `Exported a PDF from the filled ${kind} (on-device, content export). It’s previewed below and can be signed/submitted like any PDF.`,
      );
    } catch (e) {
      setErr(String(e));
    }
  }

  // Register the browser-extension companion (native-messaging host) on-device.
  async function registerCompanion() {
    setCompanionMsg("Registering…");
    try {
      const r = (await invoke("register_companion", { extensionId: companionId.trim() })) as string;
      setCompanionMsg(r);
    } catch (e) {
      setErr(String(e));
      setCompanionMsg("");
    }
  }

  // Web search to LOCATE a form. This is a user-directed egress exception: the query
  // leaves the device (device → DuckDuckGo directly, never via our servers). Results
  // are downloaded + filled on-device via the same pipeline.
  async function webSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    setErr("");
    setSearching(true);
    setSearchHits([]);
    try {
      const hits = (await invoke("web_search", { query: q })) as Array<{ title: string; url: string }>;
      setSearchHits(hits);
      if (hits.length === 0) setPdfMsg("No web results found. Try different terms, or paste a URL above.");
    } catch (e) {
      setErr(String(e));
    } finally {
      setSearching(false);
    }
  }

  // Fetch a form from the web (URL) on-device, then run the same auto pipeline.
  async function fetchFromUrl(explicitUrl?: string) {
    const url = (explicitUrl ?? formUrl).trim();
    if (!url) {
      setPdfMsg("Enter a form URL (https://…).");
      return;
    }
    setErr("");
    setOfficeFilled(null);
    setPdfMsg("Downloading the form on-device (direct from the site, nothing proxied)…");
    try {
      const buf = (await invoke("download_form", { url })) as ArrayBuffer;
      const bytes = (buf instanceof ArrayBuffer ? buf : new Uint8Array(buf as ArrayBufferLike).buffer) as ArrayBuffer;
      const head = new Uint8Array(bytes.slice(0, 4));
      const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
      let ab: ArrayBuffer = bytes;
      let wasImage = false;
      if (!isPdf) {
        const isPng = head[0] === 0x89 && head[1] === 0x50;
        const isJpg = head[0] === 0xff && head[1] === 0xd8;
        if (!isPng && !isJpg) {
          setPdfMsg("Downloaded, but it isn’t a PDF or image. Word/Excel from a URL isn’t supported yet.");
          return;
        }
        const wrapped = await imageToPdf(bytes, isPng ? "image/png" : "image/jpeg");
        ab = wrapped.buffer.slice(wrapped.byteOffset, wrapped.byteOffset + wrapped.byteLength) as ArrayBuffer;
        wasImage = true;
      }
      setPdfBytes(ab);
      if (canvasRef.current) await renderFirstPage(ab, canvasRef.current);
      const urlName = (() => {
        try { const p = new URL(url).pathname.split("/").filter(Boolean).pop(); return p || new URL(url).hostname; }
        catch { return url; }
      })();
      await autoFillForm(ab, wasImage, urlName);
    } catch (e) {
      setErr(String(e));
    }
  }

  // Load the guide video: fetched once from the asset host (app-gated, downward), verified
  // against a pinned hash, and cached on-device by the Rust side — then played from a local
  // object URL. NOT bundled in the app (ADR-0019). The written docs below always work offline.
  async function loadGuideVideo() {
    setGuideMsg("Loading the guide video (downloaded once, then cached on your device)…");
    try {
      const buf = (await invoke("guide_video")) as ArrayBuffer;
      const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : (buf as ArrayBufferLike));
      setGuideUrl(URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "video/mp4" })));
      setGuideMsg("");
    } catch {
      setGuideMsg(
        "The guide video isn’t on this device yet. Connect to the internet and reopen this tab — it downloads once (verified), then plays offline. The written guide below always works.",
      );
    }
  }

  // Load the on-device history of filled forms for the active profile.
  async function loadSavedForms(pid: string) {
    try {
      setSavedForms(await invoke<SavedFormSummary[]>("list_saved_forms", { profileId: pid }));
    } catch (e) {
      setErr(String(e));
    }
  }
  // Persist a just-filled brought form to the encrypted on-device history (versioned).
  async function persistFilled(name: string, filled: number, total: number, data: Uint8Array) {
    if (!selected) return;
    try {
      const info = await invoke<SaveInfo>("save_brought_form", {
        profileId: selected,
        name,
        fieldsFilled: filled,
        fieldsTotal: total,
        pdf: Array.from(data),
      });
      await loadSavedForms(selected);
      setSavedMsg(`Saved “${name}” to Past forms (version ${info.version_no}, on-device).`);
    } catch (e) {
      setErr(String(e));
    }
  }

  // Save a filled/signed PDF to the user's DESKTOP (on-device), falling back to a browser
  // download if that fails. Records the exact path so the UI can point the user to it.
  async function saveOut(data: Uint8Array, name: string): Promise<string | null> {
    try {
      const path = await invoke<string>("save_to_desktop", { bytes: Array.from(data), filename: name });
      setSavedPath(path);
      return path;
    } catch (e) {
      downloadBytes(data, name.toLowerCase().endsWith(".pdf") ? name : name + ".pdf");
      setErr(`Couldn’t save to your Desktop (${String(e)}) — saved to your Downloads folder instead.`);
      return null;
    }
  }

  // Load the editable review of what was filled, so the user can CHECK and CORRECT values
  // before finalizing (nothing is silently committed).
  async function loadReview(bytes: ArrayBuffer, name: string) {
    try {
      let fields = await listReviewFields(bytes);
      // Hybrid-XFA forms (USCIS N-400 &c.) parse as 0 AcroForm fields in pdf-lib but ARE fillable via
      // the pdf.js widget layer — fall back to it so the review + on-page editor still appear.
      if (fields.length === 0) fields = await listWidgetReviewFields(bytes);
      setReviewFields(fields);
      setReviewEdits({});
      setReviewName(name);
      setViewLang({});
      setViewVals({});
      setTransStatus("");
    } catch {
      setReviewFields([]);
    }
  }
  // Show the WHOLE form in the user's language — labels AND the filled values — as a READ-ONLY
  // reading aid, fully on-device. THE SAVED FILE IS NEVER TRANSLATED: export/save always writes the
  // form's ORIGINAL language. This is the etched rule (see docs/specs/language-aware-filling.md).
  async function translateReview() {
    if (baseLang === "en") { setTransStatus("This form is already in your language (English)."); return; }
    setViewLang({});
    setViewVals({});
    setTransStatus("Loading the on-device translation model (the first run can take a minute)…");
    try {
      const labels: Record<string, string> = {};
      const vals: Record<string, string> = {};
      for (const f of reviewFields) {
        if (f.label) {
          labels[f.name] = await translateText(f.label, "en", baseLang, setTransStatus);
          setViewLang({ ...labels });
        }
        // Translate the VALUE too, so the user reads the entire form in their language. Names,
        // numbers, dates and codes are left as-is — translating them would be wrong.
        const v = (reviewEdits[f.name] ?? f.value ?? "").trim();
        if (v && v !== "Off" && !/^[\d\s./:@+-]+$/.test(v) && !v.startsWith("data:")) {
          vals[f.name] = await translateText(v, "en", baseLang, setTransStatus);
          setViewVals({ ...vals });
        }
      }
      setTransStatus(
        `Whole form shown in ${LANGS[baseLang] || baseLang} — on-device. Reading aid only: the file you save stays in the form's original language.`,
      );
    } catch (e) {
      setTransStatus("Translation failed: " + String(e));
    }
  }
  // Re-apply the user's edits into the PDF, re-export, re-render, and update the saved version.
  async function applyReview() {
    if (!requireEntitlement()) return;
    if (!pdfBytes || Object.keys(reviewEdits).length === 0) return;
    try {
      const data = await applyReviewEdits(pdfBytes, reviewEdits);
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      setPdfBytes(ab);
      if (canvasRef.current) await renderFirstPage(ab, canvasRef.current);
      await saveOut(data, reviewName || "filled");
      await loadReview(ab, reviewName);
      const filled = (await listReviewFields(ab)).filter((f) => f.value && f.value !== "Off").length;
      await persistFilled(reviewName || "form", filled, reviewFields.length, data);
      setPdfMsg("Applied your edits — re-exported filled.pdf and updated the saved version (on-device).");
    } catch (e) {
      setErr(String(e));
    }
  }

  // The automatic pipeline: fill existing fields, else detect + create + fill.
  async function autoFillForm(bytes: ArrayBuffer, wasImage: boolean, formName: string) {
    if (fillingRef.current) return; // a fill is already in flight — don't overlap
    if (!requireEntitlement()) return;
    const vault = buildVault();
    fillingRef.current = true;
    setFilling(true);
    setFillStatus(wasImage ? "Scanning the document on-device…" : "Reading the form on-device…");
    try {
      // total = # AcroForm fields pdf-lib can fill. A throw (some XFA page trees are unparseable) is
      // treated as 0 so we fall through to the pdf.js widget filler.
      let existing: { total: number; filled: number; data: Uint8Array } = { total: 0, filled: 0, data: new Uint8Array(bytes) };
      try { existing = await fillAndExport(bytes, vault); } catch { /* route to XFA widget filler below */ }
      if (existing.total > 0) {
        const ab = existing.data.buffer.slice(
          existing.data.byteOffset,
          existing.data.byteOffset + existing.data.byteLength,
        ) as ArrayBuffer;
        setPdfBytes(ab);
        if (canvasRef.current) await renderFirstPage(ab, canvasRef.current);
        await saveOut(existing.data, formName || "filled");
        setPdfMsg(`This form already had ${existing.total} field(s) — filled ${existing.filled} from your vault; saved to your Desktop. Review & correct the values below before you finalize.`);
        await loadReview(ab, formName);
        await persistFilled(formName, existing.filled, existing.total, existing.data);
        return;
      }
      // Before falling back to OCR: a hybrid-XFA / LiveCycle form (USCIS N-400 &c.) reports 0 AcroForm
      // fields to pdf-lib, yet its widgets ARE present and fillable via pdf.js. Fill them by matching
      // each box to its printed caption, then flatten the values onto the page.
      if (!wasImage) {
        setPdfMsg("This is an XFA/LiveCycle form (e.g. USCIS) — filling it via its printed labels, on-device…");
        const xfa = await fillXfaByWidgets(bytes, vault);
        if (xfa.total > 0 && xfa.filled > 0) {
          setFieldCaptions(xfa.captions);
          const ab = xfa.data.buffer.slice(xfa.data.byteOffset, xfa.data.byteOffset + xfa.data.byteLength) as ArrayBuffer;
          setPdfBytes(ab);
          // FormView renders the form; don't also renderFirstPage (concurrent pdf.js render races it and
          // can wedge the preview on "Rendering the form…").
          await saveOut(xfa.data, formName || "filled");
          setPdfMsg(`Filled ${xfa.filled} of ${xfa.total} fields — editable, saved to your Desktop. Review below.`);
          await loadReview(ab, formName);
          await persistFilled(formName, xfa.filled, xfa.total, xfa.data);
          return;
        }
      }
      setPdfMsg(
        wasImage
          ? "This image has no form fields — reading it with on-device OCR…"
          : "This PDF has no form fields — detecting them with on-device OCR…",
      );
      const { fields } = await detectFields(bytes, setPdfMsg, baseLang);
      if (!fields.length) {
        setPdfMsg(
          "No fields could be detected automatically on this form.",
        );
        return;
      }
      const { created, filled, data } = await makeFillableAndFill(bytes, fields, vault);
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      setPdfBytes(ab);
      if (canvasRef.current) await renderFirstPage(ab, canvasRef.current);
      await saveOut(data, formName || "filled");
      setPdfMsg(`No form fields found — created ${created} by OCR and filled ${filled} from your vault; saved to your Desktop. Review & correct the values below before you finalize.`);
      await loadReview(ab, formName);
      await persistFilled(formName, filled, created, data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setFilling(false); fillingRef.current = false; setFillStatus("");
    }
  }
  async function fillPdf() {
    if (fillingRef.current) return; // block repeated clicks / overlap with a load-autofill already running
    // DIAGNOSTIC: capture every step to Desktop\ppf-fill-debug.txt so a webview-only failure is visible.
    const dbg: string[] = [`[fillPdf] ${new Date().toISOString()}`];
    const flush = async () => { try { await invoke("save_to_desktop", { bytes: Array.from(new TextEncoder().encode(dbg.join("\n"))), filename: "ppf-fill-debug.txt" }); } catch { /* ignore */ } };
    dbg.push(`licensed=${lic?.licensed} reason=${lic?.reason || ""}`);
    if (!requireEntitlement()) { dbg.push("BLOCKED: requireEntitlement=false → jumped to License tab"); await flush(); return; }
    if (!pdfBytes) { dbg.push("BLOCKED: no pdfBytes"); await flush(); return; }
    const vault = buildVault();
    dbg.push(`vault: ${points.length} points; keys=${Object.keys(vault).slice(0, 25).join(",")}`);
    // Granite-Docling (RFC-0010) is an experimental on-device VLM engine; the model isn't bundled yet, so
    // until it's fetched we tell the user and fall back to the Standard engine (fill still works).
    if (fillEngine === "granite") {
      dbg.push("engine=granite requested; on-device model not yet installed → falling back to standard");
      setPdfMsg("Granite (beta) needs its on-device layout model, which isn't installed yet — filled with the Standard engine for now.");
    }
    fillingRef.current = true;
    setFilling(true);
    setFillStatus("Filling from your vault, on-device…");
    try {
      let filled = 0, total = 0, data: Uint8Array | null = null;
      try {
        const r = await fillAndExport(pdfBytes, vault);
        filled = r.filled; total = r.total; data = r.data;
      } catch (fe) {
        // pdf-lib couldn't parse this form (some XFA page trees throw) — treat as 0 fields and let the
        // pdf.js widget filler handle it below.
        dbg.push(`fillAndExport threw (routing to XFA): ${String(fe)}`);
      }
      dbg.push(`fillAndExport: total=${total} filled=${filled}`);
      if (total > 0 && data) {
        await saveOut(data, "filled");
        setPdfMsg(`Filled ${filled} of ${total} existing form fields from the vault; downloaded filled.pdf.`);
        await flush();
        return;
      }
      // pdf-lib saw no fields — but a hybrid-XFA form (USCIS &c.) still fills via its pdf.js widgets.
      let xfa;
      try {
        xfa = await fillXfaByWidgets(pdfBytes, vault);
        dbg.push(`fillXfaByWidgets: total=${xfa.total} filled=${xfa.filled} dataLen=${xfa.data.byteLength}`);
      } catch (xe) {
        dbg.push(`fillXfaByWidgets THREW: ${String(xe)}`);
        await flush();
        setPdfMsg(`XFA fill error: ${String(xe).slice(0, 300)}`);
        return;
      }
      if (xfa.total > 0) {
        setFieldCaptions(xfa.captions);
        const ab = xfa.data.buffer.slice(xfa.data.byteOffset, xfa.data.byteOffset + xfa.data.byteLength) as ArrayBuffer;
        setPdfBytes(ab);
        // NOTE: do NOT call renderFirstPage here — FormView renders the form itself, and a concurrent
        // pdf.js render on the (hidden) legacy canvas races it and can leave the preview stuck on
        // "Rendering the form…". FormView mounts once loadReview populates reviewFields (below).
        if (xfa.filled > 0) await saveOut(xfa.data, "filled");
        setPdfMsg(
          xfa.filled > 0
            ? `XFA/LiveCycle form: filled ${xfa.filled} of ${xfa.total} fields from your vault (matched by each box's printed label) — stays editable. Saved to your Desktop. The name/address fields are further down the form — scroll the preview.`
            : `Detected ${xfa.total} fillable XFA fields but matched 0 to your vault. Add your name/address to the vault (top of the app), then click Fill again.`,
        );
        await loadReview(ab, reviewName || "filled");
        dbg.push(`after loadReview: reviewFields will populate from listWidgetReviewFields`);
        await flush();
        return;
      }
      dbg.push("no fields via any path (flat/scanned)");
      await flush();
      setPdfMsg("No AcroForm fields in this PDF (flat/scanned) — use “Make fillable” below to create them.");
    } catch (e) {
      dbg.push(`OUTER CATCH: ${String(e)}`);
      await flush();
      setErr(String(e));
    } finally {
      setFilling(false); fillingRef.current = false; setFillStatus("");
    }
  }
  async function genFlat() {
    setOfficeFilled(null);
    const bytes = await generateFlatSamplePdf();
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    setPdfBytes(ab);
    setPdfMsg("Loaded a FLAT sample PDF (no form fields). Pick the Passport form above, then “Make fillable & fill”.");
    if (canvasRef.current) await renderFirstPage(ab, canvasRef.current).catch((e) => setErr(String(e)));
  }
  async function detectAndFill() {
    if (!requireEntitlement()) return;
    if (!pdfBytes) {
      setPdfMsg("Open or generate a PDF first.");
      return;
    }
    try {
      setPdfMsg("Detecting fields with on-device OCR…");
      const { fields, note } = await detectFields(pdfBytes, setPdfMsg, baseLang);
      const vault = buildVault();
      const { created, filled, data } = await makeFillableAndFill(pdfBytes, fields, vault);
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      setPdfBytes(ab);
      if (canvasRef.current) await renderFirstPage(ab, canvasRef.current);
      await saveOut(data, "detected-filled");
      setPdfMsg(`${note} Created ${created}, filled ${filled} from the vault; saved to your Desktop. Review & correct the values below — anything new you type is remembered for next time.`);
      // Show the editable review so the user can check what filled and type anything the vault
      // didn't have (e.g. Nationality) — which then auto-registers as a new vault key.
      await loadReview(ab, "detected-filled");
    } catch (e) {
      setErr(String(e));
    }
  }
  const selectedName = profiles.find((p) => p.id === selected)?.name;
  // Every image saved in the vault (signature, photo, …) becomes a stamp you can place by hand.
  const stamps: Stamp[] = points
    .filter((p) => /^data:image\//i.test(p.value))
    .map((p) => ({ key: p.key, src: p.value }));

  if (locked) {
    return (
      <main
        style={{
          fontFamily: "system-ui, sans-serif",
          maxWidth: 420,
          margin: "0 auto",
          padding: "80px 24px",
          color: "#101a20",
          textAlign: "center",
        }}
      >
        {/* The language picker sits ON the unlock screen: a user must be able to read the very
            first screen they see, before they have any way into settings. */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, alignItems: "center", marginBottom: 18, fontSize: 13 }}>
          <label htmlFor="uilang-lock" style={{ color: "#55666f" }}>{tr("lang.choose")}</label>
          <select id="uilang-lock" value={uiLang} onChange={(e) => setUiLang(e.currentTarget.value)} style={{ padding: "4px 6px" }}>
            {Object.entries(UI_LANGS).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </div>
        <h1 style={{ marginBottom: 4 }}>🔒 {tr("app.name")}</h1>
        <p style={{ color: "#55666f", marginTop: 0 }}>
          {hasPass ? tr("unlock.title") : "Set a passphrase to protect your vault."}
        </p>
        <style>{`@keyframes ppfflip{0%{transform:rotate(0)}45%,55%{transform:rotate(180deg)}100%{transform:rotate(360deg)}}`}</style>
        <form onSubmit={(e) => { e.preventDefault(); submitLock(); }}>
          <input
            ref={passInputRef}
            type="password"
            autoFocus
            placeholder={hasPass ? tr("unlock.placeholder") : "Create a passphrase (min 6 chars)"}
            value={pass}
            onChange={(e) => setPass(e.currentTarget.value)}
            disabled={unlocking}
            style={{ width: "100%", padding: "10px 12px", margin: "12px 0", boxSizing: "border-box" }}
          />
          <button type="submit" disabled={unlocking || !pass} style={{ padding: "10px 16px", width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: unlocking ? "wait" : "pointer" }}>
            {unlocking
              ? <><span style={{ display: "inline-block", animation: "ppfflip 1.1s ease-in-out infinite" }}>⏳</span> {hasPass ? "Unlocking…" : "Setting up…"}</>
              : (hasPass ? tr("unlock.button") : "Set passphrase & continue")}
          </button>
        </form>
        {lockMsg && <p style={{ color: "#9a2c2c", fontSize: 13 }}>{lockMsg}</p>}
        {hasPass && (
          <p style={{ marginTop: 14 }}>
            <a
              href="#"
              style={{ color: "#9a2c2c", fontSize: 12 }}
              onClick={async (e) => {
                e.preventDefault();
                if (
                  confirm(
                    "Forgot your passphrase?\n\nResetting erases your saved vault permanently and starts fresh. This cannot be undone. Continue?",
                  )
                ) {
                  try {
                    await invoke("reset_vault");
                  } catch (err) {
                    setLockMsg(String(err));
                  }
                }
              }}
            >
              Forgotten your passphrase? Reset the vault (erases saved data)
            </a>
          </p>
        )}
        <p style={{ color: "#8a8f92", fontSize: 12, marginTop: 20 }}>
          {tr("unlock.note")}
        </p>
      </main>
    );
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        // Use the screen the user actually has: the form panel is the point of this app, and a
        // fixed 820px column wasted most of a wide display. Caps at 1600 so text lines stay readable.
        // Narrower when a form is open so the page isn't mostly empty margin around the form.
        maxWidth: (tab === "forms" && pdfBytes) ? "min(1240px, 98vw)" : "min(1600px, 96vw)",
        margin: "0 auto",
        // When a form is open, cap the app at the viewport height so the PAGE cannot scroll — only the
        // form's own scroll area does. The form area's height is computed live from its top offset to the
        // viewport bottom and recomputed by a ResizeObserver on ANY layout change (window/banners/form),
        // so it's general, not tuned per form. Nothing renders below the form (submit lives in the toolbar).
        ...((tab === "forms" && pdfBytes) ? { height: "100vh", overflow: "hidden" as const } : {}),
        // When a form is open, shrink the outer padding hard so the form gets the screen.
        padding: (tab === "forms" && pdfBytes) ? "8px 18px 8px" : "28px 20px 64px",
        color: "#101a20",
      }}
    >
      {update && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          background: "#e2f2f0", border: "1px solid #b6e0da", borderRadius: 10,
          padding: "10px 14px", marginBottom: 14, fontSize: 14,
        }}>
          <span style={{ fontWeight: 700, color: "#0a6a60" }}>Update available — v{update.version}</span>
          <span style={{ color: "#5a6b6d", flex: 1, minWidth: 160 }}>
            {updating ? "Downloading & installing… the app will restart." : "A newer version is ready. It installs in a few seconds and restarts."}
          </span>
          <button onClick={installUpdate} disabled={updating} style={{ padding: "7px 14px" }}>
            {updating ? tr("update.installing") : tr("update.now")}
          </button>
          {!updating && <button onClick={() => setUpdate(null)} style={{ padding: "7px 10px", background: "transparent", color: "#5a6b6d", border: "1px solid #cfe9e5" }}>{tr("update.later")}</button>}
        </div>
      )}
      {signing && pdfBytes && (
        <SignPad
          pdfBytes={pdfBytes}
          stamps={stamps}
          onClose={() => setSigning(false)}
          onExport={async (bytes) => {
            await saveOut(bytes, `${reviewName || "form"}-signed`);
            const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            setPdfBytes(ab);
            if (canvasRef.current) renderFirstPage(ab, canvasRef.current).catch(() => {});
            setPdfMsg("Signed / annotated — flattened into the PDF and saved to your Desktop.");
            setSigning(false);
          }}
        />
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        {!(tab === "forms" && pdfBytes) && <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.15 }}>PolyglotFormFill</h1>}
        {/* Always-visible version badge — so the user can tell which build they're testing. */}
        <span
          title="Installed app version"
          style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#55666f", background: "#eef2f4", border: "1px solid #d7e0e3", borderRadius: 999, padding: "2px 9px", letterSpacing: 0.2, alignSelf: "center" }}
        >
          v{appVersion || "…"}
        </span>
        <button onClick={lockNow} style={{ fontSize: 12, marginLeft: 8 }}>
          🔒 {tr("lock.button")}
        </button>
      </div>
      {!(tab === "forms" && pdfBytes) && (
        <p style={{ color: "#55666f", margin: "1px 0 7px", fontSize: 12.5 }}>
          {tr("privacy.body")}
        </p>
      )}
      {!(tab === "forms" && pdfBytes) && (
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 8px", fontSize: 13 }}>
        <label htmlFor="uilang" style={{ color: "#55666f" }}>{tr("lang.ui")}:</label>
        <select id="uilang" value={uiLang} onChange={(e) => setUiLang(e.currentTarget.value)} style={{ padding: "4px 6px" }}>
          {Object.entries(UI_LANGS).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
        <span style={{ color: "#8a8f92" }}>{tr("lang.hint")}</span>
        <label htmlFor="baselang" style={{ color: "#55666f", marginLeft: 12 }}>{tr("lang.fill")}:</label>
        <select
          id="baselang"
          value={baseLang}
          onChange={(e) => {
            const lang = e.currentTarget.value as Lang;
            setBaseLang(lang);
            // Persist as a profile field so it travels with the vault (and the extension).
            if (selected) void invoke("upsert_data_point", { profileId: selected, key: "native_language", value: lang }).catch(() => {});
          }}
          style={{ padding: "4px 6px" }}
        >
          {Object.entries(LANGS).map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <span style={{ color: "#8a8f92", fontSize: 12 }}>
          {tr("lang.fillHint")}
        </span>
      </div>
      )}
      {err && (
        <p style={{ color: "#9a2c2c", cursor: "pointer" }} onClick={() => setErr("")}>
          {err} (click to dismiss)
        </p>
      )}
      {savedPath && !(tab === "forms" && pdfBytes) && (
        <p
          style={{ background: "#e2f2f0", color: "#0a6a60", borderRadius: 8, padding: "8px 10px", fontSize: 13, cursor: "pointer", margin: "6px 0" }}
          title="Click to dismiss"
          onClick={() => setSavedPath("")}
        >
          📄 Saved to your Desktop as <b style={mono}>{savedPath.split(/[\\/]/).pop()}</b>
        </p>
      )}

      <nav style={{ display: "flex", gap: 4, margin: "0 0 6px", padding: "10px 0 0", borderBottom: "2px solid #e6eeec", flexWrap: "wrap", position: "sticky", top: 0, background: "#fff", zIndex: 10 }}>
        {([["license", "1 · " + tr("tab.license")], ["setup", "2 · " + tr("tab.profile")], ["forms", "3 · " + tr("tab.forms")], ["history", "4 · " + tr("tab.past")], ["docs", "5 · " + tr("tab.docs")]] as const).map(([id, label]) => {
          const locked = (id === "forms" || id === "history") && !selected;
          return (
            <button key={id} onClick={() => !locked && setTab(id)} disabled={locked}
              style={{
                padding: "10px 18px",
                border: tab === id ? "1px solid #0b7d72" : "1px solid #7fccc0",
                borderRadius: 11,
                // Selected = solid teal; unselected = a soft MINT tint (colourful, not grey) with teal text
                // — clearly a tab, clearly not the active one.
                background: tab === id
                  ? "linear-gradient(180deg, #14a99b 0%, #0d8f83 60%, #0b8175 100%)"
                  : "linear-gradient(180deg, #ecfbf8 0%, #d3f0eb 100%)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                color: tab === id ? "#ffffff" : "#0b6f66",
                fontWeight: tab === id ? 800 : 650,
                fontSize: 14,
                letterSpacing: 0.2,
                cursor: locked ? "not-allowed" : "pointer",
                opacity: locked ? 0.4 : 1,
                textShadow: tab === id ? "0 1px 1px rgba(0,0,0,0.18)" : "none",
                boxShadow: tab === id
                  ? "0 3px 10px rgba(13,143,131,0.42), inset 0 1px 0 rgba(255,255,255,0.35)"
                  : "0 1px 3px rgba(35,55,60,0.14), inset 0 1px 0 rgba(255,255,255,0.7)",
                transition: "background 0.14s, color 0.14s, box-shadow 0.14s, transform 0.08s",
              }}
              onMouseDown={(e) => { if (!locked) e.currentTarget.style.transform = "translateY(1px)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}>
              {label}
            </button>
          );
        })}
      </nav>
      {!selected && <p style={{ fontSize: 12, color: "#8a8f92", margin: "2px 0 10px" }}>{tr("tabs.hint")}</p>}

      {tab === "setup" && (
      <section style={cardStyle}>
        <h2 style={h2Style}>1 · Profiles — add, choose, edit or remove</h2>
        {/* Profiles strip: a horizontally-SCROLLABLE row once there are many (>5), with the delete control
            on the SAME row — a red glass button that names the selected profile. */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 0, ...(profiles.length > 5 ? { overflowX: "auto", flexWrap: "nowrap", paddingBottom: 6 } : { flexWrap: "wrap" }) }}>
            {profiles.map((p, pIdx) => {
              // A distinct, stable pastel per profile (hashed from its id) so they're easy to tell apart.
              // NO red/pink here — red is reserved exclusively for the Delete-profile button.
              const PALETTE = ["#dbeafe", "#dcfce7", "#fef3c7", "#ede9fe", "#cffafe", "#e0f2fe", "#f0f9c4", "#e2e8f0"];
              const DOT = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#0284c7", "#65a30d", "#475569"];
              // Colour by POSITION in the list, so consecutive profiles are always different (an
              // id-hash could collide and give two profiles the same colour).
              const idx = pIdx % PALETTE.length;
              const on = p.id === selected;
              return (
                <button
                  key={p.id}
                  onClick={() => selectProfile(p.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "7px 14px", borderRadius: 999,
                    border: on ? "2px solid #0d8f83" : "1px solid #cbd5db",
                    background: PALETTE[idx], color: "#152023",
                    fontWeight: on ? 700 : 500,
                    boxShadow: on ? "0 0 0 3px rgba(13,143,131,0.18)" : "none",
                    cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: DOT[idx], flexShrink: 0 }} />
                  {p.name}
                </button>
              );
            })}
            {profiles.length === 0 && <span style={{ opacity: 0.6 }}>No profiles yet.</span>}
          </div>
          {selected && (() => {
            const sel = profiles.find((p) => p.id === selected);
            if (!sel) return null;
            return (
              <button
                onClick={() => setConfirmDeleteId(selected)}
                title={`Delete the profile “${sel.name}” and its vault`}
                style={{
                  ...GLASS_BTN, flexShrink: 0, whiteSpace: "nowrap",
                  border: "1px solid #e0b4b4", color: "#8a1f1f",
                  background: "linear-gradient(180deg, rgba(255,244,244,0.96) 0%, rgba(250,224,224,0.92) 100%)",
                  boxShadow: "0 1px 3px rgba(120,30,30,0.2), inset 0 1px 0 rgba(255,255,255,0.7)",
                }}
              >
                🗑 {tr("profile.remove")} — {sel.name}
              </button>
            );
          })()}
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <input
            placeholder="New profile name (e.g. John)"
            value={newProfile}
            onChange={(e) => setNewProfile(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addProfile()}
            style={{ padding: 8, flex: 1 }}
          />
          <button onClick={addProfile}>{tr("profile.add")}</button>
        </div>

        {/* Delete confirmation (the trigger is the red button on the profiles row above). Verify with the
            passphrase, and OFFER to save an encrypted backup of the profile FIRST so it can be restored. */}
        {selected && confirmDeleteId === selected && (() => {
          const sel = profiles.find((p) => p.id === selected);
          if (!sel) return null;
          return (
            <div style={{ marginTop: 14, background: "#fbf1f1", border: "1px solid #e3c9c9", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ color: "#7a2222", fontSize: 13, marginBottom: 10 }}>
                {tr("profile.removeConfirm", { name: sel.name })}
              </div>
              {/* OPTIONAL: export an encrypted backup of this profile before deleting. */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <span style={{ fontSize: 12.5, color: "#5a4a4a" }}>Save its data first?</span>
                <input
                  type="password" value={bkPass} placeholder="Backup passphrase (8+)"
                  onChange={(e) => setBkPass(e.currentTarget.value)}
                  style={{ padding: "7px 10px", width: 210, maxWidth: "100%", border: "1.5px solid #93c2ba", borderRadius: 8 }}
                />
                <button onClick={doExport} disabled={bkPass.length < 8 || exporting}
                  style={{ ...GLASS_BTN, opacity: (bkPass.length < 8 || exporting) ? 0.55 : 1, cursor: (bkPass.length < 8 || exporting) ? "not-allowed" : "pointer" }}>
                  {exporting ? "⏳ Exporting…" : "📦 Export encrypted backup"}
                </button>
              </div>
              {bkMsg && <div style={{ fontSize: 12, color: "#0a6a60", marginBottom: 8 }}>{bkMsg}</div>}
              <div style={{ height: 1, background: "#eddede", margin: "4px 0 10px" }} />
              <div style={{ fontSize: 12.5, color: "#7a2222", marginBottom: 6 }}>Confirm your passphrase to delete permanently:</div>
              <input
                type="password" value={deletePass} autoFocus placeholder={tr("unlock.placeholder")}
                onChange={(e) => { setDeletePass(e.currentTarget.value); if (deleteErr) setDeleteErr(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") removeProfile(selected); if (e.key === "Escape") cancelDelete(); }}
                style={{ width: 260, maxWidth: "100%", padding: "7px 10px", border: `1px solid ${deleteErr ? "#c0392b" : "#d9e2e6"}`, borderRadius: 8, marginBottom: 10 }}
              />
              {deleteErr && <div style={{ color: "#c0392b", fontSize: 12.5, marginBottom: 10 }}>{deleteErr}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => removeProfile(selected)} disabled={!deletePass.trim()}
                  style={{ background: deletePass.trim() ? "#9a2c2c" : "#d8b6b6", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", cursor: deletePass.trim() ? "pointer" : "not-allowed" }}>
                  {tr("profile.removeYes")}
                </button>
                <button onClick={cancelDelete} style={{ ...GLASS_BTN }}>{tr("action.cancel")}</button>
              </div>
            </div>
          );
        })()}
      </section>
      )}

      {tab === "license" && !locked && (
        <section style={cardStyle}>
          <h2 style={h2Style}>1 · {tr("license.title")}</h2>
          <p style={{ color: "#5a6b6d", fontSize: 13, marginTop: 0 }}>
            {tr("license.body")}
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "4px 0 10px" }}>
            <span style={{
              fontSize: 13, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
              background: lic?.licensed ? "#e2f2f0" : "#fdf0d9",
              color: lic?.licensed ? "#0a6a60" : "#8a5a0a",
            }}>
              {lic?.licensed
                ? (lic.tier === "trial"
                    ? `Free trial — ${Math.max(0, lic.days_left)} day${lic.days_left === 1 ? "" : "s"} left`
                    : `${lic.tier} — active${lic.days_left >= 0 ? ` (${lic.days_left}d left)` : ""}`)
                : ((lic?.reason || "").toLowerCase().includes("expire") ? "Trial ended — buy to continue" : "Not activated")}
            </span>
            {lic && !lic.licensed && lic.reason && lic.reason !== "no license installed" && (
              <span style={{ fontSize: 12, color: "#8a5a0a" }}>{lic.reason}</span>
            )}
            <span style={{ fontSize: 12, color: "#5a6b6d" }}>
              {tr("license.thisDevice")}: <code>{deviceId.slice(0, 16)}…</code>
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder={tr("license.keyPlaceholder")}
              value={licKey}
              onChange={(e) => setLicKey(e.currentTarget.value)}
              style={{ flex: 1, minWidth: 240 }}
            />
            <button onClick={activateLicense}>{tr("license.activate")}</button>
          </div>
          {!lic?.licensed && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 12, color: "#5a6b6d", width: "100%" }}>{tr("license.buyPrompt")}</span>
              <button onClick={() => buyLicense("pro")}>{tr("license.buyPro")}</button>
              <button onClick={() => buyLicense("duo")}>{tr("license.buyDuo")}</button>
              <button onClick={() => buyLicense("business")}>{tr("license.buyBusiness")}</button>
            </div>
          )}
          <p style={{ color: "#5a6b6d", fontSize: 12, marginTop: 8 }}>
            {tr("license.beta")}
          </p>
        </section>
      )}

      {tab === "setup" && selected && (
        <section style={cardStyle}>
          <h2 style={h2Style}>2 · Vault — {selectedName} (encrypted at rest)</h2>
          <div style={{ border: "1.5px solid #93c2ba", borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ fontWeight: 700 }}><span style={{ fontSize: 30, verticalAlign: "-6px", marginRight: 3 }}>📇</span>Your details <span style={{ fontWeight: 400, fontSize: 11.5, color: "#8a949b" }}>— facts that fill forms; each is a <code style={mono}>key</code> = value</span></div>
          {/* The list scrolls within a bounded height so 'Add a detail' below stays reachable without
              scrolling the whole page. */}
          <div style={{ maxHeight: 360, overflowY: "auto", margin: "8px 0 0", border: "1px solid #eef2f4", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {points.filter((dp) => dp.key !== RECORDS_KEY).map((dp, i) => (
                <tr key={dp.key} style={{ background: i % 2 ? "#f4f8fa" : "#ffffff" }}>
                  <td style={{ padding: "7px 10px", width: "34%", verticalAlign: "middle" }}>
                    {KEY_LABELS[dp.key] ? (
                      <><span style={{ fontWeight: 600 }}>{KEY_LABELS[dp.key]}</span><span style={{ ...mono, fontSize: 11, color: "#98a2a6", display: "block" }}>{dp.key}</span></>
                    ) : (
                      <span style={mono}>{dp.key}</span>
                    )}
                  </td>
                  <td style={{ padding: "7px 10px", width: "46%", verticalAlign: "middle" }}>
                    {editKey === dp.key ? (
                      <input
                        value={editVal}
                        autoFocus
                        onChange={(e) => setEditVal(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") setEditKey(null);
                        }}
                        style={{ padding: "4px 6px", width: "90%" }}
                      />
                    ) : dp.value.startsWith("data:image") ? (
                      <img
                        src={dp.value}
                        alt={dp.key}
                        style={{ maxHeight: 48, maxWidth: 160, border: "1px solid #eef2f4", borderRadius: 4 }}
                      />
                    ) : isImageKey(dp.key) ? (
                      <span style={{ color: "#8a949b", fontStyle: "italic", fontSize: 12 }}>— no image yet —</span>
                    ) : (
                      dp.value
                    )}
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "left", whiteSpace: "nowrap", verticalAlign: "middle" }}>
                    {editKey === dp.key ? (
                      <>
                        <button onClick={saveEdit}>{tr("action.save")}</button>{" "}
                        <button onClick={() => setEditKey(null)}>{tr("action.cancel")}</button>
                      </>
                    ) : (
                      <>
                        {(dp.value.startsWith("data:image") || isImageKey(dp.key)) ? (() => {
                          // An image field can't be text-edited — offer REPLACE (or ADD when empty). Replacing a
                          // scanned DOCUMENT (licence/passport/ID) re-runs OCR to refresh the extracted fields;
                          // a personal image (signature/photo) is a plain swap. The user picks the SOURCE.
                          const hasImage = dp.value.startsWith("data:image");
                          const isDoc = /driver_license|passport|document_image|(^|_)id($|_)/i.test(dp.key) && !/signature|photo/i.test(dp.key);
                          const useImage = (f: File) => { if (isDoc) onDataSource(f); else addImagePoint(dp.key, f); };
                          if (replaceKey === dp.key) {
                            // Same teal look as every other button (label matches via inline gradient).
                            const btnLike: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 5, font: "600 13px/1.1 system-ui, sans-serif", color: "#fff", background: "linear-gradient(180deg, #17b0a1 0%, #0d8f83 100%)", border: "1px solid rgba(9,110,101,0.55)", borderRadius: 9, padding: "7px 12px", cursor: "pointer", boxShadow: "0 1px 2px rgba(13,143,131,0.28)" };
                            return (
                              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                                {isDoc && <button onClick={() => { setReplaceKey(null); startCamera(); }} title="Take a new photo with your camera">📷 Scan</button>}
                                <label style={btnLike} title="Choose an image file from this device">
                                  📁 From file
                                  <input type="file" accept="image/png,image/jpeg" style={{ display: "none" }}
                                    onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) useImage(f); e.currentTarget.value = ""; setReplaceKey(null); }} />
                                </label>
                                <button onClick={() => setReplaceKey(null)} title="Cancel" style={{ background: "#eef2f4", color: "#55666f", border: "1px solid #cbd5db", borderRadius: 9, padding: "7px 10px", cursor: "pointer" }}>✕</button>
                              </span>
                            );
                          }
                          return (
                            <button onClick={() => setReplaceKey(dp.key)} title={isDoc ? "Scan or pick a file (re-runs OCR)" : "Attach or replace this image"}>{hasImage ? "Replace" : "Add image"}</button>
                          );
                        })() : (
                          <button onClick={() => startEdit(dp)}>{tr("action.edit")}</button>
                        )}{" "}
                        <button onClick={() => removePoint(dp.key)}>{tr("action.remove")}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div style={{ marginTop: 10, padding: "10px 12px", background: "#e9f8f5", border: "1px solid #b7e3da", borderRadius: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <strong style={{ fontSize: 13.5, color: "#0b7d72" }}>➕ Add a detail</strong>
            <input
              placeholder="key (e.g. full_name)"
              value={k}
              onChange={(e) => setK(e.currentTarget.value)}
              style={{ padding: "6px 8px", ...mono, width: 170 }}
            />
            <span style={{ color: "#8a949b" }}>=</span>
            <input
              placeholder="value"
              value={v}
              onChange={(e) => setV(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addPoint()}
              style={{ padding: "6px 8px", flex: 1, minWidth: 150 }}
            />
            <button onClick={addPoint} style={{ fontWeight: 800, fontSize: 14, padding: "8px 18px" }}>{tr("action.save")}</button>
          </div>
          </div>

          {/* Saved payment CARDS. Each card includes its own BILLING address (defaulted from the mailing
              address). The ⭐ primary card fills payment forms automatically; the number is shown masked
              and the brand (Visa/Mastercard/…) + type (Credit/Debit/…) are evident. Shared @engine. */}
          {(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cards = listRecords({ records }, "card") as any[];
            const liveBrand = detectCardBrand(recFields.card_number || "");
            return (
          <div style={{ marginTop: 10, border: "1.5px solid #93c2ba", borderRadius: 10, padding: 10 }}>
            <div onClick={() => setCardsOpen((o) => !o)} title={cardsOpen ? "Collapse" : "Expand"} style={{ cursor: "pointer", fontWeight: 700, marginBottom: cardsOpen ? 6 : 0, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#0d8f83", width: 18, textAlign: "center", lineHeight: 1 }}>{cardsOpen ? "−" : "+"}</span>
              <span style={{ fontSize: 30, verticalAlign: "-6px", marginRight: 3 }}>💳</span>Saved cards
              <span style={{ fontWeight: 400, fontSize: 11.5, color: "#8a949b" }}>— {cards.length} saved · ⭐ primary fills payment forms; number never shown</span>
            </div>
            {cardsOpen && (<>
            {cards.map((r) => {
              const brand = detectCardBrand(r.fields?.card_number || "");
              const ctype = cardTypeLabel(r.fields?.card_type);
              return (
                <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 0", fontSize: 13, borderTop: "1px solid #f0f4f5" }}>
                  <button onClick={() => makePrimary(r)} title={r.primary ? "Primary card (fills first)" : "Make primary"} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>{r.primary ? "⭐" : "☆"}</button>
                  <BrandLogo brand={brand} />
                  <span style={{ ...mono, color: "#2a3a3e", minWidth: 92 }}>{maskCard(r.fields?.card_number)}</span>
                  {ctype && <span style={{ fontSize: 11, fontWeight: 700, color: "#0a6a60", background: "#e2f2f0", borderRadius: 5, padding: "2px 7px" }}>{ctype}</span>}
                  <span style={{ color: "#55666f" }}>{r.fields?.card_name || r.label}</span>
                  {r.fields?.billing_city && <span style={{ color: "#8a949b", fontSize: 12 }}>· bills to {r.fields.billing_city}, {r.fields.billing_state}</span>}
                  <button onClick={() => deleteRecord(r.id)} style={{ marginLeft: "auto", fontSize: 12, color: "#9a2c2c", border: "1px solid #e6c9c9", background: "#fff", borderRadius: 6, cursor: "pointer" }}>{tr("records.remove")}</button>
                </div>
              );
            })}
            {/* Add-a-card form */}
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eef2f4" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                <strong style={{ fontSize: 12.5 }}>Add a card</strong>
                <select value={recFields.card_type || "Credit"} onChange={(e) => { const v = e.currentTarget.value; setRecFields((s) => ({ ...s, card_type: v })); }} style={{ padding: "6px 8px" }} title="Card type">
                  {CARD_TYPES.map((t) => <option key={t} value={t}>{t} card</option>)}
                </select>
                {liveBrand && <BrandLogo brand={liveBrand} />}
                <input placeholder="Nickname (optional)" value={recLabel} onChange={(e) => setRecLabel(e.currentTarget.value)} style={{ padding: "6px 8px", width: 150 }} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {CARD_FIELDS.map((f) => (
                  <input
                    key={f.key}
                    type={f.sensitive ? "password" : "text"}
                    inputMode={f.key === "card_number" || f.key === "billing_zip" ? "numeric" : undefined}
                    placeholder={f.label}
                    value={recFields[f.key] || ""}
                    onChange={(e) => { const v = e.currentTarget.value; setRecFields((s) => ({ ...s, [f.key]: v })); }}
                    style={{ padding: "6px 8px", width: f.wide ? 220 : 130, ...(f.billing ? { background: "#f7fbfb" } : {}) }}
                    title={f.billing ? "Billing address (pre-filled from your mailing address)" : undefined}
                  />
                ))}
                <button onClick={addRecord} style={{ fontWeight: 800, fontSize: 14, padding: "8px 18px" }}>Save card</button>
              </div>
              <div style={{ fontSize: 11, color: "#8a949b", marginTop: 4 }}>Billing fields are pre-filled from your mailing address — edit them if the card bills elsewhere.</div>
            </div>
            </>)}
          </div>
            );
          })()}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch", marginTop: 10 }}>
          <div style={{ flex: "1 1 360px", border: "1.5px solid #93c2ba", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}><span style={{ fontSize: 30, verticalAlign: "-6px", marginRight: 3 }}>🪪</span>Import a DL, Passport or ID <span style={{ fontWeight: 400, fontSize: 11.5, color: "#8a949b" }}>— OCR runs on-device and fills your profile (business cards too)</span></div>
            <div style={{ fontSize: 13, color: "#425055", margin: "2px 0 8px" }}>Either <b>choose an existing image file</b> or <b>scan a new one</b> with your camera:</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {/* A native file input can't be colour-styled, so a styled label drives a hidden input. */}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "600 13px/1.1 system-ui, sans-serif", color: "#fff", background: "linear-gradient(180deg, #17b0a1 0%, #0d8f83 100%)", border: "1px solid rgba(9,110,101,0.55)", borderRadius: 9, padding: "8px 14px", cursor: "pointer", boxShadow: "0 1px 2px rgba(13,143,131,0.28)" }}>
                📁 Choose an existing file…
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) onDataSource(f); e.currentTarget.value = ""; }}
                />
              </label>
              {!camOn && <button onClick={startCamera}>📷 Scan a new image</button>}
            </div>
            {camOn && (
              <div style={{ marginTop: 10 }}>
                <video ref={videoRef} playsInline muted style={{ width: "100%", maxWidth: 420, borderRadius: 8, background: "#000" }} />
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={captureFrame}>Capture &amp; read</button>
                  <button onClick={stopCamera}>{tr("action.cancel")}</button>
                </div>
              </div>
            )}
            <style>{`@keyframes ppfspin{to{transform:rotate(360deg)}}`}</style>
            {ocrPct !== null && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0", padding: "14px 16px", background: "#eef7f5", border: "1px solid #bfe0d8", borderRadius: 10 }}>
                <span style={{ width: 22, height: 22, borderRadius: "50%", border: "3px solid #bfe0d8", borderTopColor: "#0a6a60", display: "inline-block", animation: "ppfspin 0.8s linear infinite" }} />
                <b style={{ fontSize: 14, color: "#0a6a60" }}>Reading your document on-device… {ocrPct}%</b>
              </div>
            )}
            {/* After a scan finishes with no readable text fields, say so explicitly — never leave the
                user staring at silence wondering whether anything happened. */}
            {ocrPct === null && scanned && extracted.length === 0 && (
              <p style={{ margin: "10px 0", padding: "10px 12px", background: "#fff7ed", border: "1px solid #f0d9b8", borderRadius: 8, fontSize: 13 }}>
                Read the image, but found no text fields to extract{docImage ? " — you can still save the picture itself below." : ". Try the BACK (barcode) of a licence, or a sharper, well-lit photo."}
              </p>
            )}
            {(extracted.length > 0 || docImage) && (
              <div style={{ marginTop: 8 }}>
                {extracted.length > 0 && <div style={{ fontSize: 13, color: "#0a6a60", fontWeight: 600, margin: "4px 0" }}>Found {extracted.length} field{extracted.length > 1 ? "s" : ""} — edit any value, untick to skip, or add a missing one:</div>}
                <div style={{ margin: "6px 0" }}>
                  {extracted.map((f) => {
                    const off = uncheckedKeys.has(f.ontology_key);
                    return (
                      <div key={f.ontology_key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", opacity: off ? 0.5 : 1 }}>
                        <input
                          type="checkbox"
                          checked={!off}
                          onChange={(e) => setUncheckedKeys((prev) => {
                            const n = new Set(prev);
                            if (e.currentTarget.checked) n.delete(f.ontology_key); else n.add(f.ontology_key);
                            return n;
                          })}
                        />
                        <span style={{ ...mono, minWidth: 150 }}>{f.ontology_key}</span>
                        <span>=</span>
                        <input
                          type="text"
                          value={editedValues[f.ontology_key] ?? f.value}
                          onChange={(e) => setEditedValues((p) => ({ ...p, [f.ontology_key]: e.currentTarget.value }))}
                          style={{ ...mono, flex: 1, padding: "3px 6px", border: "1px solid #cbd5db", borderRadius: 5 }}
                        />
                      </div>
                    );
                  })}
                  {manualFields.map((mf, i) => (
                    <div key={`m${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                      <span style={{ width: 13, display: "inline-block" }} />
                      <input type="text" placeholder="key e.g. last_name" value={mf.key}
                        onChange={(e) => setManualFields((p) => p.map((x, j) => j === i ? { ...x, key: e.currentTarget.value } : x))}
                        style={{ ...mono, minWidth: 150, padding: "3px 6px", border: "1px solid #cbd5db", borderRadius: 5 }} />
                      <span>=</span>
                      <input type="text" placeholder="value" value={mf.value}
                        onChange={(e) => setManualFields((p) => p.map((x, j) => j === i ? { ...x, value: e.currentTarget.value } : x))}
                        style={{ ...mono, flex: 1, padding: "3px 6px", border: "1px solid #cbd5db", borderRadius: 5 }} />
                      <button onClick={() => setManualFields((p) => p.filter((_, j) => j !== i))}
                        style={{ border: "none", background: "transparent", color: "#9a2c2c", cursor: "pointer", fontSize: 15 }}>✕</button>
                    </div>
                  ))}
                  <button onClick={() => setManualFields((p) => [...p, { key: "", value: "" }])}
                    style={{ marginTop: 6, fontSize: 13, background: "transparent", border: "1px dashed #9cb3b0", borderRadius: 8, padding: "4px 10px", cursor: "pointer", color: "#0a6a60" }}>
                    + add a field (e.g. last_name = MYSORE)
                  </button>
                </div>
                {docImage && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0 10px", fontSize: 13 }}>
                    <input type="checkbox" checked={saveDocImage} onChange={(e) => setSaveDocImage(e.currentTarget.checked)} />
                    <img src={docImage.url} alt={docImage.label} style={{ height: 46, borderRadius: 6, border: "1px solid #dde6e4" }} />
                    <span>Also save the {docImage.label} image itself <code style={mono}>({docImage.key})</code></span>
                  </label>
                )}
                <button onClick={saveExtracted}>
                  Save {extracted.filter((f) => !uncheckedKeys.has(f.ontology_key)).length + manualFields.filter((m) => m.key.trim() && m.value.trim()).length + (docImage && saveDocImage ? 1 : 0)} to vault
                </button>
              </div>
            )}
          </div>
          {/* Backup & transfer — same row as Import to save vertical space. */}
          {!locked && (
          <div style={{ flex: "1 1 360px", border: "1.5px solid #93c2ba", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}><span style={{ fontSize: 30, verticalAlign: "-6px", marginRight: 3 }}>📦</span>Backup &amp; transfer <span style={{ fontWeight: 400, fontSize: 11.5, color: "#8a949b" }}>— passphrase-encrypted file; import on another device or the extension (no plaintext export)</span></div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="password"
                placeholder="backup passphrase (remember it!)"
                value={bkPass}
                onChange={(e) => setBkPass(e.currentTarget.value)}
                style={{ padding: "8px 10px", flex: "1 1 160px", minWidth: 140, boxSizing: "border-box", border: "2px solid #0d8f83", borderRadius: 8, outline: "none" }}
              />
              <button onClick={doExport} disabled={exporting}>{exporting ? "⏳ Exporting…" : <>🔐 {tr("backup.exportEncrypted")}</>}</button>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, font: "600 13px/1.1 system-ui, sans-serif", color: "#fff", background: "linear-gradient(180deg, #17b0a1 0%, #0d8f83 100%)", border: "1px solid rgba(9,110,101,0.55)", borderRadius: 9, padding: "8px 14px", cursor: "pointer" }}>
                📥 Import file…
                <input type="file" accept=".ppfvault" style={{ display: "none" }} onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) doImport(f); e.currentTarget.value = ""; }} />
              </label>
            </div>
            {bkMsg && <p style={{ fontSize: 13, margin: "6px 0 0" }}>{bkMsg}</p>}
          </div>
          )}
          </div>
        </section>
      )}

      {tab === "forms" && selected && (<>

      {selected && (
        <section style={cardStyle}>
          {(() => { const formLoaded = reviewFields.length > 0 || !!pdfBytes; return (<>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ ...h2Style, margin: 0 }}>3 · {formLoaded ? "Your form" : "Choose a form to fill"}</h2>
            {formLoaded && (
              <button onClick={() => setShowPicker((v) => !v)} style={{ fontSize: 12 }}>
                {showPicker ? "▾ Hide" : "▸ Choose a different form"}
              </button>
            )}
          </div>
          {(!formLoaded || showPicker) && (<>
          <p style={{ fontSize: 12, color: "#55666f", margin: "8px 0 10px" }}>
            From <b>your device</b>, a <b>network share</b>, a <b>web link</b>, or a <b>web search</b> —
            read and filled here, then sent only where you choose.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Open a form from this device or a network location:</label>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) onOpenForm(f);
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>…or from the web (URL):</label>
            <input
              type="url"
              placeholder="https://gov.example/form.pdf"
              value={formUrl}
              onChange={(e) => setFormUrl(e.currentTarget.value)}
              style={{ flex: 1, minWidth: 260, padding: "6px 8px" }}
            />
            <button onClick={() => fetchFromUrl()}>Fetch &amp; fill</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>…or search the web:</label>
            <input
              type="search"
              placeholder="e.g. India passport renewal form"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") webSearch();
              }}
              style={{ flex: 1, minWidth: 260, padding: "6px 8px" }}
            />
            <button onClick={webSearch} disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          <div style={{ fontSize: 12, color: "#8a4b0a", background: "#fbe7cf", borderRadius: 6, padding: "6px 8px", marginTop: 6 }}>
            ⚠ Only your <b>search terms</b> leave the device — straight to DuckDuckGo, no tracking. Prefer? paste a URL instead.
          </div>
          {searchHits.length > 0 && (
            <div style={{ marginTop: 8, border: "1px solid #eef2f4", borderRadius: 8, padding: 8 }}>
              <div style={{ fontSize: 12, color: "#55666f", marginBottom: 6 }}>
                Results — “Fill this” downloads it on-device and fills it:
              </div>
              {searchHits.map((h) => (
                <div key={h.url} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
                  <button onClick={() => fetchFromUrl(h.url)} style={{ flexShrink: 0 }}>
                    Fill this
                  </button>
                  <span style={{ fontSize: 13 }}>
                    <b>{h.title}</b>
                    <br />
                    <span style={{ fontSize: 11, color: "#55666f" }}>{h.url}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12, color: "#55666f", marginTop: 6 }}>
            Any form works, <b>automatically</b>: existing fields fill from your vault; a flat scan gets
            fields by on-device OCR, then exports a ready <code>filled.pdf</code>. PDFs, web links, Word and Excel.
          </div>
          </>)}
          </>); })()}
          {/* Live fill progress — a dynamic hourglass so it's obvious the form is being filled (big XFA
              forms take a moment). Shown for both auto-fill-on-load and the Fill button. */}
          {filling && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0", padding: "12px 16px", background: "#eef7f5", border: "1px solid #bfe0d8", borderRadius: 10 }}>
              <style>{`@keyframes ppfflip{0%{transform:rotate(0)}45%,55%{transform:rotate(180deg)}100%{transform:rotate(360deg)}}`}</style>
              <span style={{ fontSize: 22, display: "inline-block", animation: "ppfflip 1.1s ease-in-out infinite" }}>⏳</span>
              <b style={{ fontSize: 14, color: "#0a6a60" }}>{fillStatus || "Filling the form from your vault, on-device…"} please wait.</b>
            </div>
          )}
          {pdfMsg && !filling && <p style={{ fontSize: 13, color: "#0a6a60", margin: "8px 0 0" }}>{pdfMsg}</p>}
          {pdfBytes && reviewFields.length === 0 && (
            <div style={{ margin: "6px 0" }}>
              <button onClick={() => setSigning(true)} style={{ fontWeight: 600 }}>
                Sign / annotate ✍︎ — draw, type, or place your signature &amp; photo
              </button>
              <span style={{ fontSize: 12, color: "#8a8f92", marginLeft: 8 }}>
                pen colour &amp; size · undo · move/resize placed images
              </span>
            </div>
          )}
          {reviewFields.length > 0 && (
            <div style={{ border: "1.5px solid #93c2ba", borderRadius: 10, padding: 12, marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
                Review &amp; edit the filled form
                <span style={{ fontWeight: 400, fontSize: 12, color: "#55666f", marginLeft: 8 }}>
                  — check each value, then <b>Apply changes</b> to re-export.
                </span>
              </div>
              {GRANITE_ENABLED && graniteModal && (
                <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
                  onClick={() => { if (!graniteDL.on) setGraniteModal(false); }}>
                  <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, padding: 22, maxWidth: 470, boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}>
                    <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Download the Granite layout model</div>
                    <div style={{ fontSize: 13.5, color: "#425055", lineHeight: 1.5 }}>
                      Granite reads a form's layout with an on-device AI model. It's a <b>one-time ~310&nbsp;MB download</b> that
                      stays on your device and <b>never leaves it</b> — nothing about your forms is ever sent anywhere.
                      <br /><span style={{ color: "#8a8f92" }}>Note: filling still uses the Standard engine until Granite's on-device inference (the next milestone) is ready.</span>
                    </div>
                    {graniteDL.err && <div style={{ color: "#c0392b", fontSize: 12.5, marginTop: 10 }}>Download failed: {graniteDL.err}</div>}
                    {graniteDL.on ? (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ fontSize: 12.5, color: "#0a6a60", marginBottom: 6 }}>Downloading {Math.min(graniteDL.i + 1, graniteDL.total)} of {graniteDL.total} — {graniteDL.file}</div>
                        <div style={{ height: 8, background: "#eef2f4", borderRadius: 6, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.round((100 * graniteDL.i) / graniteDL.total)}%`, background: "linear-gradient(90deg,#14a99b,#0b8175)", transition: "width .3s" }} />
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
                        <button onClick={() => setGraniteModal(false)} style={GLASS_BTN}>{tr("update.later")}</button>
                        <button onClick={downloadGranite} style={{ ...GLASS_BTN, fontWeight: 700, color: "#fff", background: "linear-gradient(180deg,#14a99b,#0b8175)", border: "1px solid #0b7d72" }}>Download Granite (~310 MB)</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Persistent form toolbar — the SAME tools the extension exposes, in the same place:
                  on the form, always visible. Parity is the rule, not a nice-to-have. */}
              <div
                style={{
                  display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap",
                  margin: "0 0 8px", padding: "6px 8px",
                  background: "#f4f8f9", border: "1.5px solid #93c2ba", borderRadius: 8,
                }}
              >
                {/* FILL is the FIRST, primary action — on top of the form with the other tools. While it
                    runs, a live animated hourglass shows progress (the fill can take a moment on big forms). */}
                <style>{`@keyframes ppfflip{0%{transform:rotate(0)}45%,55%{transform:rotate(180deg)}100%{transform:rotate(360deg)}}`}</style>
                <button
                  onClick={fillPdf}
                  disabled={filling}
                  title="Fill every matching field from your vault — works on USCIS/XFA forms too, and keeps the form editable"
                  style={{
                    ...GLASS_BTN, fontWeight: 800, color: "#fff", fontSize: 14,
                    display: "inline-flex", alignItems: "center", gap: 7,
                    background: filling
                      ? "linear-gradient(180deg, #7fb3ac 0%, #5a9a92 100%)"
                      : "linear-gradient(180deg, #14a99b 0%, #0d8f83 60%, #0b8175 100%)",
                    border: "1px solid #0b7d72",
                    cursor: filling ? "wait" : "pointer",
                    boxShadow: "0 2px 8px rgba(13,143,131,0.42), inset 0 1px 0 rgba(255,255,255,0.3)",
                  }}
                >
                  {filling
                    ? <><span style={{ display: "inline-block", animation: "ppfflip 1.1s ease-in-out infinite" }}>⏳</span> Filling…</>
                    : <>⚡ Fill from my vault</>}
                </button>
                {/* Fill from ANY profile without leaving this tab — switching loads that profile's vault;
                    click Fill to apply. Inline in the toolbar so it uses no extra vertical space. */}
                {profiles.length > 1 && (
                  <label title="Fill this form from another profile's vault — pick one, then click Fill" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#425055", padding: "0 2px" }}>
                    <span style={{ fontWeight: 600 }}>Profile:</span>
                    <select value={selected || ""} onChange={(e) => selectProfile(e.currentTarget.value)} disabled={filling} style={{ padding: "3px 6px", maxWidth: 170 }}>
                      {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </label>
                )}
                {/* Engine selector — swap the field-labelling engine and re-Fill to compare manually (RFC-0010).
                    PARKED: hidden until Granite inference produces usable output; Standard is the only engine. */}
                {GRANITE_ENABLED && <span title="Which engine labels the fields. Granite-Docling is an experimental on-device layout model (beta)."
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "#425055", padding: "0 4px" }}>
                  <span style={{ fontWeight: 600 }}>Engine:</span>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                    <input type="radio" name="fillengine" checked={fillEngine === "standard"} onChange={() => { setFillEngine("standard"); setPdfMsg(""); }} />
                    Standard
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
                    <input type="radio" name="fillengine" checked={fillEngine === "granite"} onChange={selectGranite} />
                    Granite <span style={{ fontSize: 10, color: graniteReady ? "#0a6a60" : "#a06a00", background: graniteReady ? "#e6f5f2" : "#fff3d6", border: `1px solid ${graniteReady ? "#a9ded6" : "#f0d8a0"}`, borderRadius: 4, padding: "0 4px" }}>{graniteReady ? "model ready" : "needs download"}</span>
                  </label>
                </span>}
                <span style={{ width: 1, height: 18, background: "#d9e2e6" }} />
                <button style={GLASS_BTN} onClick={() => setSigning(true)} title="Draw with the pen — colour & size, undo">✎ Pen</button>
                <button style={GLASS_BTN} onClick={() => setSigning(true)} title="Type text anywhere on the form">T {tr("sign.text")}</button>
                <button style={GLASS_BTN} onClick={() => setSigning(true)} title="Place your signature — move &amp; resize it">✍︎ Signature</button>
                <button style={GLASS_BTN} onClick={() => setSigning(true)} title="Place a photo or image — move &amp; resize it">🖼 Image</button>
                <button style={GLASS_BTN} onClick={() => setShowSubmit((v) => !v)} title="Submit the filled form online (opens a bottom bar)">⤴ Submit</button>
                <span style={{ width: 1, height: 18, background: "#d9e2e6" }} />
                <button onClick={translateReview} disabled={baseLang === "en"}>
                  🌐 {baseLang === "en" ? "Already in your language" : `Show whole form in ${LANGS[baseLang] || baseLang}`}
                </button>
                {(Object.keys(viewVals).length > 0 || Object.keys(viewLang).length > 0) && (
                  <button onClick={() => { setViewLang({}); setViewVals({}); setTransStatus(""); }}>
                    ↩ Back to original
                  </button>
                )}
                {transStatus && <span style={{ fontSize: 12, color: "#55666f", flexBasis: "100%" }}>{transStatus}</span>}
              </div>
              {GRANITE_ENABLED && fillEngine === "granite" && graniteReady && (
                <div style={{ margin: "0 0 8px", padding: "8px 10px", border: "1px solid #cfe9e5", background: "#f2fbf9", borderRadius: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
                    <b style={{ color: "#0a6a60" }}>Granite (on-device)</b>
                    <span>Read page</span>
                    <input type="number" min={1} value={gPage} onChange={(e) => setGPage(parseInt(e.currentTarget.value, 10) || 1)} style={{ width: 56, padding: "3px 6px" }} />
                    <button onClick={runGranite} disabled={gBusy} style={{ ...GLASS_BTN, fontWeight: 700, color: "#fff", background: "linear-gradient(180deg,#14a99b,#0b8175)", border: "1px solid #0b7d72", cursor: gBusy ? "wait" : "pointer" }}>
                      {gBusy ? "⏳ Reading…" : "🔍 Read this page with Granite"}
                    </button>
                    {gStatus && <span style={{ color: "#55666f" }}>{gStatus}</span>}
                  </div>
                  {gErr && <div style={{ color: "#c0392b", fontSize: 12.5, marginTop: 6 }}>Granite error: {gErr}</div>}
                  {gOut && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 12, color: "#55666f", marginBottom: 4 }}>What Granite read from page {gPage} ({gOut.chars} chars, {(gOut.ms / 1000).toFixed(1)}s). This is milestone 2 (reading the layout); mapping it onto fields to fill is milestone 3.</div>
                      <textarea readOnly value={gOut.doctags} style={{ width: "100%", height: 180, fontFamily: "monospace", fontSize: 11, border: "1px solid #cfe9e5", borderRadius: 6, padding: 8, boxSizing: "border-box" }} />
                    </div>
                  )}
                </div>
              )}
              {pdfBytes && (
                <FormView
                  bytes={pdfBytes}
                  edits={reviewEdits}
                  onEdit={(name, value) => setReviewEdits((e) => ({ ...e, [name]: value }))}
                  labels={viewLang}
                  values={viewVals}
                  showTranslated={Object.keys(viewVals).length > 0 || Object.keys(viewLang).length > 0}
                />
              )}
              {/* When the form fills the viewport (scroll-locked), the inline "new info" panel below sits
                  off the bottom of the screen — a user who edits a value and tabs out sees nothing. This
                  fixed bar surfaces the prompt immediately, over the form, so the edit→save loop is
                  reachable without hunting. */}
              {pdfBytes && newPairs.length > 0 && (
                <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60, background: "#fffdf3", borderTop: "2px solid #e0b400", boxShadow: "0 -3px 12px rgba(35,55,60,0.14)", padding: "8px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700 }}>💡 {newPairs.length} new value{newPairs.length > 1 ? "s" : ""} to save to your vault:</span>
                  <span style={{ fontSize: 13, color: "#55666f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "42vw" }}>
                    {newPairs.slice(0, 3).map((p) => `${p.label} = ${p.value}`).join("  ·  ")}{newPairs.length > 3 ? "  …" : ""}
                  </span>
                  <button onClick={saveNewPairs} style={{ fontWeight: 700, marginLeft: "auto", padding: "6px 14px", border: "1px solid #b98a00", borderRadius: 8, background: "#ffe08a", cursor: "pointer" }}>
                    Save to vault
                  </button>
                  <button onClick={() => { setSkipNew(Object.fromEntries(newPairs.map((p) => [p.key, true]))); setLearnMsg("Dismissed — nothing saved."); }} style={{ padding: "6px 12px", borderRadius: 8, cursor: "pointer" }}>
                    Dismiss
                  </button>
                  {learnMsg && <span style={{ fontSize: 12, color: "#0a6a60", width: "100%" }}>{learnMsg}</span>}
                </div>
              )}
              {newPairs.length > 0 && (
                <div style={{ marginTop: 10, border: "1px solid #e0b400", background: "#fffdf3", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>
                    💡 New information found on this form — save it to your vault?
                  </div>
                  <p style={{ fontSize: 12, color: "#55666f", margin: "0 0 8px" }}>
                    Here is exactly what we found. Nothing is saved unless you say so, and it is stored
                    only in your local vault on this device.
                  </p>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                    <tbody>
                      {newPairs.map((p) => (
                        <tr key={p.key}>
                          <td style={{ width: 24, padding: "3px 4px" }}>
                            <input
                              type="checkbox"
                              checked={!skipNew[p.key]}
                              onChange={(e) => setSkipNew((s) => ({ ...s, [p.key]: !e.currentTarget.checked }))}
                            />
                          </td>
                          <td style={{ padding: "3px 6px", color: "#55666f" }}>
                            {p.label}
                            <div style={{ fontSize: 11, opacity: 0.65 }}>{p.key}</div>
                          </td>
                          <td style={{ padding: "3px 6px", fontWeight: 600 }}>
                            {p.value}
                            {p.existing !== undefined && (
                              <div style={{ fontSize: 11, color: "#a06a00", fontWeight: 400 }}>
                                replaces “{p.existing}”
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                    <button onClick={saveNewPairs} style={{ fontWeight: 600 }}>
                      Save ticked to my vault
                    </button>
                    <button onClick={() => { setSkipNew(Object.fromEntries(newPairs.map((p) => [p.key, true]))); setLearnMsg("Skipped — nothing was saved."); }}>
                      Not now
                    </button>
                    {learnMsg && <span style={{ fontSize: 12, color: "#0a6a60" }}>{learnMsg}</span>}
                  </div>
                </div>
              )}
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, color: "#0a6a60" }}>
                  Prefer a list? Show every field as a key/value table
                </summary>
              <div style={{ maxHeight: 300, overflow: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                  <tbody>
                    {reviewFields.map((f) => {
                      const cur = reviewEdits[f.name] ?? f.value;
                      const set = (v: string) => setReviewEdits((e) => ({ ...e, [f.name]: v }));
                      return (
                        <tr key={f.name} style={{ borderBottom: "1px solid #eef2f4" }}>
                          <td style={{ padding: "5px 8px", width: "42%" }}>
                            <span style={mono}>{f.label}</span>
                            {viewLang[f.name] && <div style={{ color: "#0a6a60", fontSize: 12 }}>{viewLang[f.name]}</div>}
                          </td>
                          <td style={{ padding: "5px 8px" }}>
                            {f.kind === "radio" || f.kind === "dropdown" ? (
                              <select value={cur} onChange={(e) => set(e.currentTarget.value)} style={{ padding: 4, minWidth: 160 }}>
                                <option value="">(none)</option>
                                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : f.kind === "check" ? (
                              <input type="checkbox" checked={cur === "Yes"} onChange={(e) => set(e.currentTarget.checked ? "Yes" : "Off")} />
                            ) : (
                              <input value={cur} onChange={(e) => set(e.currentTarget.value)} style={{ padding: "4px 6px", width: "100%", boxSizing: "border-box" }} />
                            )}
                            {viewVals[f.name] && <div style={{ color: "#0a6a60", fontSize: 12 }}>{viewVals[f.name]}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </details>
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={applyReview} disabled={Object.keys(reviewEdits).length === 0} style={{ fontWeight: 600 }}>
                  Apply changes &amp; re-export
                </button>
                <span style={{ fontSize: 12, color: "#8a8f92" }}>
                  {Object.keys(reviewEdits).length} change(s) pending · {reviewFields.length} field(s)
                </span>
              </div>
            </div>
          )}
          {officeFilled && (
            <div style={{ marginTop: 4 }}>
              <button onClick={exportOfficePdf}>Export as PDF (on-device)</button>
              <span style={{ fontSize: 12, color: "#55666f", marginLeft: 8 }}>
                Content export — readable &amp; signable. Pixel-faithful layout is a future option.
              </span>
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              style={{ fontSize: 12, background: "none", border: "none", color: "#0a6a60", cursor: "pointer", padding: 0 }}
            >
              {showAdvanced ? "▾ Hide manual/demo tools" : "▸ Manual & demo tools"}
            </button>
          </div>
          {showAdvanced && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              <button onClick={genFlat}>Generate flat sample PDF (demo)</button>
              {pdfBytes && <button onClick={fillPdf}>{tr("forms.fillExisting")}</button>}
              {pdfBytes && <button onClick={detectAndFill}>Detect fields (OCR)</button>}
              {pdfBytes && <button onClick={() => setSigning(true)}>Sign / annotate ✍︎</button>}
            </div>
          )}
          {/* Legacy read-only preview. FormView above IS the form now, so showing this too rendered
              the page twice. Kept only for the case where there are no fields to lay inputs over. */}
          <div
            style={{
              marginTop: 10,
              overflow: "auto",
              maxHeight: 440,
              display: reviewFields.length > 0 ? "none" : "block",
              border: pdfBytes ? "1px solid #eef2f4" : "none",
            }}
          >
            <canvas ref={canvasRef} style={{ maxWidth: "100%" }} />
          </div>

          {(!(tab === "forms" && pdfBytes) || showSubmit) && (
          <div style={(tab === "forms" && pdfBytes)
            ? { position: "fixed", left: 0, right: 0, bottom: 0, background: "#fff", borderTop: "1px solid #d9e2e6", padding: "10px 18px", boxShadow: "0 -2px 12px rgba(0,0,0,0.10)", zIndex: 900 }
            : { marginTop: 14, paddingTop: 12, borderTop: "1px solid #eef2f4" }}>
            <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.8, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Submit online — opens the vendor page; you submit there (device → vendor, we never proxy)</span>
              {(tab === "forms" && pdfBytes) && <button onClick={() => setShowSubmit(false)} style={{ marginLeft: "auto", fontSize: 12 }}>✕ Close</button>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                placeholder="Submission URL (vendor / gov site)"
                value={submitUrl}
                onChange={(e) => setSubmitUrl(e.currentTarget.value)}
                style={{ padding: 8, flex: 1 }}
              />
              <button onClick={() => submitUrl.trim() && guard(invoke<string>("open_submit_url", { url: submitUrl }).then(setSubmitMsg))}>
                Submit online
              </button>
            </div>
            {submitMsg && (
              <p style={{ fontSize: 13, color: submitMsg.startsWith("WARNING") ? "#b45309" : "#0a6a60" }}>
                {submitMsg}
              </p>
            )}
          </div>
          )}
        </section>
      )}

      {!(tab === "forms" && pdfBytes) && (
      <section style={cardStyle}>
        <h2 style={h2Style}>6 · Browser companion (extension)</h2>
        <p style={{ fontSize: 12, color: "#55666f", marginTop: 0 }}>
          Let the browser extension fill web forms from <b>this app’s</b> vault over a local bridge —
          your keys stay here, never in the extension. Paste the extension’s id (from{" "}
          <code style={mono}>chrome://extensions</code>) and register.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="extension id (e.g. abcdef…)"
            value={companionId}
            onChange={(e) => setCompanionId(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 280, padding: "6px 8px" }}
          />
          <button onClick={registerCompanion}>{tr("companion.register")}</button>
        </div>
        {companionMsg && <p style={{ fontSize: 13, color: "#0a6a60" }}>{companionMsg}</p>}
      </section>
      )}
      </>)}

      {tab === "history" && (
        <section style={cardStyle}>
          <h2 style={h2Style}>3 · Past filled forms</h2>
          <p style={{ color: "#55666f", fontSize: 13, marginTop: 0 }}>
            Every form you fill is kept here as an encrypted, versioned copy — <b>entirely on this
            device</b>. Re-download or sign any of them; nothing was uploaded to save it.
          </p>
          {savedMsg && <p style={{ fontSize: 13, color: "#0a6a60" }}>{savedMsg}</p>}
          {savedForms.length === 0 ? (
            <p style={{ opacity: 0.6, fontSize: 13 }}>
              No saved forms yet. Fill a form in the <b>Forms to fill</b> tab and it appears here automatically.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {savedForms.map((f) => (
                <div
                  key={f.instance_id}
                  style={{ border: "1px solid #eef2f4", borderRadius: 8, padding: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {f.name} {f.signed && <span style={{ color: "#0a6a60", fontSize: 12 }}>· ✓ signed</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#55666f", ...mono }}>
                      v{f.version_no} · {f.saves} save(s) · filled {f.fields_filled}/{f.fields_total} field(s)
                      · {new Date(f.created_at * 1000).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => redownloadSaved(f)}>{tr("forms.redownload")}</button>
                    {!f.signed && <button onClick={() => signSaved(f)}>Sign (device key)</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "docs" && (
        <section style={cardStyle}>
          <h2 style={h2Style}>5 · Docs &amp; Video</h2>
          <p style={{ color: "#55666f", fontSize: 13, marginTop: 0 }}>
            A narrated walkthrough of every feature, plus written documentation. The video isn’t
            packaged in the app — it’s fetched <b>once</b> from our asset host, integrity-checked, and
            <b> cached on your device</b> so it then plays offline. Only genuine app builds can fetch
            it, and no identifier about you is ever sent.
          </p>

          {guideUrl ? (
            <video
              controls
              preload="metadata"
              src={guideUrl}
              style={{ width: "100%", borderRadius: 10, border: "1px solid #e6eeec", background: "#000" }}
            >
              Your device can’t play this video.
            </video>
          ) : (
            <div style={{
              border: "1px dashed #cdd9dd", borderRadius: 10, padding: 20, textAlign: "center",
              color: "#55666f", fontSize: 13, background: "#f7fafa",
            }}>
              <div style={{ marginBottom: 8 }}>{guideMsg || "Preparing the guide video…"}</div>
              <button onClick={loadGuideVideo}>Download &amp; play the guide</button>
            </div>
          )}
          <p style={{ fontSize: 12, color: "#8a8f92", margin: "6px 0 16px" }}>
            Guided tour — License → Profile &amp; Vault → Forms to fill → Past forms (with narration).
          </p>

          <h3 style={{ fontSize: 15, margin: "0 0 6px" }}>How it works, tab by tab</h3>
          <ul style={{ fontSize: 13, color: "#37474a", lineHeight: 1.6, paddingLeft: 18 }}>
            <li>
              <b>1 · License</b> — the app’s foundation. Shows your license (Free/beta or Pro) and this
              device’s identity, verified <b>offline</b>. A Pro key is bound to this device; activating
              it never contacts a server and your key never leaves the machine.
            </li>
            <li>
              <b>2 · Profile &amp; Vault</b> — create/choose a profile at the top; below it, that
              profile’s <b>encrypted vault</b> of key/value details (name, DOB, email, photo, signature,
              licence…). Everything is sealed at rest on-device. Import a passport/licence/business-card
              and on-device OCR fills the vault for you. Back up or transfer the vault as a
              passphrase-encrypted file — there is no plaintext export.
            </li>
            <li>
              <b>3 · Forms to fill</b> — bring <b>any</b> form: from this device, a network location
              (<code>{"\\\\server\\share"}</code>), a web link, or by searching the web. It’s read and
              filled <b>right here</b> — if it already has form fields they’re filled from your vault;
              if not, on-device OCR detects the fields, creates them, and fills them, then exports a
              ready <code>filled.pdf</code>. Word/Excel forms are filled from named fields or labels.
            </li>
            <li>
              <b>4 · Past forms</b> — every form you fill is kept as an <b>encrypted, versioned copy</b>
              on this device. Re-download any past version, or <b>sign</b> it with this device’s
              Ed25519 key (a non-delegable provenance signature). Nothing was uploaded to save it.
            </li>
          </ul>

          <h3 style={{ fontSize: 15, margin: "14px 0 6px" }}>The privacy promise</h3>
          <p style={{ fontSize: 13, color: "#37474a", lineHeight: 1.6, margin: 0 }}>
            Every operation that touches your content — OCR, translation, field-naming, filling,
            signing — runs <b>on this device</b>. We never see, store, or receive your forms or data.
            The finished form goes only where <b>you</b> choose to send it (e.g. submitting it to its
            recipient). The one clearly-labelled exception is an optional web search to <i>locate</i> a
            blank form, where only your typed search terms go to DuckDuckGo directly.
          </p>
        </section>
      )}
    </main>
  );
}
