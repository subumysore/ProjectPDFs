// v2-09-office — LIVE (~11s): a real workplace form (Vendor Registration — vendor/procurement
// paperwork) filled from the vault. Reveal the loader, load a FRESH (empty) copy → BEFORE, click
// "Fill existing fields" → AFTER. Real form, synthetic data. Cursor-guided.
export default async function ({ ev, setFile, clickText, point, sleep }) {
  // ensure an active profile (Forms tab needs one) — pick John Doe
  await clickText("2 · Profile & Vault"); await sleep(500);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='John Doe')?.click(); return true;`); await sleep(500);
  await clickText("3 · Forms to fill"); await sleep(700);
  // If a form is already loaded, get back to the loader; then expand the manual/demo tools so the
  // file input is in the DOM.
  await ev(`[...document.querySelectorAll('button')].find(b=>/Choose a different form/.test(b.textContent))?.click(); return true;`); await sleep(500);
  await ev(`[...document.querySelectorAll('button')].find(b=>/Manual & demo tools/.test(b.textContent)&&/▸/.test(b.textContent))?.click(); return true;`); await sleep(500);
  // make sure an input exists
  for (let i = 0; i < 5 && !(await ev(`return !!document.querySelector('input[type=file]')`)); i++) {
    await ev(`[...document.querySelectorAll('button')].find(b=>/Manual & demo tools|Choose a different form/.test(b.textContent))?.click(); return true;`);
    await sleep(500);
  }

  // load a FRESH copy of the vendor form -> renders with EMPTY fields (BEFORE)
  await setFile('input[type=file]', "C:/ppfdemo/vendor.pdf");
  for (let i = 0; i < 10; i++) { const ok = await ev(`return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Fill existing fields')`); if (ok) break; await sleep(900); }
  await sleep(2600);   // hold on the EMPTY form

  // AFTER: fill from the vault
  await point('button', 'Fill existing fields'); await sleep(400);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Fill existing fields')?.click();`);
  for (let i = 0; i < 7; i++) { await sleep(900); }
  await sleep(1200);
}
