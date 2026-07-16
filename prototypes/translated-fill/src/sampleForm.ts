import { PDFDocument } from 'pdf-lib';

/**
 * Build a *scanned-style* Japanese form: we draw the form onto a canvas (using the
 * browser's system CJK font) and embed it as a full-page IMAGE. The result is an
 * image-only, non-editable PDF — exactly the hard input the spike targets.
 */
export async function generateSampleJapanesePdf(): Promise<Uint8Array> {
  const scale = 2; // render crisp, then embed
  const w = 595 * scale; // A4 width in pt * scale
  const h = 842 * scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111111';

  ctx.font = `${28 * scale}px "Yu Gothic", "MS Gothic", "Noto Sans JP", sans-serif`;
  ctx.fillText('入国申請フォーム', 60 * scale, 80 * scale);

  const rows: string[] = ['氏名：', '生年月日：', '国籍：', '住所：', '電話番号：', 'パスポート番号：'];
  ctx.font = `${18 * scale}px "Yu Gothic", "MS Gothic", "Noto Sans JP", sans-serif`;
  let y = 160 * scale;
  for (const label of rows) {
    ctx.fillText(label, 60 * scale, y);
    // draw an underline to mimic a blank to fill
    ctx.strokeStyle = '#999';
    ctx.beginPath();
    ctx.moveTo(220 * scale, y + 4 * scale);
    ctx.lineTo(520 * scale, y + 4 * scale);
    ctx.stroke();
    y += 70 * scale;
  }

  const pngUrl = canvas.toDataURL('image/png');
  const pngBytes = await (await fetch(pngUrl)).arrayBuffer();

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const img = await pdf.embedPng(pngBytes);
  page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  return pdf.save();
}
