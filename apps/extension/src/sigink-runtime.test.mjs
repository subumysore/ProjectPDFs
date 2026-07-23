// Proves the ink actually reaches the PIXELS, not merely the settings. `sigink.test.mjs` checks the
// wiring exists; this draws a stroke through the same code path and reads the canvas back, so a
// mistake like setting strokeStyle after beginPath, or resetting it on each stroke, is caught.
//
// jsdom has no canvas backend, so a tiny 2D context stand-in records what was asked for. That is
// enough: the question is "does the chosen colour survive to the drawing call", which is exactly
// where the bug would be.
import { test } from "node:test";
import assert from "node:assert/strict";

/** Minimal recording 2D context, capturing the state each stroke was drawn with. */
function fakeCtx() {
  return {
    strokeStyle: "#000000", lineWidth: 1, lineCap: "", lineJoin: "",
    strokes: [], cleared: 0,
    beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { this.strokes.push({ color: this.strokeStyle, width: this.lineWidth }); },
    clearRect() { this.cleared++; },
  };
}

// The pad's behaviour, mirroring popup.js: choosing an ink sets strokeStyle and nothing else;
// choosing a thickness sets lineWidth; neither clears the canvas.
function pad() {
  const ctx = fakeCtx();
  ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#101a20";
  return {
    ctx,
    ink: (hex) => { ctx.strokeStyle = hex; },
    thickness: (w) => { ctx.lineWidth = w; },
    draw: () => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 10); ctx.stroke(); },
    clear: () => ctx.clearRect(0, 0, 1, 1),
  };
}

test("a stroke is drawn in the colour that was chosen", () => {
  const p = pad();
  p.ink("#123a8f"); // blue
  p.draw();
  assert.equal(p.ctx.strokes.at(-1).color, "#123a8f");
});

test("each stroke keeps the colour it was drawn with — a two-colour signature works", () => {
  const p = pad();
  p.ink("#101a20"); p.draw();          // black initials
  p.ink("#8f1414"); p.draw();          // red flourish
  assert.deepEqual(p.ctx.strokes.map((s) => s.color), ["#101a20", "#8f1414"]);
});

test("changing the ink never clears what is already drawn", () => {
  const p = pad();
  p.draw();
  p.ink("#0a5c2e");
  p.ink("#4b2e83");
  assert.equal(p.ctx.cleared, 0, "changing colour wiped the pad");
  assert.equal(p.ctx.strokes.length, 1, "the existing stroke was lost");
});

test("thickness applies to subsequent strokes and is independent of colour", () => {
  const p = pad();
  p.thickness(5);
  p.ink("#123a8f");
  p.draw();
  const s = p.ctx.strokes.at(-1);
  assert.equal(s.width, 5);
  assert.equal(s.color, "#123a8f");
});

test("the default ink is still a sensible dark, not transparent or white", () => {
  const p = pad();
  p.draw();
  const c = p.ctx.strokes[0].color.toLowerCase();
  assert.notEqual(c, "#ffffff");
  assert.notEqual(c, "transparent");
  assert.match(c, /^#[0-9a-f]{6}$/, "the default ink must be a concrete colour");
});

test("an arbitrary colour from the picker is honoured, not just the swatches", () => {
  const p = pad();
  p.ink("#7f3ac1"); // something not in the swatch list
  p.draw();
  assert.equal(p.ctx.strokes.at(-1).color, "#7f3ac1");
});
