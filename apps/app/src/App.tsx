import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { extractFromImage, type ExtractedField } from "./ocr";

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
  const [extracted, setExtracted] = useState<ExtractedField[]>([]);
  const [ocrPct, setOcrPct] = useState<number | null>(null);
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
                    <td style={{ padding: "6px 8px" }}>{f.name}</td>
                    <td style={{ padding: "6px 8px", ...mono }}>{f.ontology_key}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {f.value ?? <em style={{ color: "#b45309" }}>not in vault — add it above</em>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </main>
  );
}
