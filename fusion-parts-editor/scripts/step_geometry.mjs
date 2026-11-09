// Build the 3D shapes of an export from the design's STEP file instead of Fusion's mesh calculator.
//   node step_geometry.mjs <export_dir> [--step file.step] [--occt path/to/occt-import-js.js] [--detail standard|fine]
//
// Needs an export made with "step": true (and usually "mesh": false) so that <export_dir> holds assembly.json and assembly.step.
// What it does:
//   1. Reads the STEP file with OpenCascade (occt-import-js). Every solid comes back as triangles made straight from the exact surfaces.
//   2. Matches each solid to a body of the Fusion assembly by where its center of mass is and how much volume it has (STEP files do not carry
//      Fusion's occurrence paths, so geometry is the only reliable link).
//   3. Moves each matched solid back into its component's own space with the inverse of the placement, so copies of a part share one shape.
//   4. Writes meshes.json (replacing any Fusion meshes for the bodies it matched) and records the result in assembly.json.
// Anything that could not be matched is listed. Bodies without a match have no shape in the page; the parts are still listed and editable.
//
// Needs the occt-import-js package: run `npm install` once in this scripts folder (package.json lists it), or pass --occt with a path to the library file.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const dir = args.find((a, i) => !a.startsWith('--') && !/^--(step|occt|detail)$/.test(args[i - 1] || ''));
if (!dir) { console.error('usage: node step_geometry.mjs <export_dir> [--step file.step] [--occt path] [--detail standard|fine]'); process.exit(1); }

const assemblyPath = join(dir, 'assembly.json');
const assembly = JSON.parse(readFileSync(assemblyPath, 'utf8'));
const stepPath = resolve(opt('step') || join(dir, assembly.stepFile || 'assembly.step'));
if (!existsSync(stepPath)) { console.error(`No STEP file at ${stepPath}. Export with "step": true first.`); process.exit(1); }

// ---- the reader ----
const require = createRequire(import.meta.url);
let factory;
try { factory = require(opt('occt') ? resolve(opt('occt')) : 'occt-import-js'); }
catch (e) { console.error('Cannot load the STEP reader (occt-import-js). Run `npm install` in the scripts folder once, or pass --occt <path to occt-import-js.js>.\n' + e.message); process.exit(1); }
const occt = await factory();
const fine = opt('detail') === 'fine';
const read = occt.ReadStepFile(new Uint8Array(readFileSync(stepPath)), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: fine ? 0.0005 : 0.001, angularDeflection: fine ? 0.1 : 0.2 });
if (!read.success || !read.meshes.length) { console.error('The STEP reader could not read that file.'); process.exit(1); }

// ---- solids: volume and center of mass (signed tetrahedra; exact for closed meshes) ----
function measure(pos, idx) {
  let vol = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const v = (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6;
    vol += v; cx += v * (pos[a] + pos[b] + pos[c]) / 4; cy += v * (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 4; cz += v * (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 4;
  }
  return Math.abs(vol) > 1e-9 ? { vol: Math.abs(vol), c: [cx / vol, cy / vol, cz / vol] } : null;
}
const solids = [];
read.meshes.forEach((m, i) => {
  if (!m.index.array.length) return;
  const pos = m.attributes.position.array, idx = m.index.array, me = measure(pos, idx);
  if (me) solids.push({ i, name: m.name || '', pos, idx, vol: me.vol, c: me.c });
});

// ---- the Fusion side: every placed body, with its center of mass in assembly space ----
const parts = Object.fromEntries(assembly.parts.map(p => [p.id, p]));
const apply = (M, p) => [M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2] + M[0][3], M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2] + M[1][3], M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2] + M[2][3]];
const targets = [];
assembly.instances.forEach((inst, n) => {
  const body = parts[inst.partId].bodies[inst.bodyIndex];
  if (!body.comMm || !(body.volumeMm3 > 0)) return;       // exports from before STEP support have no center of mass; surface bodies have no volume
  const bb = body.bboxMm, diag = Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]);
  targets.push({ n, inst, body, c: apply(inst.matrix, body.comMm), vol: body.volumeMm3, diag, solid: null, dist: 0 });
});
if (!targets.length) { console.error('This export has no center-of-mass data. Export again with the current fusion_export.py.'); process.exit(1); }

