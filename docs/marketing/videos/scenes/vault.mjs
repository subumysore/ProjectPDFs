// Scene: manage your vault in the popup — type a value, it saves; add a new field.
export default {
  name: "vault",
  width: 760,
  height: 560,
  html: `
    <div class="badge" id="b">◉ Your details — encrypted on this device</div>
    <div class="card" style="width:420px">
      <div style="font-weight:800;font-size:16px;margin-bottom:2px">PolyglotFormFill</div>
      <div style="color:#5a6b6d;font-size:12px;margin-bottom:14px">Nothing leaves your device.</div>
      <div style="display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center;font-size:14px">
        <span class="k">first_name</span><input id="v0" value="John" style="width:100%">
        <span class="k">last_name</span><input id="v1" value="Doe" style="width:100%">
        <span class="k">email_address</span><input id="v2" placeholder="— add value —" style="width:100%">
      </div>
      <div id="saved" class="fade" style="margin-top:10px;color:#0a6a60;font-size:13px">✓ Saved “email_address”</div>
    </div>`,
  async drive(page, h) {
    await h.wait(900);
    await h.badge("◉ Click a value and type — it saves as you go");
    await page.evaluate(() => document.getElementById("v2").classList.add("hot"));
    await page.click("#v2");
    await page.type("#v2", "john@example.com", { delay: 45 });
    await h.wait(250);
    await page.evaluate(() => document.getElementById("v2").classList.remove("hot"));
    await h.show("#saved");
    await h.badge("✓ Vault updated — encrypted at rest");
    await h.wait(1600);
  },
};
