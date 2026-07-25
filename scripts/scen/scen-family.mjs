// v2-08-family — LIVE (~12s): a separate profile per person. Highlight the profile switcher, then
// click through John → Jane → Emma so each person's OWN vault data shows. Cursor + ring guided.
export default async function ({ ev, clickText, point, sleep }) {
  await clickText("2 · Profile & Vault"); await sleep(500);

  // outline the profiles switcher so the viewer sees WHERE the people live
  await ev(`
    const hdr=[...document.querySelectorAll('*')].find(e=>/PROFILES\\s*—\\s*ADD, CHOOSE/i.test((e.textContent||''))&&e.children.length<4);
    const box=hdr?hdr.closest('section')||hdr.parentElement:null;
    if(box){box.style.transition='box-shadow .3s,outline .3s';box.style.outline='3px solid #1c7c6f';box.style.outlineOffset='4px';box.style.borderRadius='8px';box.scrollIntoView({block:'start'});}
    return !!box;`);
  await sleep(1500);

  // point at each profile button in turn and open it — each shows that person's own data
  for (const name of ["John Doe", "Jane Doe", "Emma Doe"]) {
    await point('button', name); await sleep(500);
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(name)})?.click();`);
    await sleep(700);
    // flash the profile name as the active one
    await ev(`const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(name)}); if(b){b.style.transition='background .25s';b.style.background='#dff7ef';b.style.boxShadow='0 0 0 2px #1c7c6f';setTimeout(()=>{try{b.style.boxShadow='';}catch(_){}} ,1400);}`);
    await sleep(2100);
  }
  // land back on John and remove the outline
  await point('button', 'John Doe'); await sleep(300);
  await ev(`const box=[...document.querySelectorAll('section')].find(s=>/PROFILES\\s*—\\s*ADD, CHOOSE/i.test(s.textContent||'')); if(box){box.style.outline='';} return true;`);
  await sleep(800);
}
