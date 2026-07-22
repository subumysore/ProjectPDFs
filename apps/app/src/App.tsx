import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { extractFromImage, type ExtractedField } from "./ocr";
import { downloadBytes, fillAndExport, generateFlatSamplePdf, imageToPdf, makeFillableAndFill, renderFirstPage } from "./pdf";
import { fillOfficeForm, officeToPdf } from "./office";
import type { OfficeKind } from "./office";
import { detectFields } from "./detect";
// SHARED registry — the desktop offers EVERY language the engine supports (not a fixed 8),
// so the universal on-device translation is actually reachable from the UI.
import { allLangs, langName } from "@engine/langcodes.js";

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
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const [baseLang, setBaseLang] = useState<Lang>("en");
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
  const [tab, setTab] = useState<"setup" | "forms" | "history">("setup");

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
  async function onDataSource(file: File) {
    setExtracted([]);
    setOcrPct(0);
    try {
      const { fields } = await extractFromImage(file, setOcrPct);
      setExtracted(fields);
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
    await autoFillForm(bytes, isImage);
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
      downloadBytes(pdf, "filled.pdf");
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
      await autoFillForm(ab, wasImage);
    } catch (e) {
      setErr(String(e));
    }
  }

  // The automatic pipeline: fill existing fields, else detect + create + fill.
  async function autoFillForm(bytes: ArrayBuffer, wasImage: boolean) {
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
        downloadBytes(existing.data, "filled.pdf");
        setPdfMsg(`This form already had ${existing.total} field(s) — filled ${existing.filled} from your vault; exported filled.pdf.`);
        return;
      }
      setPdfMsg(
        wasImage
          ? "This image has no form fields — reading it with on-device OCR…"
          : "This PDF has no form fields — detecting them with on-device OCR…",
      );
      const { fields } = await detectFields(bytes, setPdfMsg);
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
      downloadBytes(data, "filled.pdf");
      setPdfMsg(`No form fields found — created ${created} by OCR and filled ${filled} from your vault; exported filled.pdf.`);
    } catch (e) {
      setErr(String(e));
    }
  }
  async function fillPdf() {
    if (!pdfBytes) return;
    const vault = Object.fromEntries(points.map((p) => [p.key, p.value]));
    try {
      const { filled, total, data } = await fillAndExport(pdfBytes, vault);
      downloadBytes(data, "filled.pdf");
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
      const { fields, note } = await detectFields(pdfBytes, setPdfMsg);
      const vault = Object.fromEntries(points.map((p) => [p.key, p.value]));
      const { created, filled, data } = await makeFillableAndFill(pdfBytes, fields, vault);
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      setPdfBytes(ab);
      if (canvasRef.current) await renderFirstPage(ab, canvasRef.current);
      downloadBytes(data, "detected-filled.pdf");
      setPdfMsg(`${note} Created ${created}, filled ${filled} from the vault; exported detected-filled.pdf.`);
    } catch (e) {
      setErr(String(e));
    }
  }
  const selectedName = profiles.find((p) => p.id === selected)?.name;

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
        <h1 style={{ marginBottom: 4 }}>🔒 PolyglotFormFill</h1>
        <p style={{ color: "#55666f", marginTop: 0 }}>
          {hasPass ? "Enter your passphrase to unlock." : "Set a passphrase to protect your vault."}
        </p>
        <input
          type="password"
          autoFocus
          placeholder={hasPass ? "Passphrase" : "Create a passphrase (min 6 chars)"}
          value={pass}
          onChange={(e) => setPass(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitLock();
          }}
          style={{ width: "100%", padding: "10px 12px", margin: "12px 0", boxSizing: "border-box" }}
        />
        <button onClick={submitLock} style={{ padding: "10px 16px", width: "100%" }}>
          {hasPass ? "Unlock" : "Set passphrase & continue"}
        </button>
        {lockMsg && <p style={{ color: "#9a2c2c", fontSize: 13 }}>{lockMsg}</p>}
        <p style={{ color: "#8a8f92", fontSize: 12, marginTop: 20 }}>
          Your vault stays on this device, encrypted. Nobody can open the app without this passphrase.
        </p>
      </main>
    );
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 820,
        margin: "0 auto",
        padding: "36px 24px 64px",
        color: "#101a20",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ marginBottom: 2 }}>PolyglotFormFill</h1>
        <button onClick={lockNow} style={{ fontSize: 12 }}>
          🔒 Lock
        </button>
      </div>
      <p style={{ color: "#55666f", marginTop: 0 }}>
        Fill any form privately — every form is read and filled <b>entirely on your device</b>.
        We never see the form or your data; it goes <b>only where you choose to send it</b> (like
        submitting the finished form to its recipient).
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 8px", fontSize: 13 }}>
        <label htmlFor="baselang" style={{ color: "#55666f" }}>Your language:</label>
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
          your preferred language — saved with your profile so entries can be written in the form’s language.
        </span>
      </div>
      {err && (
        <p style={{ color: "#9a2c2c", cursor: "pointer" }} onClick={() => setErr("")}>
          {err} (click to dismiss)
        </p>
      )}

      <nav style={{ display: "flex", gap: 4, margin: "0 0 6px", padding: "10px 0 0", borderBottom: "2px solid #e6eeec", flexWrap: "wrap", position: "sticky", top: 0, background: "#fff", zIndex: 10 }}>
        {([["setup", "1 · Profile & Vault"], ["forms", "2 · Forms to fill"], ["history", "3 · Past forms"]] as const).map(([id, label]) => {
          const locked = id !== "setup" && !selected;
          return (
            <button key={id} onClick={() => !locked && setTab(id)} disabled={locked}
              style={{ padding: "9px 16px", border: "none", borderBottom: tab === id ? "3px solid #0d8f83" : "3px solid transparent", background: "none", fontWeight: tab === id ? 700 : 500, fontSize: 14, color: tab === id ? "#0a6a60" : "#55666f", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.4 : 1 }}>
              {label}
            </button>
          );
        })}
      </nav>
      {!selected && <p style={{ fontSize: 12, color: "#8a8f92", margin: "2px 0 10px" }}>Start here: create or pick a profile — the other steps unlock once one is selected.</p>}

      {tab === "setup" && (
      <section style={cardStyle}>
        <h2 style={h2Style}>1 · Profiles — add, choose, edit or remove</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
          <button onClick={addProfile}>Add profile</button>
        </div>
      </section>
      )}

      {tab === "setup" && !locked && (
        <section style={cardStyle}>
          <h2 style={h2Style}>License &amp; device</h2>
          <p style={{ color: "#5a6b6d", fontSize: 13, margin: "0 0 6px" }}>
            License: <b>{lic?.licensed ? `${lic.tier} (active)` : "Free / beta"}</b>
            {lic && !lic.licensed && lic.reason && lic.reason !== "no license installed" ? ` — ${lic.reason}` : ""}
            {" · "}This device: <code>{deviceId.slice(0, 12)}…</code>
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="paste your license key (PPDF1.…)"
              value={licKey}
              onChange={(e) => setLicKey(e.currentTarget.value)}
              style={{ flex: 1, minWidth: 240 }}
            />
            <button onClick={activateLicense}>Activate</button>
          </div>
          <p style={{ color: "#5a6b6d", fontSize: 11, marginTop: 6 }}>
            Free during the beta. A Pro license is bound to this device and verified offline — no server.
          </p>
        </section>
      )}

      {tab === "setup" && selected && (
        <section style={cardStyle}>
          <h2 style={h2Style}>2 · Vault — {selectedName} (encrypted at rest)</h2>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {points.map((dp) => (
                <tr key={dp.key} style={{ borderBottom: "1px solid #eef2f4" }}>
                  <td style={{ padding: "6px 8px", ...mono, width: "35%" }}>{dp.key}</td>
                  <td style={{ padding: "6px 8px" }}>
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
                  <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                    {editKey === dp.key ? (
                      <>
                        <button onClick={saveEdit}>save</button>{" "}
                        <button onClick={() => setEditKey(null)}>cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(dp)}>edit</button>{" "}
                        <button onClick={() => removePoint(dp.key)}>remove</button>
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
            <button onClick={addPoint}>Save</button>
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
                  <button onClick={stopCamera}>Cancel</button>
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
            <button onClick={doExport}>Export encrypted</button>
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
              {pdfBytes && <button onClick={fillPdf}>Fill existing fields</button>}
              {pdfBytes && <button onClick={detectAndFill}>Detect fields (OCR)</button>}
            </div>
          )}
          <div
            style={{
              marginTop: 10,
              overflow: "auto",
              maxHeight: 440,
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
          <button onClick={registerCompanion}>Register companion</button>
        </div>
        {companionMsg && <p style={{ fontSize: 13, color: "#0a6a60" }}>{companionMsg}</p>}
      </section>
      </>)}

      {tab === "history" && (
        <section style={cardStyle}>
          <h2 style={h2Style}>3 · Past filled forms</h2>
          <p style={{ color: "#55666f", fontSize: 13, marginTop: 0 }}>
            Forms you fill are exported as <code>filled.pdf</code> to your device. A running,
            versioned history of every filled form — kept encrypted on this device, so you can
            re-open, re-download, or sign any past version — is on the way.
          </p>
          <p style={{ opacity: 0.6, fontSize: 13 }}>No saved forms yet.</p>
        </section>
      )}
    </main>
  );
}
