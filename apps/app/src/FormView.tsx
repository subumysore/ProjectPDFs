import { useEffect, useRef, useState } from "react";
import { renderPageWithFields, firstFilledPage, type FormFieldBox } from "./pdf";

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
  // When a NEW (freshly-filled) document arrives, jump the preview to the first page that actually has
  // filled values — so the user immediately SEES their data instead of a blank "office use only" page 1.
  const lastBytesRef = useRef<ArrayBuffer | null>(null);
  useEffect(() => {
    if (lastBytesRef.current === bytes) return;
    lastBytesRef.current = bytes;
    let cancelled = false;
    firstFilledPage(bytes).then((p) => { if (!cancelled) setPage(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [bytes]);
  const [fit, setFit] = useState(0);
  // The form area fills the REMAINING viewport height (below the header/toolbar), so the whole app fits
  // one screen and only the FORM scrolls — never a second, outer page scroll. Recomputed on resize.
  const [availH, setAvailH] = useState(0);
  // The form renders at a natural document width (base 720). The user can zoom it in/out to taste —
  // small enough to see the whole page, or large enough to read fine print. Their choice, not fixed.
  const [zoom, setZoom] = useState(1);

  // Re-fit the page (width) AND size the scroll area to the space left under the header. Recomputed on
  // window resize AND whenever the page content above shifts (a banner appearing/removing changes the
  // form's top offset without a window resize — that staleness left the form overflowing below the fold).
  useEffect(() => {
    const measure = () => {
      const el = wrapRef.current; if (!el) return;
      const top = Math.round(el.getBoundingClientRect().top);
      const w = el.clientWidth;
      // Only setState when a value actually changed, so the 250ms poll below is a cheap no-op at rest.
      setFit((prev) => (prev !== w ? w : prev));
      setAvailH((prev) => { const next = Math.max(300, Math.round(window.innerHeight - top - 16)); return Math.abs(prev - next) > 1 ? next : prev; });
    };
    measure();
    window.addEventListener("resize", measure);
    // A ResizeObserver only fires on SIZE changes; the form's top offset also moves when the header
    // above it shrinks/grows (no size change of the observed node), which left availH stale. A light
    // poll (250ms, self-cancelling to a no-op via the guards above) makes the fit robust to ANY layout
    // change — general, not per-form/per-window.
    const ro = new ResizeObserver(() => measure());
    if (document.body) ro.observe(document.body);
    const iv = setInterval(measure, 250);
    return () => { window.removeEventListener("resize", measure); ro.disconnect(); clearInterval(iv); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!canvasRef.current) return;
      setBusy(true);
      try {
        // Fit the page to the panel, but CAP the width so the form renders at a natural document
        // size (like a page on screen) instead of being stretched 2–3× the app's own text and controls.
        // Load the form as large as the panel allows (up to a full-page ~960px base), so it isn't a
        // tiny truncated thumbnail. The user can still zoom in/out from here.
        const panel = (fit || wrapRef.current?.clientWidth || 0) - 4;
        // Render close to the panel width (up to ~1180px base) so the form fills the space instead of
        // floating in whitespace. Zoom still scales from there.
        const avail = Math.min(panel, Math.round(1180 * zoom));
        const r = await renderPageWithFields(bytes, page, canvasRef.current, 1.3, avail > 100 ? avail : undefined);
        if (cancelled) return;
        setFields(r.fields);
        setDims({ w: r.width, h: r.height });
        setNumPages(r.numPages);
      } catch {
        if (!cancelled) {
          setFields([]);
          // renderPageWithFields can DRAW the page and then throw while reading annotations of a
          // malformed saved PDF (hybrid-XFA saveDocument output has broken object refs). The canvas is
          // already sized + painted, so size the page-container from the canvas itself — otherwise it
          // collapses to 0 height and the whole form appears blank even though it rendered.
          const c = canvasRef.current;
          if (c && c.width > 1 && c.height > 1) { setDims({ w: c.width, h: c.height }); setNumPages((n) => n || 1); }
        }
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

  const btn: React.CSSProperties = {
    padding: "6px 12px", border: "1px solid #b7c4cc", borderRadius: 8,
    background: "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(232,240,242,0.9) 100%)",
    color: "#22343a", fontWeight: 650, cursor: "pointer",
    boxShadow: "0 1px 3px rgba(35,55,60,0.16), inset 0 1px 0 rgba(255,255,255,0.75)",
  };
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", margin: "0 0 8px", fontSize: 13 }}>
        {numPages > 1 && (
          <>
            <button style={btn} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>‹ Prev</button>
            <span>Page {page + 1} / {numPages}</span>
            <button style={btn} onClick={() => setPage((p) => Math.min(numPages - 1, p + 1))} disabled={page === numPages - 1}>Next ›</button>
          </>
        )}
        <span style={{ color: "#55666f" }}>
          {busy ? "Rendering the form…" : `${fields.length} field(s) on this page — type straight onto the form`}
          {showTranslated && " · showing your language (reading aid — the saved file keeps the original)"}
        </span>
        {/* User-controlled zoom — resize the form to taste. */}
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center", marginLeft: "auto" }}>
          <button style={btn} onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} disabled={zoom <= 0.5} title="Zoom out">−</button>
          <span style={{ minWidth: 42, textAlign: "center", color: "#55666f", fontWeight: 700 }}>{Math.round(zoom * 100)}%</span>
          <button style={btn} onClick={() => setZoom((z) => Math.min(2.5, Math.round((z + 0.1) * 10) / 10))} disabled={zoom >= 2.5} title="Zoom in">+</button>
          {zoom !== 1 && <button style={btn} onClick={() => setZoom(1)} title="Reset zoom">Reset</button>}
        </span>
      </div>
      <div ref={wrapRef} style={{ overflow: "auto", height: availH || undefined, maxHeight: availH ? undefined : "78vh", border: "1px solid #eef2f4", borderRadius: 8, paddingBottom: dims.h ? 24 : 0, boxSizing: "border-box" }}>
        <div style={{ position: "relative", width: dims.w, height: dims.h, margin: "0 auto" }}>
          {/* Pin the canvas DISPLAY size to the render dims so it exactly matches the field-overlay
              coordinate space — independent of the drawing-buffer size or device pixel ratio. */}
          <canvas ref={canvasRef} style={{ position: "absolute", left: 0, top: 0, width: dims.w || undefined, height: dims.h || undefined, background: "#fff" }} />
          {fields.map((f) => {
            const cur = edits[f.name] ?? f.value;
            const shown = showTranslated && values[f.name] ? values[f.name] : cur;
            const title = labels[f.name] ? `${labels[f.name]} (${f.name})` : f.name;
            return (
              <div key={f.name + f.left + f.top} style={box(f)} title={title}>
                {f.kind === "check" ? (
                  // BOLD, unmistakable checkbox: a thick teal box the user can clearly see and click;
                  // fills solid teal with a white ✓ when checked. (A bare 16px native checkbox over the
                  // printed box was too faint to notice.)
                  (() => { const on = cur === "Yes" || cur === "On"; return (
                    <div
                      role="checkbox" aria-checked={on} tabIndex={0}
                      onClick={() => onEdit(f.name, on ? "Off" : "Yes")}
                      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onEdit(f.name, on ? "Off" : "Yes"); } }}
                      title={title}
                      style={{
                        width: "100%", height: "100%", boxSizing: "border-box",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: "2px solid #0d8f83", borderRadius: 3,
                        background: on ? "#0d8f83" : "rgba(13,143,131,0.16)",
                        color: "#fff", fontWeight: 900, lineHeight: 1, cursor: "pointer",
                        fontSize: Math.max(11, Math.min(f.width, f.height) * 0.9),
                        boxShadow: "0 0 0 1px rgba(255,255,255,0.7)",
                      }}
                    >{on ? "✓" : ""}</div>
                  ); })()
                ) : f.kind === "radio" && f.optionValue ? (
                  // One widget = one option of the group. A clear teal RING with a filled dot when chosen.
                  (() => { const on = cur === f.optionValue; return (
                    <div
                      role="radio" aria-checked={on} tabIndex={0}
                      onClick={() => onEdit(f.name, f.optionValue!)}
                      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onEdit(f.name, f.optionValue!); } }}
                      title={`${f.name}: ${f.optionValue}`}
                      style={{
                        width: "100%", height: "100%", boxSizing: "border-box",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: "2px solid #0d8f83", borderRadius: "50%",
                        background: "rgba(13,143,131,0.16)", cursor: "pointer",
                        boxShadow: "0 0 0 1px rgba(255,255,255,0.7)",
                      }}
                    >{on && <span style={{ width: "58%", height: "58%", borderRadius: "50%", background: "#0d8f83", display: "block" }} />}</div>
                  ); })()
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
