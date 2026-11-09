// Build the parts-editor page from a Fusion export.
//   node build_editor.mjs <export_dir> [output.html] [--proposal answers.json] [--offline]
// Reads <export_dir>/assembly.json and meshes.json (written by fusion_export.py) and writes one self-contained HTML file
// (default: <export_dir>/parts-editor.html). The only network use is loading three.js from a CDN when the page is opened,
// unless --offline inlines it (about 0.9 MB more).
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// optional: --proposal <answers.json> pre-loads suggested edits into the page (see make_proposal.mjs)
const args = process.argv.slice(2);
const pi = args.indexOf('--proposal');
const proposalPath = pi >= 0 ? args.splice(pi, 2)[1] : null;
// optional: --offline puts three.js inside the page so it opens with no network (needs: npm install three@0.160.0 --no-save, in this folder)
const oi = args.indexOf('--offline'); const offline = oi >= 0; if (offline) args.splice(oi, 1);
const dir = args[0];
if (!dir || (pi >= 0 && !proposalPath)) { console.error('usage: node build_editor.mjs <export_dir> [output.html] [--proposal answers.json] [--offline]'); process.exit(1); }
const out = args[1] || join(dir, 'parts-editor.html');
const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(here, '..', 'assets', 'parts-editor.template.html'), 'utf8');
const assembly = JSON.parse(readFileSync(join(dir, 'assembly.json'), 'utf8'));
const meshes = JSON.parse(readFileSync(join(dir, 'meshes.json'), 'utf8'));

// Pack: positions as Int16 relative to each mesh's own center and scale (so tiny screws and huge plates both keep precision),
// indices as Uint32. One deflated blob for the whole assembly.
const pos = [], idx = [], nrm = [], geo = [];
let vo = 0, io = 0;
for (const [key, m] of Object.entries(meshes)) {
  const n = m.pos.length / 3;
  if (!n) continue;
  const mn = [1e18, 1e18, 1e18], mx = [-1e18, -1e18, -1e18];
  for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.pos[i + k]); mx[k] = Math.max(mx[k], m.pos[i + k]); }
  const c = mn.map((v, k) => (v + mx[k]) / 2);
  const half = Math.max(...mx.map((v, k) => v - c[k]), 1e-6);
  const s = 32000 / half;
  for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) pos.push(Math.round((m.pos[i + k] - c[k]) * s));
  for (const v of m.idx) idx.push(v);
  const hn = Array.isArray(m.nrm) && m.nrm.length === m.pos.length;   // Fusion's own vertex normals (integers, 127 = 1.0); the STEP route has none
  if (hn) for (const v of m.nrm) nrm.push(v); else for (let i = 0; i < m.pos.length; i++) nrm.push(0);
  geo.push({ key, vo, vn: n, io, in: m.idx.length, hn: hn ? 1 : 0, c: c.map(v => +v.toFixed(3)), k: +(1 / s).toPrecision(8) });
  vo += n; io += m.idx.length;
}
const posBytes = pos.length * 2, pad = (4 - (posBytes % 4)) % 4;
const buf = Buffer.alloc(posBytes + pad + idx.length * 4 + nrm.length);
pos.forEach((v, i) => buf.writeInt16LE(v, i * 2));
idx.forEach((v, i) => buf.writeUInt32LE(v, posBytes + pad + i * 4));
nrm.forEach((v, i) => buf.writeInt8(v, posBytes + pad + idx.length * 4 + i));
const blob = deflateSync(buf, { level: 9 }).toString('base64');

// JSON goes inside a <script>: "<" (as in "</script>") and the two Unicode line separators must not appear raw
const safe = s => s.replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

let proposal = null;
if (proposalPath) {
  proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
  if (!String(proposal.format || '').startsWith('fusion-parts-answers/') || !Array.isArray(proposal.edits)) { console.error('the proposal is not an answers file (format fusion-parts-answers/1)'); process.exit(1); }
  if (proposal.document !== assembly.document.name) { console.error(`the proposal is for "${proposal.document}" but the export is "${assembly.document.name}"`); process.exit(1); }
  if (proposal.exportedAt !== assembly.exportedAt) console.log('WARNING: the proposal was made from a different export of this document; parts that changed since will be skipped by the page.');
  const ids = new Set(assembly.parts.map(p => p.id));
  const bad = proposal.edits.filter(e => !ids.has(e.part));
  if (bad.length) console.log(`WARNING: ${bad.length} proposed part id(s) are not in this export: ${bad.map(e => e.part).join(', ')}`);
  const linked = proposal.edits.filter(e => e.linked).length;
  console.log(`proposal: ${proposal.edits.length} part(s) with suggested edits${linked ? `, ${linked} of them linked (library parts are editable; nested links stay locked and out of the ledger until unlocked)` : ''}`);
}

// the ledger library is plain JS with `export` keywords; inlined (no imports) so the page and the Node tools share one implementation
const ledgerLib = readFileSync(join(here, 'ledger.mjs'), 'utf8').replace(/^export /gm, '');
// three.js: from a CDN by default, or inlined as data: modules (an import map points "three" and the add-ons at them)
let imports = { 'three': 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/' };
if (offline) {
  const root = join(here, 'node_modules', 'three');
  if (!existsSync(join(root, 'build', 'three.module.min.js'))) { console.error('--offline needs three.js: run "npm install three@0.160.0 --no-save" in ' + here); process.exit(1); }
  const mod = p => 'data:text/javascript;base64,' + readFileSync(join(root, p)).toString('base64');
  imports = { 'three': mod('build/three.module.min.js'),
    'three/addons/controls/OrbitControls.js': mod('examples/jsm/controls/OrbitControls.js'),
    'three/addons/environments/RoomEnvironment.js': mod('examples/jsm/environments/RoomEnvironment.js') };
}
const html = template
  .replace('__IMPORTMAP__', () => JSON.stringify({ imports }))
  .replace('__LEDGER_LIB__', () => ledgerLib.replace(/<\/script/gi, '<\\/script'))
  .replace('__ASSEMBLY__', () => safe(JSON.stringify(assembly)))
  .replace('__PROPOSAL__', () => safe(JSON.stringify(proposal)))
  .replace('__GEO__', () => safe(JSON.stringify({ meshes: geo, pn: pos.length, pad, tn: idx.length, blob })));
writeFileSync(out, html);
const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`wrote ${resolve(out)} (${kb} KB): ${assembly.parts.length} parts, ${geo.length} meshes, ${(idx.length / 3).toLocaleString()} triangles`);
if (kb > 600) console.log('note: larger than about 600 KB, so the Claude desktop preview pane may not open it; open the file in a normal browser, or serve the folder locally.');
