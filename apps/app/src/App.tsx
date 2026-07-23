import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { extractFromImage, type ExtractedField } from "./ocr";
import { downloadBytes, fillAndExport, generateFlatSamplePdf, imageToPdf, makeFillableAndFill, renderFirstPage, listReviewFields, applyReviewEdits, type ReviewField } from "./pdf";
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
import { UI_LANGS, translator, dirOf, detectUiLang } from "@engine/i18n.js";

// { iso: displayName } for every supported language.
const LANGS: Record<string, string> = Object.fromEntries(
  (allLangs() as string[]).map((c) => [c, langName(c) as string]),
);
type Lang = string;

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
  border: "1px solid #d9e2e6",
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
};
const h2Style: React.CSSProperties = {
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  opacity: 0.6,
  margin: "0 0 10px",
};
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };

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
  const [imgKey, setImgKey] = useState("");
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
  const [hasPass, setHasPass] = useState(false);
  const [pass, setPass] = useState("");
  const [lockMsg, setLockMsg] = useState("");
  const [extracted, setExtracted] = useState<ExtractedField[]>([]);
  const [ocrPct, setOcrPct] = useState<number | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pdfMsg, setPdfMsg] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formUrl, setFormUrl] = useState("");
  const [officeFilled, setOfficeFilled] = useState<{ data: Uint8Array; kind: OfficeKind } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHits, setSearchHits] = useState<Array<{ title: string; url: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [companionId, setCompanionId] = useState("");
  const [companionMsg, setCompanionMsg] = useState("");
  const [submitUrl, setSubmitUrl] = useState("");
  const [submitMsg, setSubmitMsg] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [err, setErr] = useState("");
  const [bkPass, setBkPass] = useState("");
  const [bkMsg, setBkMsg] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [lic, setLic] = useState<{ licensed: boolean; tier: string; subject: string; reason: string } | null>(null);
  const [licKey, setLicKey] = useState("");
  // Step-based tabs instead of one long scrolling page.
  const [tab, setTab] = useState<"license" | "setup" | "forms" | "history" | "docs">("license");

  const guard = (p: Promise<unknown>) => p.catch((e) => setErr(String(e)));

  // Load per-device id + offline license status once unlocked.
  useEffect(() => {
    if (locked) return;
    invoke<string>("device_id").then(setDeviceId).catch(() => {});
    invoke<{ licensed: boolean; tier: string; subject: string; reason: string }>("license_status")
      .then(setLic)
      .catch(() => {});
  }, [locked]);

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
    }
  }

  async function activateLicense() {
    if (!licKey.trim()) return setBkMsg("Paste your license key first.");
    try {
      const st = await invoke<{ licensed: boolean; tier: string; subject: string; reason: string }>(
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
      if (!value || value === "Off" || value === "Yes" || value.startsWith("data:")) continue;
      const f = reviewFields.find((x) => x.name === name);
      const label = ((f?.label || name) as string).trim();
      const key = keyFromLabel(label);
      if (!key || seen.has(key)) continue;
      const existing = known.get(key);
      if (existing === value) continue; // already known, unchanged
      seen.add(key);
      out.push({ key, label, value, existing });
    }
    return out;
  }, [reviewEdits, reviewFields, known]);

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

  const refreshProfiles = () => guard(invoke<Profile[]>("list_profiles").then(setProfiles));
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
    setLockMsg("");
    try {
      if (hasPass) await invoke("unlock", { passphrase: pass });
      else await invoke("set_passphrase", { passphrase: pass });
      setPass("");
      setLocked(false);
      refreshProfiles();
    } catch (e) {
      setLockMsg(String(e));
    }
  }
  async function lockNow() {
    await invoke("lock_app");
    setSelected(null);
    setLocked(true);
  }

  function selectProfile(id: string) {
    setSelected(id);
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
    setOcrPct(0);
    try {
      // 1) PDF417 barcode (back of a licence) → exact AAMVA fields.
      let fields = await readIdBarcode(file);
      // 2) else OCR the printed side (front).
      if (!fields.length) fields = (await extractFromImage(file, setOcrPct, baseLang)).fields;
      setExtracted(fields);
      if (!fields.length) {
        setErr("Couldn’t read that image. For a driver’s licence: the BACK (barcode) gives exact data; or take a sharper, well-lit photo of the FRONT.");
      }
    } catch (e) {
      setErr(String(e));
    }
    setOcrPct(null);
  }
  async function saveExtracted() {
    if (!selected) return;
    for (const f of extracted) {
      await guard(invoke("upsert_data_point", { profileId: selected, key: f.ontology_key, value: f.value }));
    }
    setExtracted([]);
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
      const vault = Object.fromEntries(points.map((p) => [p.key, p.value]));
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
  async function exportOfficePdf() {
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
      const fields = await listReviewFields(bytes);
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
    const vault = Object.fromEntries(points.map((p) => [p.key, p.value]));
    try {
      const existing = await fillAndExport(bytes, vault); // total = # AcroForm fields
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
    }
  }
  async function fillPdf() {
    if (!pdfBytes) return;
    const vault = Object.fromEntries(points.map((p) => [p.key, p.value]));
    try {
      const { filled, total, data } = await fillAndExport(pdfBytes, vault);
      await saveOut(data, "filled");
      setPdfMsg(
        total === 0
          ? "No AcroForm fields in this PDF (flat/scanned) — use “Make fillable” below to create them."
          : `Filled ${filled} of ${total} existing form fields from the vault; downloaded filled.pdf.`,
      );
    } catch (e) {
      setErr(String(e));
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
    if (!pdfBytes) {
      setPdfMsg("Open or generate a PDF first.");
      return;
    }
    try {
      setPdfMsg("Detecting fields with on-device OCR…");
      const { fields, note } = await detectFields(pdfBytes, setPdfMsg, baseLang);
      const vault = Object.fromEntries(points.map((p) => [p.key, p.value]));
      const { created, filled, data } = await makeFillableAndFill(pdfBytes, fields, vault);
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      setPdfBytes(ab);
      if (canvasRef.current) await renderFirstPage(ab, canvasRef.current);
      await saveOut(data, "detected-filled");
      setPdfMsg(`${note} Created ${created}, filled ${filled} from the vault; saved to your Desktop.`);
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
        <input
          type="password"
          autoFocus
          placeholder={hasPass ? tr("unlock.placeholder") : "Create a passphrase (min 6 chars)"}
          value={pass}
          onChange={(e) => setPass(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitLock();
          }}
          style={{ width: "100%", padding: "10px 12px", margin: "12px 0", boxSizing: "border-box" }}
        />
        <button onClick={submitLock} style={{ padding: "10px 16px", width: "100%" }}>
          {hasPass ? tr("unlock.button") : "Set passphrase & continue"}
        </button>
        {lockMsg && <p style={{ color: "#9a2c2c", fontSize: 13 }}>{lockMsg}</p>}
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
        maxWidth: "min(1600px, 96vw)",
        margin: "0 auto",
        padding: "28px 20px 64px",
        color: "#101a20",
      }}
    >
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
        <h1 style={{ marginBottom: 2 }}>PolyglotFormFill</h1>
        <button onClick={lockNow} style={{ fontSize: 12 }}>
          🔒 {tr("lock.button")}
        </button>
      </div>
      <p style={{ color: "#55666f", marginTop: 0 }}>
        {tr("privacy.body")}
      </p>
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
      {err && (
        <p style={{ color: "#9a2c2c", cursor: "pointer" }} onClick={() => setErr("")}>
          {err} (click to dismiss)
        </p>
      )}
      {savedPath && (
        <p
          style={{ background: "#e2f2f0", color: "#0a6a60", borderRadius: 8, padding: "8px 10px", fontSize: 13, cursor: "pointer", margin: "6px 0" }}
          title="Click to dismiss"
          onClick={() => setSavedPath("")}
        >
          📄 Saved to your Desktop: <b style={mono}>{savedPath}</b>
        </p>
      )}

      <nav style={{ display: "flex", gap: 4, margin: "0 0 6px", padding: "10px 0 0", borderBottom: "2px solid #e6eeec", flexWrap: "wrap", position: "sticky", top: 0, background: "#fff", zIndex: 10 }}>
        {([["license", "1 · " + tr("tab.license")], ["setup", "2 · " + tr("tab.profile")], ["forms", "3 · " + tr("tab.forms")], ["history", "4 · " + tr("tab.past")], ["docs", "5 · " + tr("tab.docs")]] as const).map(([id, label]) => {
          const locked = (id === "forms" || id === "history") && !selected;
          return (
            <button key={id} onClick={() => !locked && setTab(id)} disabled={locked}
              style={{ padding: "9px 16px", border: "none", borderBottom: tab === id ? "3px solid #0d8f83" : "3px solid transparent", background: "none", fontWeight: tab === id ? 700 : 500, fontSize: 14, color: tab === id ? "#0a6a60" : "#55666f", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1 }}>
              {label}
            </button>
          );
        })}
      </nav>
      {!selected && <p style={{ fontSize: 12, color: "#8a8f92", margin: "2px 0 10px" }}>{tr("tabs.hint")}</p>}

      {tab === "setup" && (
      <section style={cardStyle}>
        <h2 style={h2Style}>1 · Profiles — add, choose, edit or remove</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {/* Chips ONLY select a profile - no destructive control here, so a chip can never be a
              mis-click away from deleting data. Removal lives in its own confirmed action below. */}
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProfile(p.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: p.id === selected ? "2px solid #0d8f83" : "1px solid #d9e2e6",
                background: p.id === selected ? "#e2f2f0" : "#fff",
                cursor: "pointer",
              }}
            >
              {p.name}
            </button>
          ))}
          {profiles.length === 0 && <span style={{ opacity: 0.6 }}>No profiles yet.</span>}
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

        {/* Removal is a DELIBERATE, two-step action, in its own area away from the selection chips.
            Step 1 reveals the intent; step 2 confirms and states plainly that it cannot be undone.
            This replaced an inline "x" on each chip, which sat one mis-click from destroying data. */}
        {selected && (() => {
          const sel = profiles.find((p) => p.id === selected);
          if (!sel) return null;
          const confirming = confirmDeleteId === selected;
          return (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eef2f4" }}>
              {!confirming ? (
                <button
                  onClick={() => setConfirmDeleteId(selected)}
                  style={{ background: "transparent", border: "1px solid #e3c9c9", color: "#9a2c2c", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}
                >
                  {tr("profile.remove")} — {sel.name}
                </button>
              ) : (
                <div style={{ background: "#fbf1f1", border: "1px solid #e3c9c9", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ color: "#7a2222", fontSize: 13, marginBottom: 10 }}>
                    {tr("profile.removeConfirm", { name: sel.name })}
                  </div>
                  <input
                    type="password"
                    value={deletePass}
                    autoFocus
                    placeholder={tr("unlock.placeholder")}
                    onChange={(e) => { setDeletePass(e.currentTarget.value); if (deleteErr) setDeleteErr(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") removeProfile(selected); if (e.key === "Escape") cancelDelete(); }}
                    style={{ width: 260, maxWidth: "100%", padding: "7px 10px", border: `1px solid ${deleteErr ? "#c0392b" : "#d9e2e6"}`, borderRadius: 8, marginBottom: 10 }}
                  />
                  {deleteErr && (
                    <div style={{ color: "#c0392b", fontSize: 12.5, marginBottom: 10 }}>{deleteErr}</div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => removeProfile(selected)}
                      disabled={!deletePass.trim()}
                      style={{ background: deletePass.trim() ? "#9a2c2c" : "#d8b6b6", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", cursor: deletePass.trim() ? "pointer" : "not-allowed" }}
                    >
                      {tr("profile.removeYes")}
                    </button>
                    <button
                      onClick={cancelDelete}
                      style={{ background: "#fff", border: "1px solid #d9e2e6", borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}
                    >
                      {tr("action.cancel")}
                    </button>
                  </div>
                </div>
              )}
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
              {lic?.licensed ? `${lic.tier} — active` : "Free / beta"}
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
          <p style={{ color: "#5a6b6d", fontSize: 12, marginTop: 8 }}>
            {tr("license.beta")}
          </p>
        </section>
      )}

      {tab === "setup" && selected && (
        <section style={cardStyle}>
          <h2 style={h2Style}>2 · Vault — {selectedName} (encrypted at rest)</h2>
          <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 760 }}>
            <tbody>
              {points.map((dp, i) => (
                <tr key={dp.key} style={{ background: i % 2 ? "#f4f8fa" : "#ffffff" }}>
                  <td style={{ padding: "7px 10px", ...mono, width: "34%", verticalAlign: "middle" }}>{dp.key}</td>
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
                        <button onClick={() => startEdit(dp)}>{tr("action.edit")}</button>{" "}
                        <button onClick={() => removePoint(dp.key)}>{tr("action.remove")}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {points.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ padding: "6px 8px", opacity: 0.6 }}>
                    No data points. Add one (key = ontology key, e.g. full_name).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <input
              placeholder="key (e.g. full_name)"
              value={k}
              onChange={(e) => setK(e.currentTarget.value)}
              style={{ padding: 8, ...mono, width: "35%" }}
            />
            <input
              placeholder="value"
              value={v}
              onChange={(e) => setV(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && addPoint()}
              style={{ padding: 8, flex: 1 }}
            />
            <button onClick={addPoint}>{tr("action.save")}</button>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <label style={{ color: "#55666f" }}>Add image (photo / signature):</label>
            <input
              placeholder="key (e.g. profile_photo, signature)"
              value={imgKey}
              onChange={(e) => setImgKey(e.currentTarget.value)}
              style={{ padding: 6, ...mono, width: "35%" }}
            />
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f && imgKey.trim()) {
                  addImagePoint(imgKey, f);
                  setImgKey("");
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #eef2f4" }}>
            <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.8 }}>
              Import a data source (passport, licence, business card…) — OCR runs on-device,
              recognised fields fill your profile
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) onDataSource(f);
                }}
              />
              {!camOn && <button onClick={startCamera}>📷 Scan with camera</button>}
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
            {ocrPct !== null && <span style={{ marginLeft: 8, fontSize: 12 }}>reading… {ocrPct}%</span>}
            {extracted.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <ul style={{ margin: "6px 0" }}>
                  {extracted.map((f) => (
                    <li key={f.ontology_key} style={mono}>
                      {f.ontology_key} = {f.value}
                    </li>
                  ))}
                </ul>
                <button onClick={saveExtracted}>Save {extracted.length} to vault</button>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === "setup" && selected && !locked && (
        <section style={cardStyle}>
          <h2 style={h2Style}>Backup &amp; transfer (encrypted)</h2>
          <p style={{ color: "#5a6b6d", fontSize: 13, marginTop: 0 }}>
            Export this profile's vault to a passphrase-encrypted file and import it on another device
            — or into the browser extension (same format). There is no plaintext export.
          </p>
          <input
            type="password"
            placeholder="backup passphrase (remember it!)"
            value={bkPass}
            onChange={(e) => setBkPass(e.currentTarget.value)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={doExport}>{tr("backup.exportEncrypted")}</button>
            <label style={{ cursor: "pointer", padding: "6px 10px", border: "1px solid #dde6e4", borderRadius: 6 }}>
              Import file…
              <input
                type="file"
                accept=".ppfvault"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) doImport(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
          {bkMsg && <p style={{ fontSize: 13 }}>{bkMsg}</p>}
        </section>
      )}

      {tab === "forms" && selected && (<>

      {selected && (
        <section style={cardStyle}>
          <h2 style={h2Style}>3 · Choose a form to fill</h2>
          <p style={{ fontSize: 12, color: "#55666f", margin: "0 0 10px" }}>
            Bring a form from <b>your device</b>, a <b>network location</b> (shared drive /
            <code>\\server\share</code>), a <b>web link</b>, or by <b>searching the web</b> — then it’s
            read and filled <b>right here on your machine</b>. Whatever the source, the form and your
            data are processed on your device — we never receive them; you send the finished form only
            where you choose.
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
            ⚠ Web search is the one thing that <b>leaves your device</b>: your search terms go to
            DuckDuckGo <b>directly</b> (device → DuckDuckGo, never via our servers, no tracking). Everything
            else — the form and your data — stays on-device. Skip this and paste a URL if you prefer.
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
            Pick a form (PDF or an image/scan). It’s handled <b>automatically</b>: if it already has form
            fields they’re filled from your vault; if it has <b>none</b>, on-device OCR detects the fields,
            creates them, and fills them — then exports a ready <code>filled.pdf</code> on your device.
            <br />
            <span style={{ opacity: 0.75 }}>
              A <b>web URL</b> is downloaded on your device (direct from the site, SSRF-guarded) then
              filled the same way. <b>Word/Excel</b> (.docx/.xlsx) forms are filled from your vault —
              named fields (content controls / named ranges) or flat labels (table cells / “Label:”
              lines) — and download as a filled file.
            </span>
          </div>
          {pdfMsg && <p style={{ fontSize: 13, color: "#0a6a60" }}>{pdfMsg}</p>}
          {pdfBytes && (
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
            <div style={{ border: "1px solid #d9e2e6", borderRadius: 10, padding: 12, marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Review &amp; edit the filled form</div>
              <p style={{ fontSize: 12, color: "#55666f", margin: "0 0 8px" }}>
                Check every value before you finalize — nothing is committed silently. Fix anything wrong
                (e.g. a mis-detected option), then <b>Apply changes</b> to re-export and update the saved copy.
              </p>
              {/* Persistent form toolbar — the SAME tools the extension exposes, in the same place:
                  on the form, always visible. Parity is the rule, not a nice-to-have. */}
              <div
                style={{
                  display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap",
                  margin: "0 0 8px", padding: "6px 8px",
                  background: "#f4f8f9", border: "1px solid #d9e2e6", borderRadius: 8,
                }}
              >
                <button onClick={() => setSigning(true)} title="Draw with the pen — colour & size, undo">✎ Pen</button>
                <button onClick={() => setSigning(true)} title="Type text anywhere on the form">T {tr("sign.text")}</button>
                <button onClick={() => setSigning(true)} title="Place your signature — move &amp; resize it">✍︎ Signature</button>
                <button onClick={() => setSigning(true)} title="Place a photo or image — move &amp; resize it">🖼 Image</button>
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
          <div style={{ marginTop: 4 }}>
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

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #eef2f4" }}>
            <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.8 }}>
              Submit online — opens the vendor page; you submit there (device → vendor, we never proxy)
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
        </section>
      )}

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
