// Place-on-PDF / handwrite tool: render the PDF with pdf.js, let the user freehand-draw or
// stamp their saved signature/photo anywhere, then flatten the per-page overlay into the PDF
// and download. Fully on-device. The PDF bytes are handed over via chrome.storage.session.
import * as pdfjsLib from "../vendor/pdfjs/pdf.min.mjs";
import { flattenOverlays } from "./signflatten.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdfjs/pdf.worker.min.mjs");
const $ = (id) => document.getElementById(id);
const b64ToBytes = (b64) => { const bin = atob(b64); const d = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) d[i] = bin.charCodeAt(i); return d; };

const state = {
  bytes: null, doc: null, page: 1, num: 1, scale: 1.4,
  tool: "pen", size: 4, color: "#0b1f66",
  overlays: {},          // pageIndex(0-based) -> ink canvas (persisted across page nav)
  undo: {},              // pageIndex -> [ImageData] snapshots (before each stroke/stamp)
  stamps: [],            // [{ key, img, src }] — EVERY image saved in the vault, user picks which
  currentStamp: null,    // the image chosen to stamp
  vault: null,           // the unlocked vault, so we can ALSO fill fields here (any order)
};
const toast = (m) => { const h = $("hint"); if (h) h.textContent = m; };

// Snapshot the current page's ink BEFORE a change, so Undo can restore it (cap the history).
function pushUndo() {
  const ink = $("ink"); const key = state.page - 1;
  (state.undo[key] || (state.undo[key] = [])).push(ink.getContext("2d").getImageData(0, 0, ink.width, ink.height));
  if (state.undo[key].length > 40) state.undo[key].shift();
}
function doUndo() {
  const st = state.undo[state.page - 1];
  if (!st || !st.length) return;
  const ink = $("ink"); ink.getContext("2d").putImageData(st.pop(), 0, 0); commitToStore();
}

// Tool selection (module-level so drawing + toolbar share it).
function clearActive() { document.querySelectorAll("#bar button.on").forEach((b) => b.classList.remove("on")); }
function setTool(t) { state.tool = t; state.currentStamp = null; clearActive(); const map = { pen: "tPen", text: "tText" }; if (map[t] && $(map[t])) $(map[t]).classList.add("on"); }
function selectStamp(st, btn) { state.tool = "stamp"; state.currentStamp = st.img; clearActive(); btn.classList.add("on"); }
// One labelled button per saved image — the user picks exactly which to place (with a thumbnail).
function buildStampButtons() {
  const box = $("stamps"); if (!box) return; box.innerHTML = "";
  for (const st of state.stamps) {
    const b = document.createElement("button");
    b.title = `Place: ${st.key} (click once, then click the form)`;
    b.innerHTML = `<img src="${st.src}" style="height:16px;vertical-align:middle;border:1px solid #fff;border-radius:2px;background:#fff;margin-right:3px">${st.key}`;
    b.onclick = () => selectStamp(st, b);
    box.appendChild(b);
  }
}

async function loadVaultImages() {
  try {
    const r = await chrome.runtime.sendMessage({ type: "getVault" });
    if (r && r.ok && r.vault) {
      state.vault = r.vault; // reused by the "Fill fields" button so signing & filling share one doc
      const mk = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
      // EVERY image the user has saved becomes its own labelled stamp — no guessing which one.
      for (const [k, val] of Object.entries(r.vault)) {
        if (typeof val === "string" && val.startsWith("data:image")) {
          const img = await mk(val); if (img) state.stamps.push({ key: k, img, src: val });
        }
      }
    }
  } catch (_) { /* vault locked / unavailable — pen still works */ }
}

function inkFor(pageIdx, w, h) {
  if (!state.overlays[pageIdx]) { const c = document.createElement("canvas"); c.width = w; c.height = h; state.overlays[pageIdx] = c; }
  return state.overlays[pageIdx];
}

async function renderPage() {
  const page = await state.doc.getPage(state.page);
  const vp = page.getViewport({ scale: state.scale });
  const pdfC = $("pdf"), ink = $("ink");
  pdfC.width = ink.width = Math.ceil(vp.width);
  pdfC.height = ink.height = Math.ceil(vp.height);
  ink.style.width = pdfC.style.width = vp.width + "px";
  ink.style.height = pdfC.style.height = vp.height + "px";
  await page.render({ canvasContext: pdfC.getContext("2d"), viewport: vp }).promise;
  // Paint the saved ink for this page onto the visible overlay.
  const store = inkFor(state.page - 1, ink.width, ink.height);
  const ctx = ink.getContext("2d"); ctx.clearRect(0, 0, ink.width, ink.height); ctx.drawImage(store, 0, 0);
  $("pageInfo").textContent = `${state.page} / ${state.num}`;
}

// Re-open the working PDF after its bytes change (e.g. after auto-filling fields), keeping
// any ink/stamp overlays the user has already drawn (they live on separate canvases and are
// composited at Download time, so they survive a re-render).
async function reloadFromBytes() {
  state.doc = await pdfjsLib.getDocument({ data: state.bytes.slice(0) }).promise;
  state.num = state.doc.numPages;
  if (state.page > state.num) state.page = 1;
  await renderPage();
}

