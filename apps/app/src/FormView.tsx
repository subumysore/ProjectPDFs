import { useEffect, useRef, useState } from "react";
import { renderPageWithFields, type FormFieldBox } from "./pdf";

/**
 * The form itself, editable in place. The page is rendered and real inputs are laid exactly over
 * each field, so filling/correcting feels like working ON the form — not on a separate key/value list.
 *
 * Language rule (etched): when `showTranslated` is on the user reads the WHOLE form — labels and
 * values — in their language. That view is a READING AID and is never saved; the exported file
 * always keeps the form's original language.
 */
export interface FormViewProps {
  bytes: ArrayBuffer;
  edits: Record<string, string>;
  onEdit: (name: string, value: string) => void;
  /** field name -> label translated into the user's language (tooltip / caption) */
  labels?: Record<string, string>;
  /** field name -> value translated into the user's language (shown only while reading) */
  values?: Record<string, string>;
  showTranslated?: boolean;
}

export function FormView({ bytes, edits, onEdit, labels = {}, values = {}, showTranslated = false }: FormViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [fields, setFields] = useState<FormFieldBox[]>([]);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [busy, setBusy] = useState(true);
  const [fit, setFit] = useState(0);
  // The form renders at a natural document width (base 720). The user can zoom it in/out to taste —
  // small enough to see the whole page, or large enough to read fine print. Their choice, not fixed.
  const [zoom, setZoom] = useState(1);

  // Re-fit the page whenever the window (and so the panel) changes size.
  useEffect(() => {
    const measure = () => setFit(wrapRef.current?.clientWidth ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!canvasRef.current) return;
      setBusy(true);
      try {
        // Fit the page to the panel, but CAP the width so the form renders at a natural document
        // size (like a page on screen) instead of being stretched 2–3× the app's own text and controls.
        const panel = (fit || wrapRef.current?.clientWidth || 0) - 4;
        const avail = Math.min(panel, Math.round(720 * zoom));
        const r = await renderPageWithFields(bytes, page, canvasRef.current, 1.3, avail > 100 ? avail : undefined);
        if (cancelled) return;
        setFields(r.fields);
        setDims({ w: r.width, h: r.height });
        setNumPages(r.numPages);
      } catch {
        if (!cancelled) setFields([]);
      }
      if (!cancelled) setBusy(false);
    })();
    return () => { cancelled = true; };
  }, [bytes, page, fit, zoom]);

  const box = (f: FormFieldBox): React.CSSProperties => ({
    position: "absolute",
    left: f.left,
    top: f.top,
    width: f.width,
    height: f.height,
    boxSizing: "border-box",
  });
  const inputStyle = (f: FormFieldBox): React.CSSProperties => ({
    width: "100%",
    height: "100%",
    boxSizing: "border-box",
    border: "1px solid rgba(13,143,131,0.55)",
    background: showTranslated ? "rgba(226,242,240,0.85)" : "rgba(226,242,240,0.45)",
    color: "#101a20",
    font: `${Math.max(9, Math.min(15, f.height * 0.62))}px system-ui, sans-serif`,
    padding: "0 3px",
    borderRadius: 2,
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", margin: "0 0 8px", fontSize: 13 }}>
        {numPages > 1 && (
          <>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>‹ Prev</button>
            <span>Page {page + 1} / {numPages}</span>
            <button onClick={() => setPage((p) => Math.min(numPages - 1, p + 1))} disabled={page === numPages - 1}>Next ›</button>
          </>
        )}
        <span style={{ color: "#55666f" }}>
          {busy ? "Rendering the form…" : `${fields.length} field(s) on this page — type straight onto the form`}
          {showTranslated && " · showing your language (reading aid — the saved file keeps the original)"}
        </span>
        {/* User-controlled zoom — resize the form to taste. */}
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center", marginLeft: "auto" }}>
          <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} disabled={zoom <= 0.5} title="Zoom out">−</button>
          <span style={{ minWidth: 42, textAlign: "center", color: "#55666f" }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))} disabled={zoom >= 2.5} title="Zoom in">+</button>
          {zoom !== 1 && <button onClick={() => setZoom(1)} title="Reset zoom">Reset</button>}
        </span>
      </div>
      <div ref={wrapRef} style={{ overflow: "auto", maxHeight: "78vh", border: "1px solid #eef2f4", borderRadius: 8 }}>
        <div style={{ position: "relative", width: dims.w, height: dims.h, margin: "0 auto" }}>
          <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0, background: "#fff" }} />
          {fields.map((f) => {
            const cur = edits[f.name] ?? f.value;
            const shown = showTranslated && values[f.name] ? values[f.name] : cur;
            const title = labels[f.name] ? `${labels[f.name]} (${f.name})` : f.name;
            return (
              <div key={f.name + f.left + f.top} style={box(f)} title={title}>
                {f.kind === "check" ? (
                  <input
                    type="checkbox"
                    checked={cur === "Yes" || cur === "On"}
                    onChange={(e) => onEdit(f.name, e.currentTarget.checked ? "Yes" : "Off")}
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : f.kind === "radio" && f.optionValue ? (
                  // One widget = one option of the group. Render an actual radio dot, filled when the
                  // group's value equals this widget's export value — so the chosen option is obvious.
                  <input
                    type="radio"
                    name={f.name}
                    checked={cur === f.optionValue}
                    onChange={() => onEdit(f.name, f.optionValue!)}
                    title={`${f.name}: ${f.optionValue}`}
                    style={{ width: "100%", height: "100%", margin: 0, accentColor: "#0d8f83" }}
                  />
                ) : f.kind === "dropdown" || f.kind === "radio" ? (
                  <select value={cur} onChange={(e) => onEdit(f.name, e.currentTarget.value)} style={inputStyle(f)}>
                    <option value="">—</option>
                    {(f.options ?? []).filter(Boolean).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : typeof shown === "string" && shown.startsWith("data:image") ? (
                  // A photo/signature: DRAW the image in its box, not the raw base64 text.
                  <img src={shown} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff" }} />
                ) : (
                  <input
                    value={shown}
                    readOnly={showTranslated}
                    onChange={(e) => onEdit(f.name, e.currentTarget.value)}
                    style={inputStyle(f)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
