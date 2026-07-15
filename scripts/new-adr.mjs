#!/usr/bin/env node
/**
 * new-adr.mjs — scaffold the next-numbered ADR from the template.
 * Usage: node scripts/new-adr.mjs "Use PostgreSQL as the primary datastore"
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adrDir = join(root, 'docs/adr');

const title = process.argv.slice(2).join(' ').trim();
if (!title) { console.error('Usage: node scripts/new-adr.mjs "<short decision title>"'); process.exit(2); }

const nums = readdirSync(adrDir)
  .map((f) => /^(\d{4})-/.exec(f))
  .filter(Boolean)
  .map((m) => Number(m[1]));
const next = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0');

const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
const file = join(adrDir, `${next}-${slug}.md`);

const tpl = readFileSync(join(adrDir, '0000-template.md'), 'utf8')
  .replace('# ADR-NNNN: <short decision title>', `# ADR-${next}: ${title}`)
  .replace('- **Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX', '- **Status:** Proposed');

writeFileSync(file, tpl);
console.log(`Created ${file}`);
console.log(`Remember to add a line to memory-bank/decisionLog.md.`);
