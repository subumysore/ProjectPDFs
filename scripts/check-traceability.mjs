#!/usr/bin/env node
/**
 * check-traceability.mjs — reconcile the BRD against the traceability matrix.
 * Zero dependencies. Fails (exit 1) if any requirement id is in one place but not the other.
 *
 * Usage: node scripts/check-traceability.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRD = join(root, 'docs/requirements/BUSINESS_REQUIREMENTS_DOCUMENT.md');
const MATRIX = join(root, 'memory-bank/requirements-traceability-matrix.md');

// REQ-NN.M or REQ-NN-UI.M
const REQ = /\bREQ-\d+(?:-[A-Z]+)?\.\d+\b/g;

function ids(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch { console.error(`✗ cannot read ${file}`); process.exit(2); }
  return new Set(text.match(REQ) ?? []);
}

const brd = ids(BRD);
const matrix = ids(MATRIX);

// Ignore the template placeholder id used in the scaffold.
const IGNORE = new Set(['REQ-00.1', 'REQ-NN.M']);
for (const s of [brd, matrix]) for (const i of IGNORE) s.delete(i);

const missingInMatrix = [...brd].filter((id) => !matrix.has(id));
const orphanInMatrix = [...matrix].filter((id) => !brd.has(id));

let ok = true;
console.log('Traceability check\n');
if (brd.size === 0 && matrix.size === 0) {
  console.log('  (no real requirements yet — add REQ-NN.M to the BRD and the matrix)');
}
if (missingInMatrix.length) {
  ok = false;
  console.log(`  ✗ ${missingInMatrix.length} BRD requirement(s) missing from the matrix: ${missingInMatrix.join(', ')}`);
} else {
  console.log('  ✓ every BRD requirement appears in the matrix');
}
if (orphanInMatrix.length) {
  ok = false;
  console.log(`  ✗ ${orphanInMatrix.length} matrix id(s) not found in the BRD: ${orphanInMatrix.join(', ')}`);
} else {
  console.log('  ✓ every matrix id maps to a real BRD requirement');
}

console.log('');
if (!ok) { console.error('FAILED: BRD and matrix are inconsistent.'); process.exit(1); }
console.log(`PASSED: ${brd.size} requirement(s) traced; BRD and matrix are consistent.`);
