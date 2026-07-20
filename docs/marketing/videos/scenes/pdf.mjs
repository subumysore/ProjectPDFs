// Scene: filling a PDF in the browser — click Fill, the completed PDF opens & downloads.
export default {
  name: "pdf",
  width: 760,
  height: 560,
  html: `
    <div class="badge" id="b">◉ A PDF form in your browser</div>
    <div style="display:flex;gap:18px;align-items:center">
      <div class="card" id="doc" style="width:360px;transition:opacity .4s">
        <div style="font-weight:800;color:#0a5">Sample Fillable PDF</div>
        <div style="color:#5a6b6d;font-size:12px;margin-bottom:16px">Please complete this form.</div>
        <div style="margin:14px 0">Please enter your name:</div>
        <div id="nm" style="border:1px solid #cbd5cf;border-radius:6px;padding:8px 10px;min-height:36px;background:#f7fbfa;color:#0e1a1f">&nbsp;</div>
      </div>
      <div style="text-align:center">
        <div class="btn" id="fillbtn" style="transition:transform .2s">Fill this page</div>
        <div style="font-size:11px;color:#5a6b6d;margin-top:6px">(extension)</div>
      </div>
    </div>`,
  async drive(page, h) {
    await h.wait(900);
    await h.badge("◉ Click ‘Fill this page’");
    await page.evaluate(() => (document.getElementById("fillbtn").style.transform = "scale(0.94)"));
    await h.wait(250);
    await page.evaluate(() => (document.getElementById("fillbtn").style.transform = "scale(1)"));
    await h.badge("◉ Reading the PDF · filling from your vault");
    await h.wait(700);
    await page.evaluate(() => (document.getElementById("nm").innerHTML = "John Q Doe"));
    await h.wait(700);
    await h.badge("✓ Filled PDF opened — downloaded ‘Sample-Fillable-PDF-filled.pdf’");
    await h.wait(1800);
  },
};
