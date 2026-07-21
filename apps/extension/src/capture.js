// Camera / image → profile key-value capture (REQ-10 for the extension). Grabs a frame
// (or a chosen image), OCRs it on-device with the shared Tesseract worker, maps the
// text to profile keys with the ported parseFields heuristics, lets the user review,
// then writes the checked pairs to the vault via the background (same path the popup
// uses). Everything is on-device; only the OCR model downloads.
import { getTessWorker } from "./tess.js";
import { parseFields, parseAamva } from "./parse.js";

const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
const setMsg = (t, ok = true) => { const e = $("msg"); e.textContent = t; e.className = "msg " + (ok ? "ok" : "err"); };
const setBusy = (on, text) => { const b = $("busy"); if (b) { b.classList.toggle("on", on); if (text) $("busyText").textContent = text; } };
const setSaveMsg = (t, ok = true) => { const e = $("saveMsg"); e.textContent = t; e.className = "msg " + (ok ? "ok" : "err"); };

let stream = null;
let barcodeReader = null;

$("close").onclick = (e) => {
  e.preventDefault();
  stopCam();
  // window.close() can't close a tab the extension opened; remove it via tabs API.
  chrome.tabs.getCurrent((t) => { if (t && t.id != null) chrome.tabs.remove(t.id); else window.close(); });
};

function stopCam() {
  if (barcodeReader) { try { barcodeReader.reset(); } catch (_) { /* ignore */ } barcodeReader = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

$("startCam").onclick = async () => {
  setMsg("Requesting camera…");
  const v = $("video");
  try {
    const { BrowserPDF417Reader } = await import("../vendor/zxing.bundle.mjs");
    barcodeReader = new BrowserPDF417Reader();
    v.hidden = false;
    $("shot").hidden = true;
    $("startCam").hidden = true;
    $("snap").hidden = false;
    $("retake").hidden = true;
    setMsg("Scanning… hold the BACK barcode steady in view — it reads automatically. Or press Capture to OCR the front.");
    // LIVE continuous scan: decodes the PDF417 as soon as ONE frame is sharp, so a blurry
    // preview no longer blocks it. Requests continuous autofocus. The same live stream is
    // reused for a manual OCR capture of the printed front.
    await barcodeReader.decodeFromConstraints(
      { video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: "continuous" }] } },
      v,
      (result) => {
        if (!result) return;
        const text = result.getText();
        const fields = parseAamva(text);
        if (fields.length >= 3) {
          // Grab the current frame as the DL image BEFORE stopping the stream.
          fields.unshift({ ontology_key: "driver_license_back", value: toJpegDataUrl(v) });
          stopCam();
          v.hidden = true;
          $("snap").hidden = true;
          $("retake").hidden = false;
          $("raw").textContent = text;
          renderResults(fields);
          setMsg(`✓ Read the licence barcode — ${fields.length} field(s), exact (no OCR).`);
        }
      },
    );
    stream = v.srcObject; // keep the live stream for a manual OCR snapshot
  } catch (e) {
    setMsg("Couldn't open the camera (" + ((e && e.message) || e) + "). You can choose an image file instead.", false);
  }
};

$("snap").onclick = () => {
  const v = $("video");
  if (!v.videoWidth) { setMsg("Camera still starting — try again in a second.", false); return; }
  const c = $("shot");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  v.hidden = true; c.hidden = false;
  $("snap").hidden = true; $("retake").hidden = false;
  stopCam();
  runOcr(c); // manual capture = OCR the printed front (live scan already covers the barcode)
};

$("retake").onclick = () => {
  $("resultsCard").hidden = true;
  $("startCam").hidden = false;
  $("retake").hidden = true;
  $("shot").hidden = true;
  setMsg("");
};

$("file").onchange = async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  stopCam();
  const img = new Image();
  img.onload = () => {
    const c = $("shot");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    c.hidden = false; $("video").hidden = true;
    $("startCam").hidden = false; $("snap").hidden = true; $("retake").hidden = true;
    URL.revokeObjectURL(img.src);
    processImage(c);
  };
  img.onerror = () => setMsg("Couldn't read that image.", false);
  img.src = URL.createObjectURL(f);
};

