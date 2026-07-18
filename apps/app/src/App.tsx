import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { extractFromImage, type ExtractedField } from "./ocr";
import { downloadBytes, fillAndExport, generateFlatSamplePdf, imageToPdf, makeFillableAndFill, renderFirstPage } from "./pdf";
import { fillOfficeForm, officeToPdf } from "./office";
import type { OfficeKind } from "./office";
import { detectFields } from "./detect";
import { translate } from "./translate";

interface Profile {
  id: string;
  name: string;
}
interface DataPoint {
  key: string;
  value: string;
}
interface CatalogSummary {
  id: string;
  name: string;
  kind: string;
  tags: string[];
}
interface FilledField {
  name: string;
  ontology_key: string;
  value: string | null;
}
interface AutofillResult {
  entry: { id: string; name: string };
  filled: FilledField[];
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
 * ProjectPDFs — Phase-1 shell. All on-device: Profiles + encrypted DataPoints in
 * the SQLite vault (core-store), catalog search + field-maps (core-catalog).
 * Pick a profile, find a form, and autofill it from that profile's vault.
 */
export function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [points, setPoints] = useState<DataPoint[]>([]);
  const [newProfile, setNewProfile] = useState("");
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSummary[]>([]);
  const [form, setForm] = useState<CatalogSummary | null>(null);
  const [autofill, setAutofill] = useState<AutofillResult | null>(null);
  const [saved, setSaved] = useState<SaveInfo | null>(null);
  const [signInfo, setSignInfo] = useState<SignInfo | null>(null);
  const [translated, setTranslated] = useState<Record<string, string>>({});
  const [transMsg, setTransMsg] = useState("");
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
  const [submitUrl, setSubmitUrl] = useState("");
  const [submitMsg, setSubmitMsg] = useState("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [err, setErr] = useState("");

  const guard = (p: Promise<unknown>) => p.catch((e) => setErr(String(e)));

  const refreshProfiles = () => guard(invoke<Profile[]>("list_profiles").then(setProfiles));
  const loadPoints = (id: string) =>
    guard(invoke<DataPoint[]>("list_data_points", { profileId: id }).then(setPoints));
  const doSearch = (q: string) => {
    setQuery(q);
    guard(invoke<CatalogSummary[]>("catalog_search", { query: q }).then(setResults));
  };

  useEffect(() => {
    refreshProfiles();
    doSearch("");
  }, []);

  function selectProfile(id: string) {
    setSelected(id);
    setAutofill(null);
    loadPoints(id);
  }
  function selectForm(f: CatalogSummary) {
    setForm(f);
    setAutofill(null);
  }
  function runAutofill() {
    if (!selected || !form) return;
    setSaved(null);
    guard(
      invoke<AutofillResult>("autofill_for", { profileId: selected, entryId: form.id }).then(setAutofill),
    );
  }
  function saveForm() {
    if (!selected || !form) return;
    setSignInfo(null);
    guard(
      invoke<SaveInfo>("save_filled_form", { profileId: selected, entryId: form.id }).then(setSaved),
    );
  }
  function signForm() {
    if (!selected || !form) return;
    guard(invoke<SignInfo>("sign_form", { profileId: selected, entryId: form.id }).then(setSignInfo));
  }
  async function translateLabels() {
    if (!autofill) return;
    setTransMsg("translating on-device…");
    try {
      const map: Record<string, string> = {};
      for (const f of autofill.filled) {
        map[f.ontology_key] = await translate(f.name, "en-hi", setTransMsg);
      }
      setTranslated(map);
      setTransMsg("Translated on-device (English → हिन्दी).");
    } catch (e) {
      setErr(String(e));
      setTransMsg("");
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
  async function addPoint() {
    if (!selected || !k.trim()) return;
    await guard(invoke("upsert_data_point", { profileId: selected, key: k.trim(), value: v }));
    setK("");
    setV("");
    loadPoints(selected);
  }
  async function removePoint(key: string) {
    if (!selected) return;
    await guard(invoke("delete_data_point", { profileId: selected, key }));
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
          "No fields could be detected automatically. If this is a known form, search & select it above, then use “Make fillable (catalog coords)”.",
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
  async function makeFillable() {
    if (!pdfBytes || !form) {
      setPdfMsg("Open/generate a PDF and select a form (section 3) first.");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry: any = await invoke("catalog_get", { entryId: form.id });
      const vault = Object.fromEntries(points.map((p) => [p.key, p.value]));
      const { created, filled, data } = await makeFillableAndFill(pdfBytes, entry.field_map.fields, vault);
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      setPdfBytes(ab);
      if (canvasRef.current) await renderFirstPage(ab, canvasRef.current);
      downloadBytes(data, "fillable-filled.pdf");
      setPdfMsg(
        created === 0
          ? "This form has no placement coordinates in the catalog yet (needs curation/OCR detection)."
          : `Created ${created} form fields at their coordinates, filled ${filled} from the vault, and exported fillable-filled.pdf.`,
      );
    } catch (e) {
      setErr(String(e));
    }
  }

  const selectedName = profiles.find((p) => p.id === selected)?.name;

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
      <h1 style={{ marginBottom: 2 }}>ProjectPDFs</h1>
      <p style={{ color: "#55666f", marginTop: 0 }}>
        Privacy-first, on-device form autofill — your data never leaves this device.
      </p>
      {err && (
        <p style={{ color: "#9a2c2c", cursor: "pointer" }} onClick={() => setErr("")}>
          {err} (click to dismiss)
        </p>
      )}

      <section style={cardStyle}>
        <h2 style={h2Style}>1 · Profiles</h2>
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
            placeholder="New profile name (e.g. Asha)"
            value={newProfile}
            onChange={(e) => setNewProfile(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addProfile()}
            style={{ padding: 8, flex: 1 }}
          />
          <button onClick={addProfile}>Add profile</button>
        </div>
      </section>

      {selected && (
        <section style={cardStyle}>
          <h2 style={h2Style}>2 · Vault — {selectedName} (encrypted at rest)</h2>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {points.map((dp) => (
                <tr key={dp.key} style={{ borderBottom: "1px solid #eef2f4" }}>
                  <td style={{ padding: "6px 8px", ...mono, width: "35%" }}>{dp.key}</td>
                  <td style={{ padding: "6px 8px" }}>{dp.value}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>
                    <button onClick={() => removePoint(dp.key)}>remove</button>
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

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #eef2f4" }}>
            <div style={{ fontSize: 13, marginBottom: 6, opacity: 0.8 }}>
              Import a data source (passport, licence…) — OCR runs on-device
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) onDataSource(f);
              }}
            />
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

      <section style={cardStyle}>
        <h2 style={h2Style}>3 · Find a form (on-device search)</h2>
        <input
          placeholder="Search forms by name or tag (e.g. passport, kyc, identity)…"
          value={query}
          onChange={(e) => doSearch(e.currentTarget.value)}
          style={{ padding: 8, width: "100%", boxSizing: "border-box" }}
        />
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => selectForm(r)}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 8,
                border: form?.id === r.id ? "2px solid #0d8f83" : "1px solid #d9e2e6",
                background: form?.id === r.id ? "#e2f2f0" : "#fff",
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 600 }}>{r.name}</div>
              <div style={{ fontSize: 12, opacity: 0.6, ...mono }}>
                {r.kind} · {r.tags.join(", ")}
              </div>
            </button>
          ))}
          {results.length === 0 && <span style={{ opacity: 0.6 }}>No forms match.</span>}
        </div>
      </section>

      {selected && form && (
        <section style={cardStyle}>
          <h2 style={h2Style}>4 · Autofill</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={runAutofill}>
              Autofill “{form.name}” from {selectedName}
            </button>
            {autofill && <button onClick={saveForm}>Save (new version)</button>}
            {saved && (
              <span style={{ color: "#0a6a60", fontSize: 13 }}>
                Saved version {saved.version_no} · {saved.saves} save(s), encrypted on-device
              </span>
            )}
            {saved && <button onClick={signForm}>Sign (device key)</button>}
          </div>
          {signInfo && (
            <p style={{ color: "#0a6a60", fontSize: 13, ...mono }}>
              ✓ Signed v{signInfo.version_no} · signer {signInfo.signer_public.slice(0, 16)}… · doc{" "}
              {signInfo.doc_hash.slice(0, 12)}… (non-delegable, on-device Ed25519)
            </p>
          )}
          {autofill && (
            <>
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={translateLabels}>Translate labels → हिन्दी (on-device)</button>
                {transMsg && <span style={{ fontSize: 12, color: "#55666f" }}>{transMsg}</span>}
              </div>
            <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #d9e2e6" }}>
                  <th style={{ padding: "6px 8px" }}>Field</th>
                  <th style={{ padding: "6px 8px" }}>Ontology key</th>
                  <th style={{ padding: "6px 8px" }}>Value</th>
                </tr>
              </thead>
              <tbody>
                {autofill.filled.map((f) => (
                  <tr key={f.ontology_key} style={{ borderBottom: "1px solid #eef2f4" }}>
                    <td style={{ padding: "6px 8px" }}>
                      {f.name}
                      {translated[f.ontology_key] && (
                        <span style={{ color: "#0a6a60", marginLeft: 6 }}>({translated[f.ontology_key]})</span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px", ...mono }}>{f.ontology_key}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {f.value ?? <em style={{ color: "#b45309" }}>not in vault — add it above</em>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </>
          )}
        </section>
      )}

      {selected && (
        <section style={cardStyle}>
          <h2 style={h2Style}>5 · Fill a Form (on-device)</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontSize: 13, opacity: 0.8 }}>Open a form from this device:</label>
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
            creates them, and fills them — then exports a ready <code>filled.pdf</code>. Nothing is uploaded.
            <br />
            <span style={{ opacity: 0.75 }}>
              A <b>web URL</b> is downloaded on-device (direct from the site, SSRF-guarded) then filled the
              same way. <b>Word/Excel</b> (.docx/.xlsx) forms are filled from your vault — named fields
              (content controls / named ranges) or flat labels (table cells / “Label:” lines) — and
              download as a filled file. For a <b>known</b> form, search &amp;
              select it in step 3 first so exact catalog coordinates are used.
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
              {pdfBytes && <button onClick={makeFillable}>Make fillable (catalog coords)</button>}
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
    </main>
  );
}
