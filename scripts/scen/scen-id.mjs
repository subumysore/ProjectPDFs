// v2-02-id — LIVE (~29s), spotlighted. Import DL FRONT (OCR→fields + image), DL BACK (→ real
// driver_license_back KV pair), PASSPORT (→ fields + image). Each document image is SPOTLIT (the rest
// of the screen dims) while the narration talks about it — no blank white, eye goes to the right spot.
export default async function ({ ev, setFile, clickText, clickSave, spotlight, clearSpotlight, sleep, waitLi }) {
  await clickText("2 · Profile & Vault"); await sleep(600);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='John Doe')?.click();`); await sleep(600);
  const toImport = `const el=[...document.querySelectorAll('*')].find(e=>/Import a data source/.test(e.textContent||'')&&e.children.length<3); if(el)el.scrollIntoView({block:'center'}); return true;`;
  const spotRow = (key) => `document.querySelector('input[value]'); ` + // noop guard
    `let lbl=[...document.querySelectorAll('td,div,span')].find(e=>e.children.length===0&&(e.textContent||'').trim()===${JSON.stringify(key)});`;

  await ev(toImport); await sleep(900);

  // --- DL FRONT: OCR → fields + card image; spotlight the extracted image thumbnail ---
  await setFile('input[accept="image/*"]', "C:/ppfdemo/dl-front.png");
  await waitLi(3); await sleep(900);
  await spotlight('section img[src^="data:"]', 16); await sleep(2000);   // "the front is read…"
  await clearSpotlight();
  await clickSave(); await sleep(900);

  // --- DL BACK: OCR (no barcode) → driver_license_back image saved as a KV pair ---
  await ev(toImport); await sleep(400);
  await setFile('input[accept="image/*"]', "C:/ppfdemo/dl-back.png");
  await sleep(3200);   // OCR runs on the back; the image-only result appears (driver_license_back)
  await spotlight('section img[src^="data:"]', 16); await sleep(1800);   // "the barcode on the back…"
  await clearSpotlight();
  await clickSave(); await sleep(900);

  // --- PASSPORT: OCR → fields + passport image ---
  await ev(toImport); await sleep(400);
  await setFile('input[accept="image/*"]', "C:/ppfdemo/passport.png");
  await waitLi(3); await sleep(900);
  await spotlight('section img[src^="data:"]', 16); await sleep(2200);   // "a passport works the same way"
  await clearSpotlight();
  await clickSave(); await sleep(1400);
}
