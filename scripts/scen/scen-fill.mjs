// Reusable REAL-form fill scenario (env FORM = pdf path, MODE = fill|detect). Loads a real form,
// shows it EMPTY (before) with a spotlight, then fills from the vault (after) and spotlights the
// filled form. Real form, synthetic John Doe data. Used for v2-03-flat (detect) and v2-04 (fill).
export default async function ({ ev, setFile, clickText, point, spotlight, clearSpotlight, sleep }) {
  const FORM = process.env.FORM || "C:/ppfdemo/job.pdf";
  const MODE = process.env.MODE || "fill";
  await clickText("2 · Profile & Vault"); await sleep(400);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='John Doe')?.click(); return true;`); await sleep(400);
  await clickText("3 · Forms to fill"); await sleep(600);
  // reveal the loader (a form may already be loaded) + manual tools
  await ev(`[...document.querySelectorAll('button')].find(b=>/Choose a different form/.test(b.textContent))?.click(); return true;`); await sleep(500);
  await ev(`[...document.querySelectorAll('button')].find(b=>/Manual & demo tools/.test(b.textContent)&&/▸/.test(b.textContent))?.click(); return true;`); await sleep(500);
  for (let i = 0; i < 5 && !(await ev(`return !!document.querySelector('input[type=file]')`)); i++) {
    await ev(`[...document.querySelectorAll('button')].find(b=>/Manual & demo tools|Choose a different form/.test(b.textContent))?.click(); return true;`); await sleep(500);
  }
  // load the real form -> renders (BEFORE)
  await setFile('input[type=file]', FORM);
  for (let i = 0; i < 12; i++) { const ready = await ev(`return [...document.querySelectorAll('button')].some(b=>/Fill existing fields|Detect fields/.test(b.textContent))`); if (ready) break; await sleep(900); }
  await sleep(1400);
  // BEFORE: spotlight the empty form
  await spotlight('canvas, table, .review, section', 18); await sleep(2000); await clearSpotlight();
  // FILL (or detect->fill for a flat scan)
  if (MODE === "detect") {
    await point('button', 'Detect fields (OCR)'); await sleep(400);
    await ev(`[...document.querySelectorAll('button')].find(b=>/Detect fields/.test(b.textContent))?.click();`);
    for (let i = 0; i < 10; i++) await sleep(900);
  } else {
    await point('button', 'Fill existing fields'); await sleep(400);
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Fill existing fields')?.click();`);
    for (let i = 0; i < 7; i++) await sleep(900);
  }
  await sleep(1200);
  // AFTER: reveal the filled fields as a clean key/value list so the DIVERSE data is obvious. The
  // toggle is a clickable summary/link — walk up from the text node to something clickable.
  await ev(`
    const hit=[...document.querySelectorAll('summary,button,a,div,span,p')].find(e=>/Prefer a list|every field as a key/i.test((e.textContent||''))&&e.textContent.length<80);
    if(hit){ let t=hit; for(let i=0;i<3&&t;i++){ t.click(); t=t.parentElement; } }
    return !!hit;`);
  await sleep(1000);
  await ev(`const t=[...document.querySelectorAll('table,tbody')].map(x=>x).find(x=>x.getBoundingClientRect().height>80); if(t)t.scrollIntoView({block:'start'}); window.scrollBy(0,-40); return true;`);
  await sleep(500);
  await spotlight('table', 14, 'last'); await sleep(3200); await clearSpotlight();
}
