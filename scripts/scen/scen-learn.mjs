// v2-07-learn — LIVE (~9s): type a new field once; it saves to the vault. Front-loaded so the key
// beat (typing + the new row appearing) lands inside the narration window. Cursor-guided, no overlays.
export default async function ({ ev, clickText, type, point, sleep }) {
  await clickText("2 · Profile & Vault"); await sleep(400);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='John Doe')?.click();`); await sleep(500);
  await point('input[placeholder^="key (e.g. full_name)"]'); await sleep(250);
  await type('input[placeholder^="key (e.g. full_name)"]', 'visa_status'); await sleep(600);
  await point('input[placeholder="value"]'); await sleep(250);
  await type('input[placeholder="value"]', 'H-1B'); await sleep(650);
  await point('button', 'Save'); await sleep(300);
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save')?.click();`);
  await sleep(1200);
  // highlight the newly stored row
  await ev(`
    const el=[...document.querySelectorAll('td,div,span,li')].find(e=>/^visa_status$/.test((e.textContent||'').trim()));
    if(el){el.scrollIntoView({block:'center'});el.style.transition='background .3s';el.style.background='#dff7ef';el.style.outline='2px solid #1c7c6f';el.style.borderRadius='4px';}
    return !!el;`);
  await point('span'); // nudge cursor
  await sleep(2200);
}
