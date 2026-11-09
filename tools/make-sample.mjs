// Writes a small made-up assembly in the same format the Fusion export script produces, so the editor page can be tried (and tested) without Fusion.
//   node tools/make-sample.mjs [out_dir]  writes assembly.json and meshes.json (default: examples/sample-export)
// The assembly is "Demo bracket": two plates with default names, a bracket (2 copies), 4 screws that count as "linked" parts (to show the lock), and 4 washers.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] ? resolve(process.argv[2]) : join(resolve(fileURLToPath(new URL('..', import.meta.url))), 'examples', 'sample-export');
mkdirSync(out, { recursive: true });

const box = (w, d, h) => {   // centered on the origin; x = width, y = depth, z = height
  const p = []; for (let c = 0; c < 8; c++) p.push((c & 1 ? 1 : -1) * w / 2, (c & 2 ? 1 : -1) * d / 2, (c & 4 ? 1 : -1) * h / 2);
  return { pos: p, idx: [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5] };
};
const cyl = (r, h, n = 20, rInner = 0) => {   // along z, centered; a hollow ring when rInner > 0
  const pos = [], idx = [];
  const ring = (rad, z) => { for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pos.push(Math.cos(a) * rad, Math.sin(a) * rad, z); } };
  ring(r, -h / 2); ring(r, h / 2);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j, n + i, j, n + j, n + i); }       // outer wall
  if (rInner) {
    ring(rInner, -h / 2); ring(rInner, h / 2);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(2 * n + i, 3 * n + i, 2 * n + j, 3 * n + i, 3 * n + j, 2 * n + j); }   // inner wall
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, 2 * n + i, 2 * n + j, i, 2 * n + j, j); idx.push(n + i, n + j, 3 * n + j, n + i, 3 * n + j, 3 * n + i); }   // top and bottom faces
  } else {
    pos.push(0, 0, -h / 2, 0, 0, h / 2);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(2 * n, j, i); idx.push(2 * n + 1, n + i, n + j); }
  }
  return { pos, idx };
};
const volume = m => { let v = 0; const P = m.pos; for (let t = 0; t < m.idx.length; t += 3) { const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
  v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; } return Math.abs(v); };
const bboxOf = m => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], m.pos[i + k]); mx[k] = Math.max(mx[k], m.pos[i + k]); } return [...mn, ...mx]; };
const T = (x, y, z) => [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]];

const materials = [{ name: 'Aluminum 6061', density: 2700 }, { name: 'Steel', density: 7850 }, { name: 'ABS Plastic', density: 1050 }, { name: 'Brass', density: 8500 }, { name: 'Stainless Steel AISI 304', density: 8000 }];
const appearances = [{ name: 'Aluminum - Satin', color: '#c4c8cf' }, { name: 'Steel - Satin', color: '#8f949c' }, { name: 'ABS Plastic (White)', color: '#ecebe6' }, { name: 'Brass - Polished', color: '#c9a64a' }, { name: 'Stainless Steel - Satin', color: '#b5b9c0' }, { name: 'Paint - Enamel Glossy (Red)', color: '#b3262b' }];
const mat = n => materials.find(m => m.name === n), app = n => appearances.find(a => a.name === n);

const parts = [], instances = [], meshes = {};
const body = (index, name, m, material, appearance) => ({ index, name, material, appearance, color: app(appearance).color,
  massG: +(volume(m) / 1000 * mat(material).density / 1000).toFixed(3), volumeMm3: +volume(m).toFixed(1), bboxMm: bboxOf(m).map(v => +v.toFixed(2)), hiddenInDefinition: false, triangles: m.idx.length / 3 });
function addPart({ kind, name, referenced = false, paths, bodies }) {
  const id = 'p' + parts.length;
  const part = { id, kind, name, referenced, paths, instances: Math.max(1, paths.length), bodies: bodies.map((b, i) => body(i, b.name, b.mesh, b.material, b.appearance)) };
  bodies.forEach((b, i) => { meshes[id + ':' + i] = b.mesh; });
  parts.push(part); return part;
}
const place = (part, path, [x, y, z]) => part.bodies.forEach((b, i) => instances.push({ partId: part.id, bodyIndex: i, path, visible: true, matrix: T(x, y, z) }));

// two plates sitting directly in the design (named like Fusion names new bodies)
const base = addPart({ kind: 'root', name: 'Body1', paths: [], bodies: [{ name: 'Body1', mesh: box(80, 50, 6), material: 'Aluminum 6061', appearance: 'Aluminum - Satin' }] }); base.rootBodyIndex = 0; place(base, '', [0, 0, 3]);
const back = addPart({ kind: 'root', name: 'Body2', paths: [], bodies: [{ name: 'Body2', mesh: box(80, 6, 40), material: 'Aluminum 6061', appearance: 'Aluminum - Satin' }] }); back.rootBodyIndex = 1; place(back, '', [0, -22, 26]);
// a bracket component placed twice, with a default name and the wrong material
const bracket = addPart({ kind: 'component', name: 'Component1', paths: ['Component1:1', 'Component1:2'], bodies: [
  { name: 'Body1', mesh: box(14, 18, 4), material: 'ABS Plastic', appearance: 'ABS Plastic (White)' }, { name: 'Body2', mesh: box(14, 4, 16), material: 'ABS Plastic', appearance: 'ABS Plastic (White)' }] });
place(bracket, 'Component1:1', [-24, -6, 8]); place(bracket, 'Component1:2', [24, -6, 8]);
// four screws from a "linked" document (locked in the editor), and four washers
const screwPaths = [0, 1, 2, 3].map(i => 'M3x8 screw:' + (i + 1));
const screw = addPart({ kind: 'component', name: 'M3x8 screw', referenced: true, paths: screwPaths, bodies: [{ name: 'Body1', mesh: cyl(1.5, 8), material: 'Steel', appearance: 'Steel - Satin' }] });
screw.source = { fileId: 'urn:adsk.wipprod:dm.lineage:SAMPLEFILEID0000000000', file: 'M3x8 screw', version: 2, folder: 'Fasteners', project: 'Demo library' };
const washer = addPart({ kind: 'component', name: 'M3 WASHER', paths: [0, 1, 2, 3].map(i => 'M3 WASHER:' + (i + 1)), bodies: [{ name: 'Body1', mesh: cyl(3.2, 0.5, 20, 1.6), material: 'Steel', appearance: 'Steel - Satin' }] });
[[-24, -6], [24, -6], [-24, 6], [24, 6]].forEach(([x, y], i) => { place(screw, screwPaths[i], [x, y, 14]); place(washer, 'M3 WASHER:' + (i + 1), [x, y, 10.25]); });

const assembly = { format: 'fusion-assembly-export/2', document: { name: 'Demo bracket' }, exportedAt: '2026-01-01T00:00:00', units: 'mm', upAxis: 'Z', transformMaxErrorMm: 0, parts, instances, libraries: { materials, appearances } };
writeFileSync(join(out, 'assembly.json'), JSON.stringify(assembly));
writeFileSync(join(out, 'meshes.json'), JSON.stringify(meshes));
console.log(`wrote ${out}: ${parts.length} parts, ${instances.length} instances, ${Object.values(meshes).reduce((t, m) => t + m.idx.length / 3, 0)} triangles`);
