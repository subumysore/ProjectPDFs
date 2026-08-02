// Drive the extension popup in the demo Chrome (port 9333): set a passphrase, fill the vault with
// SYNTHETIC John Doe, and enable auto-fill-on-load. Local vault only — no host, no real data.
const PORT = 9333;
const EXT = process.argv[2]; // extension id
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() { return (await (await fetch(`http://localhost:${PORT}/json`)).json()); }
function client(ws) {
  const sock = new WebSocket(ws);
  let id = 0; const pending = new Map();
  const ready = new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  sock.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
  return { ready, send, close: () => sock.close(),
    async ev(expr) { const r = await send("Runtime.evaluate", { expression: `(function(){ ${expr} })()`, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; } };
}

const popupUrl = `chrome-extension://${EXT}/popup.html`;
const formTab = (await targets()).find((x) => x.url.includes("demo-form"));
if (!formTab) { console.log("no form tab"); process.exit(1); }
const c = client(formTab.webSocketDebuggerUrl);
await c.ready; await c.send("Runtime.enable"); await c.send("Page.enable");
// navigate the form tab to the popup for one-time vault setup
await c.send("Page.navigate", { url: popupUrl });
await sleep(2000);

// 1) set passphrase / unlock
const hasPass = await c.ev(`return !!document.querySelector('input[type=password]')`);
if (hasPass) {
  await c.ev(`const p=document.querySelector('input[type=password]'); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(p,'demo1234'); p.dispatchEvent(new Event('input',{bubbles:true}));`);
  await sleep(300);
  await c.ev(`const b=[...document.querySelectorAll('button')].find(x=>/unlock|set|continue|create/i.test(x.textContent)); if(b)b.click();`);
  await sleep(2500);
}
// 2) fill vault values (seeded keys have empty values; set them + add missing)
const data = [["first_name","John"],["last_name","Doe"],["email_address","john.doe@example.com"],["cell_phone","+1 555 0142"],["address","100 Sample Ave, Demo City DC"],["occupation","Engineer"],["nationality","American"],["gender","Male"],["marital_status","Single"]];
for (const [k,v] of data) {
  await c.ev(`
    const key=${JSON.stringify(k)}, val=${JSON.stringify(v)};
    const set=(el,x)=>{const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el,x); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));};
    const ka=document.querySelector('#newKey'); const va=document.querySelector('#newVal');
    if(ka&&va){ set(ka,key); set(va,val); const add=[...document.querySelectorAll('button')].find(b=>/add|save/i.test(b.textContent)); if(add)add.click(); }
  `);
  await sleep(350);
}
// 3) enable auto-fill on load
await c.ev(`const cb=document.querySelector('#autofillOnLoad'); if(cb&&!cb.checked){cb.click();}`);
await sleep(400);
const keys = await c.ev(`return [...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/john|doe|example/i.test(e.textContent)).length`);
console.log("vault populated, John Doe refs:", keys);
c.close();
