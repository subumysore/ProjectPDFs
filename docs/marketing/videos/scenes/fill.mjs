// Scene: auto-filling a web form from the vault.
const FILL = [
  ["fullname", "John Q Doe"], ["email", "john@example.com"], ["phone", "+1 (555) 123-4567"],
  ["address", "123 Main St, Apt 4B"], ["city", "Springfield"], ["state", "IL"], ["zip", "62704"],
];

export default {
  name: "fill",
  width: 760,
  height: 560,
  html: `
    <div class="badge" id="b">◉ PolyglotFormFill — filling from your vault</div>
    <div class="cursor" id="cur" style="position:fixed;width:26px;height:26px;border-radius:50%;background:rgba(13,143,131,.25);border:2px solid #0d8f83;pointer-events:none;transition:left .4s,top .4s;z-index:9;left:-50px;top:-50px"></div>
    <div class="card" style="width:620px">
      <h2 style="margin:0 0 4px">New Patient Registration</h2>
      <p style="color:#5a6b6d;font-size:13px;margin:0 0 16px">Watch it fill from your on-device vault — nothing typed, nothing uploaded.</p>
      <div style="font-size:12px;font-weight:600;color:#33474a;margin:10px 0 4px">Full name</div><input id="fullname" style="width:100%">
      <div style="font-size:12px;font-weight:600;color:#33474a;margin:10px 0 4px">Email</div><input id="email" style="width:100%">
      <div style="font-size:12px;font-weight:600;color:#33474a;margin:10px 0 4px">Phone</div><input id="phone" style="width:100%">
      <div style="font-size:12px;font-weight:600;color:#33474a;margin:10px 0 4px">Address</div><input id="address" style="width:100%">
      <div style="display:flex;gap:12px">
        <div style="flex:2"><div style="font-size:12px;font-weight:600;color:#33474a;margin:10px 0 4px">City</div><input id="city" style="width:100%"></div>
        <div style="flex:1"><div style="font-size:12px;font-weight:600;color:#33474a;margin:10px 0 4px">State</div><input id="state" style="width:100%"></div>
        <div style="flex:1"><div style="font-size:12px;font-weight:600;color:#33474a;margin:10px 0 4px">ZIP</div><input id="zip" style="width:100%"></div>
      </div>
    </div>`,
  async drive(page, h) {
    await h.wait(900);
    for (const [id, val] of FILL) {
      const box = await page.$eval(`#${id}`, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
      await page.evaluate(({ x, y }) => { const c = document.getElementById("cur"); c.style.left = x + "px"; c.style.top = y - 13 + "px"; }, box);
      await h.wait(320);
      await page.evaluate((id) => document.getElementById(id).classList.add("hot"), id);
      await page.click(`#${id}`);
      await page.type(`#${id}`, val, { delay: 26 });
      await h.wait(150);
      await page.evaluate((id) => document.getElementById(id).classList.remove("hot"), id);
    }
    await page.evaluate(() => { document.getElementById("cur").style.opacity = "0"; document.getElementById("b").textContent = "✓ Filled in 1 click — on your device"; });
    await h.wait(1600);
  },
};
