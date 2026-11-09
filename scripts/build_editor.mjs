// Build the parts-editor page from a Fusion export.
//   node build_editor.mjs <export_dir> [output.html]
// Reads <export_dir>/assembly.json and meshes.json (written by fusion_export.py) and writes one self-contained HTML file
// (default: <export_dir>/parts-editor.html). The only network use is loading three.js from a CDN when the page is opened.
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
if (!dir) { console.error('usage: node build_editor.mjs <export_dir> [output.html]'); process.exit(1); }
const out = process.argv[3] || join(dir, 'parts-editor.html');
const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(here, '..', 'assets', 'parts-editor.template.html'), 'utf8');
const assembly = JSON.parse(readFileSync(join(dir, 'assembly.json'), 'utf8'));
const meshes = JSON.parse(readFileSync(join(dir, 'meshes.json'), 'utf8'));

// Pack: positions as Int16 relative to each mesh's own center and scale (so tiny screws and huge plates both keep precision),
// indices as Uint32. One deflated blob for the whole assembly.
const pos = [], idx = [], geo = [];
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
  geo.push({ key, vo, vn: n, io, in: m.idx.length, c: c.map(v => +v.toFixed(3)), k: +(1 / s).toPrecision(8) });
  vo += n; io += m.idx.length;
}
const posBytes = pos.length * 2, pad = (4 - (posBytes % 4)) % 4;
const buf = Buffer.alloc(posBytes + pad + idx.length * 4);
pos.forEach((v, i) => buf.writeInt16LE(v, i * 2));
idx.forEach((v, i) => buf.writeUInt32LE(v, posBytes + pad + i * 4));
const blob = deflateSync(buf, { level: 9 }).toString('base64');

const html = template
  .replace('__ASSEMBLY__', () => JSON.stringify(assembly))
  .replace('__GEO__', () => JSON.stringify({ meshes: geo, pn: pos.length, pad, blob }));
writeFileSync(out, html);
const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`wrote ${resolve(out)} (${kb} KB): ${assembly.parts.length} parts, ${geo.length} meshes, ${(idx.length / 3).toLocaleString()} triangles`);
if (kb > 600) console.log('note: larger than about 600 KB, so the Claude desktop preview pane may not open it; open the file in a normal browser, or serve the folder locally.');
