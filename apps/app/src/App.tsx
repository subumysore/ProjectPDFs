import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Profile {
  id: string;
  name: string;
}
interface DataPoint {
  key: string;
  value: string;
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

const card: React.CSSProperties = {
  border: "1px solid #d9e2e6",
  borderRadius: 12,
  padding: 16,
  marginTop: 16,
};
const h2: React.CSSProperties = {
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  opacity: 0.6,
  margin: "0 0 10px",
};
const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };

/**
 * ProjectPDFs — Phase-1 vault manager. Everything here is on-device: Profiles
 * and their DataPoints live in the SQLite vault (core-store), and "autofill"
 * fills a catalogued form's field-map from the selected profile (core-catalog).
 */
export function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [points, setPoints] = useState<DataPoint[]>([]);
  const [newProfile, setNewProfile] = useState("");
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const [autofill, setAutofill] = useState<AutofillResult | null>(null);
  const [err, setErr] = useState("");

  const guard = (p: Promise<unknown>) => p.catch((e) => setErr(String(e)));

  const refreshProfiles = () =>
    guard(invoke<Profile[]>("list_profiles").then(setProfiles));

  const loadPoints = (id: string) =>
    guard(invoke<DataPoint[]>("list_data_points", { profileId: id }).then(setPoints));

  useEffect(() => {
    refreshProfiles();
  }, []);

  function selectProfile(id: string) {
    setSelected(id);
    setAutofill(null);
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

  async function removePoint(key: string) {
    if (!selected) return;
    await guard(invoke("delete_data_point", { profileId: selected, key }));
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
        <p style={{ color: "#9a2c2c" }} onClick={() => setErr("")}>
          {err} (click to dismiss)
        </p>
      )}

      <section style={card}>
        <h2 style={h2}>Profiles</h2>
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
        <section style={card}>
          <h2 style={h2}>Vault — {selectedName}</h2>
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
                    No data points. Add one below (key = ontology key, e.g. full_name).
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
        </section>
      )}

      {selected && (
        <section style={card}>
          <h2 style={h2}>Catalog-first autofill</h2>
          <button onClick={() => guard(invoke<AutofillResult>("autofill_for", { profileId: selected }).then(setAutofill))}>
            Autofill "Sample Passport Application" from this profile
          </button>
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