// Auto-fill the form's fields from the vault, right here in the sign surface — so the user can
// fill BEFORE or AFTER signing. Order is never mandated: ink overlays are flattened over
// whatever the filled bytes are at Download.
async function fillFieldsHere() {
  if (!state.vault) return toast("Vault is locked — open the extension popup and unlock it, then try Fill again.");
  const btn = $("tFill"); const label = btn.textContent; btn.textContent = "Filling…"; btn.disabled = true;
  try {
    const { fillPdfBytes } = await import("./pdffill.js");
    const res = await fillPdfBytes(state.bytes, state.vault);
    if (res && res.bytes && res.filled) {
      state.bytes = res.bytes; await reloadFromBytes();
      toast(`Filled ${res.filled} of ${res.total} field(s). Draw / stamp anywhere and then Download.`);
    } else {
      toast("No fillable form fields matched here — use Pen, Text, or your image stamps to place values by hand.");
    }
  } catch (e) { toast("Fill failed: " + (e && e.message || e)); }
  finally { btn.textContent = label; btn.disabled = false; }
}

// ---- drawing / stamping on the visible overlay, mirrored into the per-page store ----
function commitToStore() {
  const ink = $("ink"); const store = inkFor(state.page - 1, ink.width, ink.height);
  const c = store.getContext("2d"); c.clearRect(0, 0, store.width, store.height); c.drawImage(ink, 0, 0);
}
function setupDrawing() {
  const ink = $("ink"); const ctx = ink.getContext("2d");
  let drawing = false, last = null, base = null, imgTool = null;
  const pos = (e) => { const r = ink.getBoundingClientRect(); return { x: (e.clientX - r.left) * (ink.width / r.width), y: (e.clientY - r.top) * (ink.height / r.height) }; };
  ink.addEventListener("pointerdown", (e) => {
    const p0 = pos(e);
    // TEXT tool: a single click asks for the text and stamps it at that spot (type on a form).
    if (state.tool === "text") {
      e.preventDefault();
      const txt = prompt("Text to place here:");
      if (txt) { pushUndo(); ctx.fillStyle = state.color; ctx.textBaseline = "top"; ctx.font = `${Math.max(11, state.size * 4.5)}px system-ui, sans-serif`; ctx.fillText(txt, p0.x, p0.y); commitToStore(); }
      return;
    }
    if (state.tool === "stamp" && !state.currentStamp) return; // stamp tool but nothing chosen
    drawing = true; last = p0; e.preventDefault();
    pushUndo(); // record state before this stroke/stamp
    if (state.tool === "pen") {
      ctx.strokeStyle = state.color; ctx.lineWidth = state.size; ctx.lineCap = "round"; ctx.lineJoin = "round";
    } else if (state.tool === "stamp") {
      imgTool = state.currentStamp;
      base = ctx.getImageData(0, 0, ink.width, ink.height); // snapshot to preview the drag/resize
    }
  });
  ink.addEventListener("pointermove", (e) => {
    if (!drawing) return; const p = pos(e); e.preventDefault();
    if (state.tool === "pen") { ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; }
    else if (imgTool) {
      ctx.putImageData(base, 0, 0);
      const w = Math.max(60, state.size * 40), h = w * (imgTool.height / imgTool.width);
      ctx.drawImage(imgTool, p.x - w / 2, p.y - h / 2, w, h);
    }
  });
  window.addEventListener("pointerup", () => {
    if (!drawing) return;
    drawing = false;
    const wasStamp = !!imgTool; imgTool = null;
    commitToStore();
    if (wasStamp) setTool("pen"); // ONE-SHOT: placing an image reverts to Pen so a later click can't duplicate it
  });
}

async function download() {
  $("dl").textContent = "Flattening…";
  const overlays = {};
  for (const [idx, c] of Object.entries(state.overlays)) {
    // Non-empty pages only.
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let any = false; for (let i = 3; i < d.length; i += 4) { if (d[i]) { any = true; break; } }
    if (any) overlays[idx] = c.toDataURL("image/png");
  }
  const out = await flattenOverlays(state.bytes, overlays);
  const url = URL.createObjectURL(new Blob([out.slice()], { type: "application/pdf" }));
  const a = $("dl"); a.href = url; a.textContent = "⬇ Download signed PDF"; a.click();
}

function wireToolbar() {
  $("tFill").onclick = fillFieldsHere;
  $("tPen").onclick = () => setTool("pen");
  $("tText").onclick = () => setTool("text");
  buildStampButtons(); // one labelled thumbnail button per saved image
  $("size").oninput = () => { state.size = +$("size").value; };
  $("color").oninput = () => { state.color = $("color").value; };
  $("undo").onclick = doUndo;
  window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); } });
  $("clear").onclick = () => { pushUndo(); const ink = $("ink"); ink.getContext("2d").clearRect(0, 0, ink.width, ink.height); commitToStore(); };
  $("prev").onclick = async () => { if (state.page > 1) { state.page--; await renderPage(); } };
  $("next").onclick = async () => { if (state.page < state.num) { state.page++; await renderPage(); } };
  $("dl").onclick = (e) => { if ($("dl").textContent.includes("Download")) { e.preventDefault(); download(); } };
}

(async () => {
  const s = await chrome.storage.session.get(["ppf_sign_src", "ppf_sign_name"]);
  if (!s.ppf_sign_src) { document.getElementById("hint").textContent = "No PDF to sign — open a PDF and click 'Sign / annotate' in the extension."; return; }
  state.bytes = b64ToBytes(s.ppf_sign_src);
  $("dl").download = (s.ppf_sign_name || "form") + "-signed.pdf";
  await loadVaultImages();
  state.doc = await pdfjsLib.getDocument({ data: state.bytes.slice(0) }).promise;
  state.num = state.doc.numPages;
  setupDrawing(); wireToolbar();
  await renderPage();
})();
