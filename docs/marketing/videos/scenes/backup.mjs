// Scene: encrypted backup -> move the file -> import on another device.
export default {
  name: "backup",
  width: 760,
  height: 560,
  html: `
    <div class="badge" id="b">◉ Encrypted backup &amp; transfer</div>
    <div style="display:flex;gap:26px;align-items:center">
      <div class="card" style="width:210px"><div style="font-weight:700;margin-bottom:6px">This device</div>
        <div style="font-size:12px;color:#5a6b6d">vault: John Doe · 12 fields</div>
        <div class="btn" style="margin-top:10px">Export encrypted</div></div>
      <div id="file" style="opacity:0;transition:opacity .4s,transform 1.2s;font-size:12px;text-align:center">
        <div style="font-size:34px">🔒</div>vault.ppfvault<br><span style="color:#5a6b6d">AES-256</span></div>
      <div class="card" style="width:210px"><div style="font-weight:700;margin-bottom:6px">Other device</div>
        <div class="btn" style="margin-bottom:8px">Import file…</div>
        <div class="fade" style="font-size:12px;color:#0a6a60">✓ 12 fields imported</div></div>
    </div>`,
  async drive(page, h) {
    await h.wait(1000);
    await h.set("#file", "opacity", "1");
    await h.wait(300);
    await h.set("#file", "transform", "translateX(120px)");
    await h.badge("◉ Move the file to any device");
    await h.wait(1400);
    await h.show(".fade");
    await h.badge("✓ Same file works in app & extension");
    await h.wait(1500);
  },
};
