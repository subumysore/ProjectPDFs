import { useEffect, useRef, useState, useCallback } from "react";
import { renderPage, flattenOverlays } from "./pdf";

// A desktop Sign / annotate tool with parity to the extension's sign.html:
//   • Pen (freehand) with pen COLOR + pen SIZE
//   • Text (click to type onto the form)
//   • Stamp (place ANY saved vault image) — each placement is MOVABLE + RESIZABLE + deletable
//   • Undo (button + Ctrl/Cmd+Z, 40 steps) and Clear
//   • Multi-page: per-page ink + placements, flattened 1:1 into the PDF on export.
// Everything runs on-device; the overlay is flattened into the PDF via the shared engine.

export interface Stamp {
  key: string;
  src: string; // data-URL image
}
export interface SignPadProps {
  pdfBytes: ArrayBuffer;
  stamps: Stamp[];
  onExport: (bytes: Uint8Array) => void;
  onClose: () => void;
}

interface Placement {
  id: number;
  page: number;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
type Tool = "pen" | "text";
interface Snapshot {
  ink: ImageData | null;
  placements: Placement[];
}

export function SignPad({ pdfBytes, stamps, onExport, onClose }: SignPadProps) {
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const inkRef = useRef<HTMLCanvasElement | null>(null);
  const storesRef = useRef<Record<number, ImageData>>({}); // per-page ink raster
  const undoRef = useRef<Snapshot[]>([]);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const nextId = useRef(1);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#0b1f66");
  const [size, setSize] = useState(4);
  const [stampSrc, setStampSrc] = useState<string | null>(null); // chosen stamp to place next
  const [page, setPage] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState("");

  const inkCtx = () => inkRef.current?.getContext("2d") ?? null;

  // Save/restore the current page's ink raster when switching pages.
  const stashInk = useCallback(() => {
    const ctx = inkCtx();
    if (ctx && inkRef.current) storesRef.current[page] = ctx.getImageData(0, 0, inkRef.current.width, inkRef.current.height);
  }, [page]);

  // Render a page: draw the PDF into bg, size the ink canvas to match, restore that page's ink.
  const showPage = useCallback(async (p: number) => {
    if (!bgRef.current || !inkRef.current) return;
    const info = await renderPage(pdfBytes, p, bgRef.current, 1.3);
    setNumPages(info.numPages);
    setDims({ w: info.width, h: info.height });
    inkRef.current.width = info.width;
    inkRef.current.height = info.height;
    const ctx = inkCtx();
    if (ctx) {
      ctx.clearRect(0, 0, info.width, info.height);
      const saved = storesRef.current[p];
      if (saved) ctx.putImageData(saved, 0, 0);
    }
  }, [pdfBytes]);

  useEffect(() => { showPage(0); /* eslint-disable-next-line */ }, []);

  function pushUndo() {
    const ctx = inkCtx();
    const ink = ctx && inkRef.current ? ctx.getImageData(0, 0, inkRef.current.width, inkRef.current.height) : null;
    undoRef.current.push({ ink, placements: placements.map((p) => ({ ...p })) });
    if (undoRef.current.length > 40) undoRef.current.shift();
  }
  function doUndo() {
    const snap = undoRef.current.pop();
    if (!snap) return;
    const ctx = inkCtx();
    if (ctx && inkRef.current) {
      ctx.clearRect(0, 0, inkRef.current.width, inkRef.current.height);
      if (snap.ink) ctx.putImageData(snap.ink, 0, 0);
      storesRef.current[page] = ctx.getImageData(0, 0, inkRef.current.width, inkRef.current.height);
    }
    setPlacements(snap.placements);
    setSelected(null);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selected != null) { e.preventDefault(); deleteSelected(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, [selected, placements, page]);

  function relPos(e: React.PointerEvent) {
    const r = inkRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (inkRef.current!.width / r.width), y: (e.clientY - r.top) * (inkRef.current!.height / r.height) };
  }

  // ---- Pen / Text / place-Stamp on the ink layer -------------------------------------------
  function onInkDown(e: React.PointerEvent) {
    if (stampSrc) { // placing an image stamp
      pushUndo();
      const p = relPos(e);
      const img = new Image();
      img.onload = () => {
        const w = 180; const h = Math.max(40, (img.height / img.width) * w);
        const id = nextId.current++;
        setPlacements((ps) => [...ps, { id, page, src: stampSrc, x: p.x - w / 2, y: p.y - h / 2, w, h }]);
        setSelected(id);
      };
      img.src = stampSrc;
      setStampSrc(null); // ONE-SHOT — reverts to pen so a later click can't duplicate it
      setTool("pen");
      return;
    }
    setSelected(null);
    const ctx = inkCtx(); if (!ctx) return;
    const p = relPos(e);
    if (tool === "text") {
      const txt = window.prompt("Text to place on the form:");
      if (txt) { pushUndo(); ctx.fillStyle = color; ctx.textBaseline = "top"; ctx.font = `${Math.max(11, size * 4.5)}px system-ui, sans-serif`; ctx.fillText(txt, p.x, p.y); stashInk(); }
      return;
    }
    pushUndo();
    drawingRef.current = true; lastRef.current = p;
    ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = "round"; ctx.lineJoin = "round";
  }
  function onInkMove(e: React.PointerEvent) {
    if (!drawingRef.current) return;
    const ctx = inkCtx(); if (!ctx || !lastRef.current) return;
    const p = relPos(e);
    ctx.beginPath(); ctx.moveTo(lastRef.current.x, lastRef.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    lastRef.current = p;
  }
  function onInkUp() { if (drawingRef.current) { drawingRef.current = false; lastRef.current = null; stashInk(); } }

  // ---- Placement move / resize (image stamps) ----------------------------------------------
  function startDrag(e: React.PointerEvent, id: number, mode: "move" | "resize") {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(id);
    pushUndo();
    const start = { x: e.clientX, y: e.clientY };
    const pl = placements.find((p) => p.id === id)!;
    const scale = inkRef.current!.width / inkRef.current!.getBoundingClientRect().width;
    const orig = { ...pl };
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) * scale;
      const dy = (ev.clientY - start.y) * scale;
      setPlacements((ps) => ps.map((p) => {
        if (p.id !== id) return p;
        if (mode === "move") return { ...p, x: orig.x + dx, y: orig.y + dy };
        const w = Math.max(24, orig.w + dx);
        return { ...p, w, h: Math.max(16, orig.h * (w / orig.w)) }; // keep aspect
      }));
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  function deleteSelected() {
    if (selected == null) return;
    pushUndo();
    setPlacements((ps) => ps.filter((p) => p.id !== selected));
    setSelected(null);
  }

  async function changePage(to: number) {
    if (to < 0 || to >= numPages) return;
    stashInk();
    setSelected(null);
    setPage(to);
    await showPage(to);
  }

  function clearPage() {
    pushUndo();
    const ctx = inkCtx();
    if (ctx && inkRef.current) ctx.clearRect(0, 0, inkRef.current.width, inkRef.current.height);
    stashInk();
    setPlacements((ps) => ps.filter((p) => p.page !== page));
    setSelected(null);
  }

  // ---- Export: composite each page's ink + placements into a PNG overlay, then flatten -----
  async function doExport() {
    setBusy("Flattening your annotations into the PDF…");
    stashInk();
    try {
      const overlays: Record<number, string> = {};
      for (let p = 0; p < numPages; p++) {
        const ink = storesRef.current[p];
        const pagePlacements = placements.filter((pl) => pl.page === p);
        if (!ink && pagePlacements.length === 0) continue;
        // Composite at the page's rendered size (overlay maps 1:1 to the page on flatten).
        const c = document.createElement("canvas");
        if (ink) { c.width = ink.width; c.height = ink.height; } else { c.width = dims.w; c.height = dims.h; }
        const ctx = c.getContext("2d")!;
        if (ink) ctx.putImageData(ink, 0, 0);
        for (const pl of pagePlacements) {
          const img = await loadImg(pl.src);
          ctx.drawImage(img, pl.x, pl.y, pl.w, pl.h);
        }
        overlays[p] = c.toDataURL("image/png");
      }
      const out = await flattenOverlays(new Uint8Array(pdfBytes), overlays);
      onExport(out);
    } catch (e) {
      setBusy(`Couldn’t export: ${String(e)}`);
      return;
    }
    setBusy("");
  }

  const pagePlacements = placements.filter((p) => p.page === page);
  const btn = (on: boolean): React.CSSProperties => ({
    padding: "6px 10px", borderRadius: 6, cursor: "pointer",
    border: on ? "2px solid #0d8f83" : "1px solid #d9e2e6", background: on ? "#e2f2f0" : "#fff",
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,28,30,0.55)", zIndex: 50, display: "flex", flexDirection: "column", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ marginRight: 6 }}>Sign / annotate</b>
        <button style={btn(tool === "pen" && !stampSrc)} onClick={() => { setTool("pen"); setStampSrc(null); }}>✒︎ Pen</button>
        <button style={btn(tool === "text" && !stampSrc)} onClick={() => { setTool("text"); setStampSrc(null); }}>🅣 Text</button>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
          Color <input type="color" value={color} onChange={(e) => setColor(e.currentTarget.value)} />
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
          Size <input type="range" min={1} max={24} value={size} onChange={(e) => setSize(Number(e.currentTarget.value))} />
          <span style={{ width: 18 }}>{size}</span>
        </label>
        {stamps.length > 0 && <span style={{ fontSize: 12, color: "#55666f" }}>Stamp:</span>}
        {stamps.map((s) => (
          <button key={s.key} title={s.key} style={btn(stampSrc === s.src)} onClick={() => { setStampSrc(s.src); }}>
            <img src={s.src} alt={s.key} style={{ height: 22, verticalAlign: "middle" }} /> {s.key}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button style={btn(false)} onClick={doUndo}>↶ Undo</button>
        <button style={btn(false)} onClick={clearPage}>Clear page</button>
        {selected != null && <button style={btn(false)} onClick={deleteSelected}>🗑 Delete image</button>}
        <button style={{ ...btn(false), fontWeight: 700, borderColor: "#0d8f83", color: "#0a6a60" }} onClick={doExport}>Done — flatten &amp; save</button>
        <button style={btn(false)} onClick={onClose}>Cancel</button>
      </div>

      {stampSrc && <div style={{ color: "#fff", fontSize: 13, padding: "6px 2px" }}>Click on the form to place the image — you can then drag it and resize it from the corner.</div>}
      {busy && <div style={{ color: "#fff", fontSize: 13, padding: "6px 2px" }}>{busy}</div>}

      <div style={{ flex: 1, overflow: "auto", marginTop: 8, display: "flex", justifyContent: "center" }}>
        <div style={{ position: "relative", width: dims.w, height: dims.h, boxShadow: "0 6px 24px rgba(0,0,0,0.4)" }}>
          <canvas ref={bgRef} style={{ position: "absolute", inset: 0, background: "#fff" }} />
          <canvas
            ref={inkRef}
            style={{ position: "absolute", inset: 0, cursor: stampSrc ? "copy" : tool === "text" ? "text" : "crosshair", touchAction: "none" }}
            onPointerDown={onInkDown}
            onPointerMove={onInkMove}
            onPointerUp={onInkUp}
          />
          {pagePlacements.map((pl) => (
            <div
              key={pl.id}
              onPointerDown={(e) => startDrag(e, pl.id, "move")}
              style={{
                position: "absolute", left: pl.x, top: pl.y, width: pl.w, height: pl.h, cursor: "move",
                border: selected === pl.id ? "1.5px dashed #0d8f83" : "1px solid transparent",
              }}
            >
              <img src={pl.src} alt="" draggable={false} style={{ width: "100%", height: "100%", pointerEvents: "none" }} />
              {selected === pl.id && (
                <span
                  onPointerDown={(e) => startDrag(e, pl.id, "resize")}
                  style={{ position: "absolute", right: -7, bottom: -7, width: 14, height: 14, background: "#0d8f83", borderRadius: 3, cursor: "nwse-resize", border: "2px solid #fff" }}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {numPages > 1 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", color: "#fff", padding: 8 }}>
          <button style={btn(false)} onClick={() => changePage(page - 1)} disabled={page === 0}>‹ Prev</button>
          <span>Page {page + 1} / {numPages}</span>
          <button style={btn(false)} onClick={() => changePage(page + 1)} disabled={page === numPages - 1}>Next ›</button>
        </div>
      )}
    </div>
  );
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}
