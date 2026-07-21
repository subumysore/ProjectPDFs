// Hot-reload the dev-loaded extension via Chrome DevTools Protocol — picks up the latest
// source from apps\extension with NO manual clicks. Requires the dev Chrome started by
// deploy\dev-launch-chrome.ps1 (it opens the remote-debugging port). Reloading also
// re-reads changed files from disk for an unpacked extension, so this = "install latest".
//
// Usage:  node deploy/dev-reload.mjs
const PORT = 9222;
const EXT_ID = "ikocicibacolgmamehagnpcgfabcamfk"; // our fixed extension id (manifest "key")

async function main() {
  let targets;
  try {
    targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  } catch (e) {
    console.error(`Can't reach dev Chrome on :${PORT}. Launch it first:  powershell -File deploy\\dev-launch-chrome.ps1`);
    process.exit(1);
  }
  // The extension's service worker (MV3 background) is the reliable place to call
  // chrome.runtime.reload(). Fall back to any page of our extension.
  const sw = targets.find((t) => t.url && t.url.includes(EXT_ID) && (t.type === "service_worker" || t.type === "background_page"))
    || targets.find((t) => t.url && t.url.includes(EXT_ID));
  if (!sw || !sw.webSocketDebuggerUrl) {
    console.error("Couldn't find the extension's service worker. Open the extension once (click its icon) so the worker wakes, then retry.");
    process.exit(1);
  }

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(sw.webSocketDebuggerUrl);
    const done = (ok) => { try { ws.close(); } catch {} ok ? resolve() : null; };
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      // Reloading kills this worker, so the response may never arrive — that's success.
      ws.send(JSON.stringify({ id: 2, method: "Runtime.evaluate", params: { expression: "chrome.runtime.reload()" } }));
      setTimeout(() => { console.log("✓ Extension reloaded from source (latest code is live)."); done(true); }, 600);
    };
    ws.onerror = (e) => { console.error("WebSocket error:", e.message || e); reject(new Error("ws")); };
  });
}
main().catch(() => process.exit(1));
