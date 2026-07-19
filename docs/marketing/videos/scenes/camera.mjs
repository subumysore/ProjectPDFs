// Scene: scan an ID with the camera -> on-device OCR -> profile fields.
export default {
  name: "camera",
  width: 760,
  height: 560,
  html: `
    <div class="badge" id="b">◉ Scan with camera</div>
    <div style="display:flex;gap:22px;align-items:center">
      <div style="width:320px;height:210px;background:#0b1214;border-radius:12px;position:relative;overflow:hidden;display:grid;place-items:center">
        <div id="scan" style="position:absolute;left:0;right:0;height:3px;background:#3fbcae;box-shadow:0 0 12px #3fbcae;top:0;transition:top 1.6s linear"></div>
        <div style="width:82%;background:#f3efe6;border-radius:8px;padding:10px 12px;font-size:11px;color:#333">
          <div style="font-weight:800;color:#0a7a3a;letter-spacing:1px">DRIVER LICENSE — USA</div>
          <div style="display:flex;gap:8px;margin-top:6px"><div style="width:44px;height:52px;background:#cbd5cf;border-radius:4px"></div>
          <div style="line-height:1.7">Name: <b>John Q Doe</b><br>DOB: 1990-01-15<br>Email: john@example.com</div></div>
        </div>
        <div id="flash" style="position:absolute;inset:0;background:#fff;opacity:0;transition:opacity .12s"></div>
      </div>
      <div class="card" style="width:280px">
        <div style="font-weight:700;margin-bottom:8px">Profile — John Doe</div>
        <div class="fade" style="margin:5px 0"><span class="k">first_name</span> = John</div>
        <div class="fade" style="margin:5px 0"><span class="k">last_name</span> = Doe</div>
        <div class="fade" style="margin:5px 0"><span class="k">date_of_birth</span> = 1990-01-15</div>
        <div class="fade" style="margin:5px 0"><span class="k">email_address</span> = john@…</div>
      </div>
    </div>`,
  async drive(page, h) {
    await h.wait(600);
    await page.evaluate(() => (document.getElementById("scan").style.top = "100%"));
    await h.wait(1700);
    await page.evaluate(() => { const f = document.getElementById("flash"); f.style.opacity = "1"; setTimeout(() => (f.style.opacity = "0"), 120); });
    await h.badge("◉ Reading… on-device OCR");
    await h.wait(700);
    for (const s of [".fade:nth-child(2)", ".fade:nth-child(3)", ".fade:nth-child(4)", ".fade:nth-child(5)"]) { await h.show(s); await h.wait(450); }
    await h.badge("✓ Saved to your profile — no typing");
    await h.wait(1500);
  },
};
