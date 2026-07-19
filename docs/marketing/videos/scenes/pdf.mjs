// Scene: a non-fillable (flat/scanned) PDF becomes fillable, then fills.
export default {
  name: "pdf",
  width: 760,
  height: 560,
  html: `
    <div class="badge" id="b">◉ A flat PDF — no form fields</div>
    <div class="card" style="width:520px;position:relative">
      <div style="font-weight:800;color:#0a5">Sample Application (scanned)</div>
      <div style="color:#5a6b6d;font-size:12px;margin-bottom:14px">This PDF has no fillable boxes.</div>
      <div style="position:relative">
        <div style="margin:14px 0">Full name: <span style="display:inline-block;border-bottom:1px solid #bbb;width:240px"></span></div>
        <div style="margin:14px 0">Email: <span style="display:inline-block;border-bottom:1px solid #bbb;width:240px"></span></div>
        <div style="margin:14px 0">Phone: <span style="display:inline-block;border-bottom:1px solid #bbb;width:200px"></span></div>
        <div id="f0" class="fld" style="left:78px;top:2px">John Q Doe</div>
        <div id="f1" class="fld" style="left:48px;top:46px">john@example.com</div>
        <div id="f2" class="fld" style="left:52px;top:90px">+1 (555) 123-4567</div>
      </div>
    </div>
    <style>.fld{position:absolute;border:2px dashed #0d8f83;border-radius:5px;padding:1px 8px;background:rgba(227,242,239,.6);opacity:0;transition:opacity .5s;min-width:200px;color:transparent}
    .fld.box{opacity:1}.fld.full{color:#0e1a1f;background:#fff}</style>`,
  async drive(page, h) {
    await h.wait(1200);
    await h.badge("◉ OCR detecting fields…");
    for (const id of ["f0", "f1", "f2"]) { await page.evaluate((i) => document.getElementById(i).classList.add("box"), id); await h.wait(400); }
    await h.badge("◉ Created 3 fields — filling from vault");
    await h.wait(500);
    for (const id of ["f0", "f1", "f2"]) { await page.evaluate((i) => document.getElementById(i).classList.add("full"), id); await h.wait(450); }
    await h.badge("✓ Exported filled.pdf — all on-device");
    await h.wait(1500);
  },
};