// ---- which way is the STEP file turned? Fusion writes it as the design is oriented; try the three usual frames and keep the best ----
const FRAMES = { 'as is': p => p, 'Y up to Z up': p => [p[0], -p[2], p[1]], 'Z up to Y up': p => [p[0], p[2], -p[1]] };
const okPair = (t, s, c) => { const d = Math.hypot(c[0] - t.c[0], c[1] - t.c[1], c[2] - t.c[2]); return d <= Math.max(1.5, 0.03 * t.diag) && Math.abs(Math.log(s.vol / t.vol)) <= 0.08 ? d : -1; };
function match(frame) {
  const moved = solids.map(s => frame(s.c)), taken = new Set(), res = new Map();
  for (let round = 0; round < 6; round++) {
    const pairs = [];
    for (const t of targets) {
      if (res.has(t)) continue;
      const best = [];
      for (let j = 0; j < solids.length; j++) { if (taken.has(j)) continue; const d = okPair(t, solids[j], moved[j]); if (d >= 0) best.push([d + 20 * Math.abs(Math.log(solids[j].vol / t.vol)), t, j, d]); }
      best.sort((a, b) => a[0] - b[0]); pairs.push(...best.slice(0, 4));
    }
    pairs.sort((a, b) => a[0] - b[0]);
    let progress = false;
    for (const [, t, j, d] of pairs) { if (res.has(t) || taken.has(j)) continue; res.set(t, { j, d }); taken.add(j); progress = true; }
    if (!progress) break;
  }
  return res;
}
let frameName = 'as is', result = null;
for (const [name, f] of Object.entries(FRAMES)) { const r = match(f); if (!result || r.size > result.size) { result = r; frameName = name; } if (r.size === targets.length) break; }
const F = FRAMES[frameName];
for (const [t, r] of result) { t.solid = r.j; t.dist = r.d; }

// ---- component-space shapes: one per part body, taken from its best-matched placed copy ----
const inv3 = M => {
  const [[a, b, c], [d, e, f], [g, h, i]] = [M[0].slice(0, 3), M[1].slice(0, 3), M[2].slice(0, 3)];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det], [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det], [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]];
};
const meshes = {}, byBody = new Map();
for (const t of targets) { if (t.solid === null) continue; const k = t.inst.partId + ':' + t.inst.bodyIndex; if (!byBody.has(k) || t.dist < byBody.get(k).dist) byBody.set(k, t); }
for (const [k, t] of byBody) {
  const s = solids[t.solid], M = t.inst.matrix, R = inv3(M), p = s.pos, out = new Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const w = F([p[i], p[i + 1], p[i + 2]]), x = w[0] - M[0][3], y = w[1] - M[1][3], z = w[2] - M[2][3];
    out[i] = +(R[0][0] * x + R[0][1] * y + R[0][2] * z).toFixed(3); out[i + 1] = +(R[1][0] * x + R[1][1] * y + R[1][2] * z).toFixed(3); out[i + 2] = +(R[2][0] * x + R[2][1] * y + R[2][2] * z).toFixed(3);
  }
  meshes[k] = { pos: out, idx: Array.from(s.idx) };
  const [pid, bi] = k.split(':'); parts[pid].bodies[+bi].triangles = s.idx.length / 3;
}

// ---- report ----
const visibleTargets = targets.filter(t => t.inst.visible), unmatched = visibleTargets.filter(t => t.solid === null);
const usedSolids = new Set(targets.filter(t => t.solid !== null).map(t => t.solid));
const spare = solids.filter((s, j) => !usedSolids.has(j));
const maxDist = Math.max(0, ...targets.filter(t => t.solid !== null).map(t => t.dist));
const tris = Object.values(meshes).reduce((a, m) => a + m.idx.length / 3, 0);
assembly.geometry = 'step';
assembly.stepMatch = { frame: frameName, solids: solids.length, placedBodies: targets.length, matched: targets.length - targets.filter(t => t.solid === null).length, maxCenterErrorMm: +maxDist.toFixed(3),
  unmatchedVisible: unmatched.map(t => parts[t.inst.partId].name + ' (' + (t.inst.path || 'top level') + ')').slice(0, 50) };
writeFileSync(assemblyPath, JSON.stringify(assembly));
writeFileSync(join(dir, 'meshes.json'), JSON.stringify(meshes));
console.log(`STEP shapes: ${solids.length} solids read, ${assembly.stepMatch.matched} of ${targets.length} placed bodies matched (frame: ${frameName}), ${Object.keys(meshes).length} shapes written, ${tris.toLocaleString()} triangles`);
console.log(`largest gap between a Fusion center of mass and its STEP solid: ${maxDist.toFixed(3)} mm`);
if (unmatched.length) console.log(`NOT MATCHED (${unmatched.length} visible placed bodies, no shape in the page): ` + unmatched.slice(0, 12).map(t => parts[t.inst.partId].name + ' [' + (t.inst.path || 'top level') + ']').join('; ') + (unmatched.length > 12 ? ' …' : ''));
if (spare.length) console.log(`STEP solids with no Fusion body (not shown): ${spare.length}${spare.length <= 6 ? ' (' + spare.map(s => s.name || '#' + s.i).join(', ') + ')' : ''}`);
if (!unmatched.length && !spare.length) console.log('every solid and every visible body matched one to one');
process.exitCode = unmatched.length ? 2 : 0;
