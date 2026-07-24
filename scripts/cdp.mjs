// Reliable app driver over Chrome DevTools Protocol (the app's WebView2 exposes it).
// Drives the app BY ELEMENT, not by pixel — so layout shifts / transient banners can't break it.
// Launch the app first with:  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
//
// Usage as a module:
//   import { connect } from "./cdp.mjs";
//   const app = await connect();
//   await app.eval("document.title");
//   await app.clickText("2 · Profile & Vault");
//   await app.setFile("input[type=file]", "C:/ppfdemo/passport.pdf");
//
// CLI:  node scripts/cdp.mjs "<js expression>"     — evaluate JS in the app and print the result.
const PORT = process.env.CDP_PORT || 9223;

async function wsUrl() {
  const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const page = list.find((t) => t.type === "page" && t.url.includes("tauri")) || list.find((t) => t.type === "page");
  if (!page) throw new Error("no app page on CDP " + PORT);
  return { ws: page.webSocketDebuggerUrl, id: page.id };
}

export async function connect() {
  const { ws: url } = await wsUrl();
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("DOM.enable"); await send("Page.enable");

  // Evaluate JS in the page; returns the value (JSON-serialized).
  async function ev(expr) {
    const r = await send("Runtime.evaluate", { expression: `(function(){ ${expr} })()`, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    if (r.result?.result?.subtype === "error") throw new Error(r.result.result.description);
    return r.result?.result?.value;
  }
  const api = {
    ev,
    eval: (e) => ev(`return (${e})`),
    // Click the first visible element whose text (trimmed) equals or contains `text`.
    clickText: (text) => ev(`
      const t=${JSON.stringify(text)};
      const els=[...document.querySelectorAll('button,a,[role=tab],label,div,span')];
      const el=els.find(e=>e.offsetParent!==null && (e.textContent||'').trim()===t)
            || els.find(e=>e.offsetParent!==null && (e.textContent||'').trim().includes(t));
      if(!el) throw new Error('no element: '+t);
      el.scrollIntoView({block:'center'}); el.click(); return true;`),
    // Set an input's value and fire input/change (React-friendly).
    setInput: (selector, value) => ev(`
      const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('no input '+${JSON.stringify(selector)});
      const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return el.value;`),
    // Set a file on an <input type=file> via CDP (no OS dialog).
    async setFile(selector, filePath) {
      const doc = await send("DOM.getDocument", { depth: -1 });
      const node = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector });
      if (!node.result.nodeId) throw new Error("no file input " + selector);
      await send("DOM.setFileInputFiles", { files: [filePath], nodeId: node.result.nodeId });
      return true;
    },
    close: () => ws.close(),
  };
  return api;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
  const app = await connect();
  console.log(JSON.stringify(await app.eval(process.argv[2] || "document.title"), null, 2));
  app.close();
}
