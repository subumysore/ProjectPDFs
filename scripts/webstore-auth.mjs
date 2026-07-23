// Get a Chrome Web Store refresh token, without the copy-paste dance.
//
//   node scripts/webstore-auth.mjs <CLIENT_ID> <CLIENT_SECRET>
//
// Starts a one-shot server on 127.0.0.1, opens Google's consent screen, catches the redirect,
// exchanges the code, and prints the `setx` commands to run. Nothing is written to disk and nothing
// is sent anywhere except Google's token endpoint.
//
// WHY A LOCAL SERVER. The old "copy the code off the screen" flow (redirect_uri
// urn:ietf:wg:oauth:2.0:oob) was deprecated by Google in 2022 and is now REJECTED for new OAuth
// clients — a Desktop-app client must redirect to a loopback address. That is what this does, and
// it is why the instructions that told you to copy a code by hand could never have worked.
//
// The client secret in a Desktop-app OAuth client is not really a secret (it ships in the app, by
// design); the REFRESH TOKEN is. Treat the token like a password: it can publish as you.
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error("usage: node scripts/webstore-auth.mjs <CLIENT_ID> <CLIENT_SECRET>");
  console.error("\nGet both from a Desktop-app OAuth client in a Google Cloud project that has the");
  console.error("Chrome Web Store API enabled. See docs/reference/chrome-web-store.md.");
  process.exit(2);
}

const SCOPE = "https://www.googleapis.com/auth/chromewebstore";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/") { res.writeHead(404).end(); return; }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  const page = (title, body) =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font:16px system-ui;max-width:34rem;margin:4rem auto;padding:0 1rem">` +
    `<h1 style="font-size:1.3rem">${title}</h1>${body}</body>`;

  if (error) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(page("Authorisation refused", `<p>Google said: <code>${error}</code></p><p>You can close this tab.</p>`));
    console.error(`\nAuthorisation refused: ${error}`);
    server.close();
    process.exitCode = 1;
    return;
  }
  if (!code) { res.writeHead(400).end("no code"); return; }

  try {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
    const json = await r.json();

    if (!r.ok || !json.refresh_token) {
      const why = json.error_description || json.error || `HTTP ${r.status}`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(page("Could not get a refresh token", `<p><code>${why}</code></p>`));
      console.error(`\nToken exchange failed: ${why}`);
      if (json.error === "invalid_client") {
        console.error("The client id or secret does not match the OAuth client. Check both.");
      }
      if (!json.refresh_token && r.ok) {
        console.error("Google returned an access token but no refresh token. That happens when this");
        console.error("client was already authorised: revoke it at https://myaccount.google.com/permissions");
        console.error("and run this again.");
      }
      server.close();
      process.exitCode = 1;
      return;
    }

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(page("Done", "<p>Saved. Go back to the terminal — you can close this tab.</p>"));

    // SAVE THE VALUES OURSELVES. Printing `setx` lines for a human to copy looks helpful and is
    // not: a refresh token is ~100 unbroken characters that wraps in a terminal, and a selection
    // that misses part of it stores a truncated token. That happened, and the failure surfaces
    // much later as an opaque "invalid_grant / Bad Request" from Google.
    const save = (name, value) =>
      new Promise((resolve) => {
        // setx, not `set`: this must persist for future processes. Passed as an argv element, so
        // no shell quoting can mangle the value.
        const p = spawn("setx", [name, value], { stdio: "ignore" });
        p.on("close", (code) => resolve(code === 0));
        p.on("error", () => resolve(false));
      });

    const ok = [];
    ok.push(["WEBSTORE_CLIENT_ID", await save("WEBSTORE_CLIENT_ID", clientId)]);
    ok.push(["WEBSTORE_CLIENT_SECRET", await save("WEBSTORE_CLIENT_SECRET", clientSecret)]);
    ok.push(["WEBSTORE_REFRESH_TOKEN", await save("WEBSTORE_REFRESH_TOKEN", json.refresh_token)]);

    console.log("\nRefresh token issued and saved.\n");
    for (const [name, good] of ok) {
      console.log(`  ${good ? "saved" : "FAILED"}  ${name}`);
    }
    // Read them straight back, so a silent truncation cannot go unnoticed a second time.
    const check = spawn("powershell", [
      "-NoProfile", "-Command",
      "[Environment]::GetEnvironmentVariable('WEBSTORE_REFRESH_TOKEN','User').Length",
    ]);
    let len = "";
    check.stdout.on("data", (d) => { len += d; });
    check.on("close", () => {
      const n = parseInt(len.trim(), 10);
      console.log(`\n  stored token length: ${n} (expected roughly ${json.refresh_token.length})`);
      if (n !== json.refresh_token.length) {
        console.log("  MISMATCH - the value did not store correctly. Run this script again.");
      } else {
        console.log("\nStill needed: the item id from the developer console URL");
        console.log("  setx WEBSTORE_ITEM_ID \"<32-char id>\"");
        console.log("\nThen verify:  .\\deploy\\publish-webstore.ps1 -Check\n");
      }
      server.close();
    });
  } catch (e) {
    console.error("\nToken exchange failed:", e.message);
    res.writeHead(500).end("token exchange failed");
    server.close();
    process.exitCode = 1;
  }
});

let redirectUri;
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  redirectUri = `http://127.0.0.1:${port}`;

  const consent = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consent.searchParams.set("client_id", clientId);
  consent.searchParams.set("redirect_uri", redirectUri);
  consent.searchParams.set("response_type", "code");
  consent.searchParams.set("scope", SCOPE);
  consent.searchParams.set("access_type", "offline"); // without this there is no refresh token
  consent.searchParams.set("prompt", "consent");      // force one, even on a re-authorisation

  console.log("Listening on", redirectUri);
  console.log("\nIMPORTANT: this exact URI must be listed under 'Authorised redirect URIs' on the");
  console.log("OAuth client, or Google will refuse with redirect_uri_mismatch. Desktop-app clients");
  console.log("normally accept any 127.0.0.1 port automatically.\n");
  console.log("Opening the consent screen. If it does not open, paste this into a browser:\n");
  console.log(consent.toString() + "\n");

  // Open the default browser.
  //
  // NOT `cmd /c start <url>` on Windows: cmd treats `&` as a command separator, so the URL is cut
  // at the first one and the browser receives only client_id. Google then rejects it with
  // "Required parameter is missing: response_type", which points nowhere near the real cause.
  // rundll32's FileProtocolHandler takes the URL as a single argument with no shell parsing.
  const opener = process.platform === "win32"
    ? spawn("rundll32.exe", ["url.dll,FileProtocolHandler", consent.toString()], { stdio: "ignore", detached: true })
    : spawn(process.platform === "darwin" ? "open" : "xdg-open", [consent.toString()], { stdio: "ignore", detached: true });
  opener.on("error", () => { /* the URL is printed above */ });
  opener.unref();
});

// Do not sit forever if the browser is never completed.
setTimeout(() => {
  console.error("\nTimed out after 5 minutes with no response. Nothing was changed.");
  server.close();
  process.exit(1);
}, 5 * 60 * 1000).unref();
