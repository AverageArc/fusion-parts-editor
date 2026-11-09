// After applying a ledger, re-export and compare, so "it worked" is a measured fact and not the apply script's say-so.
//   node verify_ledger.mjs <export_before> <export_after> <ledger.txt> [--undo undo.txt] [--receipt receipt.txt]
// For every ledger row: DONE (the new export shows the value), STALE (a library file was renamed but the open assembly still shows
// the old component name until the file is saved), or NOT DONE. Then SIDE EFFECTS: any body name, material, appearance or color that
// changed without a ledger row (for example a new material pulling its own appearance with it). The undo ledger puts every changed
// value back (rows for the ledger plus the side effects), made against the AFTER export, so it can be pasted straight back.
// Parts are matched by id, so both exports must come from the same traversal (same assembly, nothing added or removed between them).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatLedger, parseLedger, scopeLabel, sortRows } from './ledger.mjs';

const args = process.argv.slice(2), flag = n => { const i = args.indexOf(n); return i < 0 ? null : args.splice(i, 2)[1]; };
const undoPath = flag('--undo'), receiptPath = flag('--receipt');
const [beforeDir, afterDir, ledgerPath] = args;
if (!beforeDir || !afterDir || !ledgerPath) { console.error('usage: node verify_ledger.mjs <export_before> <export_after> <ledger.txt> [--undo f] [--receipt f]'); process.exit(1); }
const load = d => JSON.parse(readFileSync(join(d, 'assembly.json'), 'utf8'));
const B = load(beforeDir), A = load(afterDir), L = parseLedger(readFileSync(ledgerPath, 'utf8'));
const out = [];
const say = s => { out.push(s); console.log(s); };
if (B.document.name !== A.document.name) { console.error('the two exports are of different documents'); process.exit(1); }
const same = (x, y) => x && y && x.bboxMm && y.bboxMm && x.bboxMm.every((v, i) => Math.abs(v - y.bboxMm[i]) < 0.05);
const aById = Object.fromEntries(A.parts.map(p => [p.id, p])), bById = Object.fromEntries(B.parts.map(p => [p.id, p]));
let mismatched = 0;
for (const p of B.parts) { const q = aById[p.id]; if (!q || q.bodies.length !== p.bodies.length || !p.bodies.every((b, k) => same(b, q.bodies[k]))) mismatched++; }
if (mismatched || B.parts.length !== A.parts.length) { console.error('the two exports do not line up (' + mismatched + ' of ' + B.parts.length + ' parts differ in shape or count). Re-export from the same assembly state, or compare by hand.'); process.exit(1); }

const field = { name: 'name', material: 'material', appearance: 'appearance', color: 'color' };
const covered = new Set(), results = [], undo = [];
for (const r of L.rows) {
  const p = bById[r.part], q = aById[r.part]; let got, status;
  if (r.scope === 'file') {
    got = q.source ? q.source.file : null;
    status = got === r.to ? (q.name === r.to ? 'DONE' : 'STALE') : 'NOT DONE';
    if (status !== 'NOT DONE') undo.push({ part: r.part, scope: 'file', field: 'name', from: r.to, to: r.from, origin: 'undo', where: q.source ? q.source.project + '/' + q.source.folder : '' });
  } else if (r.scope === 'comp') {
    got = q.name; status = got === r.to ? 'DONE' : 'NOT DONE';
    if (status === 'DONE') undo.push({ part: r.part, scope: 'comp', field: 'name', from: r.to, to: r.from, origin: 'undo' });
  } else {
    const b = q.bodies[r.body], f = field[r.field]; covered.add(r.part + ':' + r.body + ':' + (f === 'color' ? 'appearance' : f)); if (f === 'color') covered.add(r.part + ':' + r.body + ':color');
    got = b[f] ?? '';
    status = (f === 'color' ? String(got).toLowerCase() === r.to.toLowerCase() : got === r.to) ? 'DONE' : 'NOT DONE';
    if (status === 'DONE' && f !== 'color') undo.push({ part: r.part, scope: 'body', body: r.body, field: f, from: r.to, to: p.bodies[r.body][f] ?? '', origin: 'undo' });
  }
  results.push({ r, status, got });
}
const count = s => results.filter(x => x.status === s).length;
say('Verified against a fresh export of "' + A.document.name + '" (' + A.exportedAt + '):');
say('  ' + count('DONE') + ' of ' + results.length + ' ledger rows DONE' + (count('STALE') ? ', ' + count('STALE') + ' STALE (file renamed; the assembly shows the new component name after the file is saved)' : '') + (count('NOT DONE') ? ', ' + count('NOT DONE') + ' NOT DONE' : ''));
for (const x of results.filter(x => x.status !== 'DONE')) say('  ' + x.status + ': row ' + x.r.n + ' ' + x.r.part + ' ' + scopeLabel(x.r) + ' ' + x.r.field + ': wanted ' + JSON.stringify(x.r.to) + ', export shows ' + JSON.stringify(x.got));

// anything else that moved
const side = [];
for (const p of B.parts) {
  const q = aById[p.id];
  p.bodies.forEach((b, k) => {
    for (const f of ['name', 'material', 'appearance']) {
      const was = b[f] ?? '', now = q.bodies[k][f] ?? '';
      if (was !== now && !covered.has(p.id + ':' + k + ':' + f)) {
        side.push({ part: p.id, body: k, field: f, was, now, label: p.name });
        undo.push({ part: p.id, scope: 'body', body: k, field: f, from: now, to: was, origin: 'undo, side effect' });
      }
    }
  });
  if (p.kind !== 'root' && !p.referenced && p.name !== q.name && !L.rows.some(r => r.part === p.id && r.scope === 'comp')) side.push({ part: p.id, body: null, field: 'component name', was: p.name, now: q.name, label: p.name });
}
if (side.length) {
  say('  SIDE EFFECTS (changed without a ledger row): ' + side.length);
  for (const s of side) say('    ' + s.part + (s.body === null ? '' : ' body ' + s.body) + ' ' + s.field + ': ' + JSON.stringify(s.was) + ' -> ' + JSON.stringify(s.now) + '  ("' + s.label + '")');
} else say('  No side effects: nothing else changed.');

if (undoPath) {
  const rows = sortRows(undo.filter(u => u.from !== u.to));
  writeFileSync(undoPath, formatLedger({ doc: A.document.name, exportedAt: A.exportedAt, rows }));
  say('  wrote the undo ledger (' + rows.length + ' rows, made against the after-export): ' + undoPath);
}
if (receiptPath) writeFileSync(receiptPath, out.join('\n') + '\n');
process.exit(count('NOT DONE') ? 2 : 0);
