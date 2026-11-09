// Turn a short proposal spec into a full answers file that the page can load and fusion_apply.py understands.
//   node make_proposal.mjs <export_dir> <spec.json> <answers_out.json>
// Why: the answers format repeats paths, "was" values and body names from the export. Writing those by hand is slow and
// easy to get wrong, so Claude writes only what should change, and this script fills in the rest from assembly.json.
//
// Spec format (all fields except "part" are optional):
// { "edits": [ {
//     "part": "p6",                       // part id from the export (audit.mjs prints them)
//     "name": "M3 washer",                // component name; for a top-level body part, the body name; for a linked part, the new name of its LIBRARY FILE (renamed in every design)
//     "reason": "Washers are steel",      // shown in the page next to the part
//     "material": "Stainless Steel AISI 304", "appearance": "Stainless Steel - Satin", "customColor": "#aabbcc",   // all bodies
//     "bodies": [ { "index": 0, "name": "Washer", "material": "...", "appearance": "...", "customColor": "#..." } ]   // one body, overrides the above
// } ] }
// Values equal to what the part already has are dropped, so the result holds only real changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, specPath, outPath] = process.argv.slice(2);
if (!dir || !specPath || !outPath) { console.error('usage: node make_proposal.mjs <export_dir> <spec.json> <answers_out.json>'); process.exit(1); }
const A = JSON.parse(readFileSync(join(dir, 'assembly.json'), 'utf8'));
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const byId = Object.fromEntries(A.parts.map(p => [p.id, p]));
const mats = new Set(A.libraries.materials.map(m => m.name)), apps = new Set(A.libraries.appearances.map(a => a.name));
const problems = [];
const edits = [];

for (const s of spec.edits || []) {
  const p = byId[s.part];
  if (!p) { problems.push(`${s.part}: no such part id`); continue; }
  const e = { part: p.id, kind: p.kind, linked: p.referenced, partName: p.name, paths: p.paths.slice(0, 400) };
  const perBody = new Map();
  const want = (k, f, v) => { if (v === undefined) return; if (!perBody.has(k)) perBody.set(k, {}); perBody.get(k)[f] = v; };
  p.bodies.forEach((_, k) => { for (const f of ['material', 'appearance', 'customColor']) want(k, f, s[f]); });
  if (s.name !== undefined) {
    if (p.kind === 'root') want(0, 'name', s.name);
    else if (p.referenced && p.source) { if (s.name !== p.source.file) e.renameSource = { fileId: p.source.fileId, from: p.source.file, to: s.name, project: p.source.project, folder: p.source.folder }; }   // renames the library file, everywhere
    else if (p.referenced) problems.push(`${p.id} "${p.name}": linked, and its source file is not known (a link inside a linked file), so it cannot be renamed here; rename skipped`);
    else if (s.name !== p.name) e.rename = { from: p.name, to: s.name };
  }
  for (const b of s.bodies || []) {
    if (!p.bodies[b.index]) { problems.push(`${p.id}: no body ${b.index}`); continue; }
    for (const f of ['name', 'material', 'appearance', 'customColor']) want(b.index, f, b[f]);
  }
  const bodies = [];
  for (const [k, set] of [...perBody].sort((a, b) => a[0] - b[0])) {
    const b = p.bodies[k], o = { index: k, bodyName: b.name, was: {}, set: {} };
    for (const [f, v] of Object.entries(set)) {
      if (f === 'customColor') { if (!/^#[0-9a-fA-F]{6}$/.test(v)) { problems.push(`${p.id}: bad color "${v}"`); continue; } o.set[f] = v.toLowerCase(); continue; }
      if (v === (b[f] ?? null)) continue;
      if (f === 'material' && !mats.has(v)) problems.push(`${p.id} "${p.name}": material "${v}" is not in the export's library list`);
      if (f === 'appearance' && !apps.has(v)) problems.push(`${p.id} "${p.name}": appearance "${v}" is not in the export's library list`);
      o.set[f] = v; o.was[f] = b[f] ?? null;
    }
    if (Object.keys(o.set).length) bodies.push(o);
  }
  if (bodies.length) e.bodies = bodies;
  if (!e.rename && !e.renameSource && !bodies.length) continue;
  if (s.reason) e.reason = String(s.reason);
  edits.push(e);
}

const out = { format: 'fusion-parts-answers/1', document: A.document.name, exportedAt: A.exportedAt, allowLinked: edits.some(e => e.linked && e.bodies), allowSourceRename: edits.some(e => e.renameSource), edits };
writeFileSync(outPath, JSON.stringify(out, null, 1));
const linked = edits.filter(e => e.linked).length;
const files = edits.filter(e => e.renameSource).length;
const n = edits.reduce((a, e) => a + (e.rename || e.renameSource ? 1 : 0) + (e.bodies || []).reduce((x, b) => x + Object.keys(b.set).length, 0), 0);
console.log(`wrote ${outPath}: ${n} change${n === 1 ? '' : 's'} in ${edits.length} part${edits.length === 1 ? '' : 's'} (${linked} linked: library parts are edited in their source file for every design that uses it)`);
if (files) console.log(`${files} of them rename a library file, which renames that part in every design that uses it; the apply step lists each file and needs the owner's yes.`);
for (const m of problems) console.log('PROBLEM ' + m);
if (problems.length) process.exitCode = 2;
