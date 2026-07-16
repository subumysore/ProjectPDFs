import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CoreModules {
  modules: string[];
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

/**
 * Phase-1 app shell. Proves the UI <-> Rust-core bridge is wired: it asks the
 * native core which modules are compiled in, and runs a round-trip command.
 * Real screens (catalog search, fill overlay, signing) land per their specs.
 */
export function App() {
  const [modules, setModules] = useState<string[]>([]);
  const [greeting, setGreeting] = useState("");
  const [name, setName] = useState("ProjectPDFs");
  const [autofill, setAutofill] = useState<AutofillResult | null>(null);

  useEffect(() => {
    invoke<CoreModules>("core_modules")
      .then((r) => setModules(r.modules))
      .catch((e) => setModules([`error: ${String(e)}`]));
  }, []);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 760,
        margin: "0 auto",
        padding: "40px 24px",
        color: "#101a20",
      }}
    >
      <h1 style={{ marginBottom: 4 }}>ProjectPDFs</h1>
      <p style={{ color: "#55666f", marginTop: 0 }}>
        Privacy-first, on-device form autofill. Phase-1 shell (UI ↔ Rust core wired).
      </p>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 15, textTransform: "uppercase", opacity: 0.6 }}>
          Native core modules
        </h2>
        <ul>
          {modules.map((m) => (
            <li key={m} style={{ fontFamily: "ui-monospace, monospace" }}>
              {m}
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 20 }}>
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          style={{ padding: 8, marginRight: 8 }}
        />
        <button onClick={() => invoke<string>("greet", { name }).then(setGreeting)}>
          Call Rust core
        </button>
        {greeting && <p>{greeting}</p>}
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 15, textTransform: "uppercase", opacity: 0.6 }}>
          Catalog-first autofill (demo)
        </h2>
        <button onClick={() => invoke<AutofillResult>("demo_autofill").then(setAutofill)}>
          Match a catalogued form &amp; autofill from vault
        </button>
        {autofill && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: "#55666f", marginTop: 0 }}>
              Form: <strong>{autofill.entry.name}</strong>
            </p>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
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
                    <td style={{ padding: "6px 8px", fontFamily: "ui-monospace, monospace" }}>
                      {f.ontology_key}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {f.value ?? (
                        <em style={{ color: "#b45309" }}>not in vault — add it</em>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
