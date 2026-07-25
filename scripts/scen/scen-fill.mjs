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
  await sleep(1000);
  // AFTER: keep the picture MOVING — smoothly scroll through the filled form so every filled field
  // (the diverse data) is revealed in continuous motion, instead of holding on a static frame.
  // Find the tallest scrollable region (the form/PDF review) and pan it top→bottom, then back up.
  await ev(`
    window.__sc = (()=>{ let best=document.scrollingElement, bh=0;
      for(const el of document.querySelectorAll('*')){ const s=el.scrollHeight-el.clientHeight; const cs=getComputedStyle(el);
        if(s>bh && /(auto|scroll)/.test(cs.overflowY) && el.clientHeight>200){ best=el; bh=s; } }
      return best; })();
    if(window.__sc.scrollTo){window.__sc.scrollTo({top:0});}else{window.scrollTo(0,0);} return true;`);
  await sleep(600);
  const range = (await ev(`return window.__sc.scrollHeight-window.__sc.clientHeight`)) || 600;
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const y = Math.round((range * i) / steps);
    await ev(`window.__sc.scrollTo?window.__sc.scrollTo({top:${y},behavior:'auto'}):window.scrollTo(0,${y}); return true;`);
    await sleep(150);
  }
  await sleep(600);
}
