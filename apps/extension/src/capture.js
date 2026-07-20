// Camera / image → profile key-value capture (REQ-10 for the extension). Grabs a frame
// (or a chosen image), OCRs it on-device with the shared Tesseract worker, maps the
// text to profile keys with the ported parseFields heuristics, lets the user review,
// then writes the checked pairs to the vault via the background (same path the popup
// uses). Everything is on-device; only the OCR model downloads.
import { getTessWorker } from "./tess.js";
import { parseFields } from "./parse.js";

const $ = (id) => document.getElementById(id);
const send = (m) => chrome.runtime.sendMessage(m);
const setMsg = (t, ok = true) => { const e = $("msg"); e.textContent = t; e.className = "msg " + (ok ? "ok" : "err"); };
const setSaveMsg = (t, ok = true) => { const e = $("saveMsg"); e.textContent = t; e.className = "msg " + (ok ? "ok" : "err"); };

let stream = null;

$("close").onclick = (e) => { e.preventDefault(); stopCam(); window.close(); };

function stopCam() {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
}

$("startCam").onclick = async () => {
  setMsg("Requesting camera…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const v = $("video");
    v.srcObject = stream;
    v.hidden = false;
    $("shot").hidden = true;
    $("startCam").hidden = true;
    $("snap").hidden = false;
    $("retake").hidden = true;
    setMsg("Camera ready — frame the document and press Capture.");
  } catch (e) {
    setMsg("Couldn't open the camera (" + ((e && e.message) || e) + "). You can choose an image file instead.", false);
  }
};

$("snap").onclick = () => {
  const v = $("video");
  const c = $("shot");
  c.width = v.videoWidth || 1280;
  c.height = v.videoHeight || 720;
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  v.hidden = true; c.hidden = false;
  $("snap").hidden = true; $("retake").hidden = false;
  stopCam();
  runOcr(c);
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
    runOcr(c);
  };
  img.onerror = () => setMsg("Couldn't read that image.", false);
  img.src = URL.createObjectURL(f);
};

async function runOcr(canvas) {
  $("resultsCard").hidden = true;
  setMsg("Reading the image on-device…");
  try {
    const worker = await getTessWorker(setMsg);
    const { data } = await worker.recognize(canvas);
    const text = data.text || "";
    const fields = parseFields(text);
    $("raw").textContent = text.trim() || "(no text recognised)";
    if (!fields.length) {
      setMsg("Read the image, but couldn't recognise any profile fields. Try a sharper, straight-on shot.", false);
      $("resultsCard").hidden = false;
      $("results").querySelector("tbody").innerHTML = "";
      return;
    }
    renderResults(fields);
    setMsg(`Found ${fields.length} field(s) — review below.`);
  } catch (e) {
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
    const vin = document.createElement("input");
    vin.type = "text"; vin.value = value; vin.className = "val";
    const td0 = document.createElement("td"); td0.appendChild(cb);
    const td1 = document.createElement("td"); td1.className = "k"; td1.textContent = ontology_key;
    const td2 = document.createElement("td"); td2.appendChild(vin);
    tr.dataset.key = ontology_key;
    tr.append(td0, td1, td2);
    tb.appendChild(tr);
  }
  $("resultsCard").hidden = false;
  setSaveMsg("");
}

$("save").onclick = async () => {
  // Vault must be unlocked (background holds the key).
  const st = await send({ type: "status" });
  if (!st || !st.ok || !st.unlocked) {
    setSaveMsg("Your vault is locked. Open the PolyglotFormFill popup and unlock it, then save.", false);
    return;
  }
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
  setSaveMsg(saved ? `Saved ${saved} field(s) to your profile.${failed ? ` (${failed} failed.)` : ""}` : "Nothing saved.", !failed);
};