// Preprocess for OCR: upscale small captures so text is large enough, convert to
// grayscale, and stretch contrast. This markedly helps OCR on glossy/low-contrast IDs
// (it can't fix motion blur or extreme glare — those need a better photo).
function preprocessForOcr(srcCanvas) {
  const MIN_W = 1700;
  const scale = srcCanvas.width < MIN_W ? MIN_W / srcCanvas.width : 1;
  const w = Math.round(srcCanvas.width * scale);
  const h = Math.round(srcCanvas.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCanvas, 0, 0, w, h);
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  // Grayscale + gather a robust min/max (1st–99th percentile) for contrast stretch.
  const hist = new Uint32Array(256);
  const gray = new Uint8Array(w * h);
  let sum = 0, bright = 0;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    gray[j] = g; hist[g]++; sum += g; if (g > 225) bright++;
  }
  const total = w * h;
  let lo = 0, hi = 255, cum = 0;
  for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum > total * 0.01) { lo = v; break; } }
  cum = 0;
  for (let v = 255; v >= 0; v--) { cum += hist[v]; if (cum > total * 0.01) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  // OVER-EXPOSED / glary image? (bright mean, or lots of near-white pixels.) If so, apply
  // a gamma>1 curve AFTER the contrast stretch to darken blown-out highlights and pull
  // washed-out text back. Precomputed as a 256-entry LUT (fast).
  const overexposed = sum / total > 170 || bright / total > 0.35;
  const gamma = overexposed ? 1.8 : 1.0;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    let g = (v - lo) * 255 / range;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (gamma !== 1) g = 255 * Math.pow(g / 255, gamma);
    lut[v] = g < 0 ? 0 : g > 255 ? 255 : g | 0;
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = lut[gray[j]];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

// Capture the whole frame (video or canvas) as a JPEG data-URI — the document image.
function toJpegDataUrl(source) {
  const w = source.videoWidth || source.width;
  const h = source.videoHeight || source.height;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(source, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.85);
}
// Which document-image key to store the whole picture under (spec: document-image-fields).
// A decoded PDF417 barcode = BACK. For OCR text, the BACK carries class/restriction/
// endorsement boilerplate with none of the front's identity markers; the FRONT carries
// the name/DOB/address/DLN.
function docImageKey(text, hasIdentity) {
  const t = text || "";
  if (/passport|passeport|pasaporte/i.test(t)) return "passport_image";
  const backMarkers = /\b(class|restr|restrictions|endorsement|gvwr|commercial|legal presence|organ donor|noncommercial)\b/i.test(t);
  // The FRONT is what carries the person's identity — if we extracted a name/DOB/address
  // it's the front; the back (barcode/boilerplate side) has none of that.
  if (hasIdentity) return "driver_license_front";
  if (backMarkers) return "driver_license_back";
  if (/driver|licen[sc]e|\bdln\b/i.test(t)) return "driver_license_front";
  return "document_image";
}

// First try to read a PDF417 barcode (the back of a US/Canada driver's licence) —
// that gives EXACT structured data, no OCR guessing. If there's no barcode, fall back
// to OCR of the printed text. All on-device.
async function processImage(canvas) {
  $("resultsCard").hidden = true;
  setBusy(true, "Checking for a barcode…");
  setMsg("Checking for a driver's-licence barcode…");
  try {
    const { BrowserPDF417Reader } = await import("../vendor/zxing.bundle.mjs");
    const res = await new BrowserPDF417Reader().decodeFromImageUrl(canvas.toDataURL("image/png"));
    const text = (res && res.getText && res.getText()) || "";
    const fields = parseAamva(text);
    if (fields.length >= 3) {
      // A decoded licence barcode → also keep the whole picture as the DL image.
      fields.unshift({ ontology_key: "driver_license_back", value: toJpegDataUrl(canvas) });
      $("raw").textContent = text;
      renderResults(fields);
      setBusy(false);
      setMsg(`✓ Read the licence barcode — ${fields.length} field(s), exact (no OCR).`);
      return;
    }
  } catch (_) { /* no barcode → OCR the printed text */ }
  return runOcr(canvas);
}

async function runOcr(canvas) {
  $("resultsCard").hidden = true;
  setBusy(true, "Reading the image on-device…");
  setMsg("Reading the image on-device…");
  try {
    const worker = await getTessWorker((s) => setBusy(true, s));
    const { data } = await worker.recognize(preprocessForOcr(canvas));
    const text = data.text || "";
    const fields = parseFields(text);
    $("raw").textContent = text.trim() || "(no text recognised)";
    const hasIdentity = fields.some((f) => ["first_name", "last_name", "date_of_birth", "address_1"].includes(f.ontology_key));
    const key = docImageKey(text, hasIdentity);
    fields.unshift({ ontology_key: key, value: toJpegDataUrl(canvas) });
    renderResults(fields);
    setBusy(false);
    if (key === "driver_license_back" && fields.length === 1) {
      setMsg("Looks like the BACK of a licence, but the barcode didn't scan (glare/blur). Use Start camera and hold the barcode steady, or upload a sharper, glare-free photo — the barcode reads every field exactly.", false);
    } else {
      setMsg(`Found ${fields.length} field(s) — review below.`);
    }
  } catch (e) {
    setBusy(false);
    setMsg("OCR failed: " + ((e && e.message) || e), false);
  }
}

function renderResults(fields) {
  const tb = $("results").querySelector("tbody");
  tb.innerHTML = "";
  for (const { ontology_key, value } of fields) {
    const tr = document.createElement("tr");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = true; cb.className = "pick";
    const td0 = document.createElement("td"); td0.appendChild(cb);
    const td1 = document.createElement("td"); td1.className = "k"; td1.textContent = ontology_key;
    const td2 = document.createElement("td");
    const isImage = typeof value === "string" && value.startsWith("data:image");
    if (isImage) {
      // Show a thumbnail; keep the data-URI in a hidden input so save reads it uniformly.
      const thumb = document.createElement("img");
      thumb.src = value;
      thumb.style.cssText = "max-height:44px;max-width:170px;object-fit:contain;border:1px solid #d9e2e6;border-radius:4px;background:#fff";
      const hidden = document.createElement("input");
      hidden.type = "hidden"; hidden.className = "val"; hidden.value = value;
      td2.append(thumb, hidden);
    } else {
      const vin = document.createElement("input");
      vin.type = "text"; vin.value = value; vin.className = "val";
      td2.appendChild(vin);
    }
    tr.dataset.key = ontology_key;
    tr.append(td0, td1, td2);
    tb.appendChild(tr);
  }
  $("resultsCard").hidden = false;
  setSaveMsg("");
}

async function doSave() {
  const rows = [...$("results").querySelectorAll("tbody tr")];
  let saved = 0, failed = 0;
  for (const tr of rows) {
    if (!tr.querySelector(".pick").checked) continue;
    const key = tr.dataset.key;
    const value = tr.querySelector(".val").value.trim();
    if (!value) continue;
    const r = await send({ type: "set", key, value });
    if (r && r.ok) saved++; else failed++;
  }
  if (saved && !failed) {
    // Done — release the camera and close this scan tab, returning to the previous screen.
    setSaveMsg(`Saved ${saved} field(s) to your profile — closing…`, true);
    stopCam();
    setTimeout(async () => {
      try { const t = await chrome.tabs.getCurrent(); if (t && t.id != null) return chrome.tabs.remove(t.id); } catch (_) { /* fall through */ }
      window.close();
    }, 800);
    return;
  }
  setSaveMsg(saved ? `Saved ${saved} field(s) to your profile.${failed ? ` (${failed} failed.)` : ""}` : "Nothing saved.", !failed);
}

$("save").onclick = async () => {
  // Vault must be unlocked (background holds the key). If locked, unlock RIGHT HERE
  // instead of sending the user back to the popup.
  const st = await send({ type: "status" });
  if (!st || !st.ok || !st.unlocked) {
    $("unlockRow").hidden = false;
    $("unlockPass").focus();
    setSaveMsg("Your vault is locked — enter your passphrase below to unlock and save.", false);
    return;
  }
  doSave();
};

// Inline unlock (passphrase) + save, so the user never leaves the scan.
$("unlockBtn").onclick = async () => {
  const pass = $("unlockPass").value;
  if (!pass) { setSaveMsg("Enter your vault passphrase.", false); return; }
  const r = await send({ type: "unlock", passphrase: pass });
  if (!r || !r.ok) { setSaveMsg((r && r.error) || "Unlock failed — wrong passphrase?", false); return; }
  $("unlockRow").hidden = true;
  $("unlockPass").value = "";
  doSave();
};
$("unlockPass") && ($("unlockPass").onkeydown = (e) => { if (e.key === "Enter") $("unlockBtn").click(); });
