// Print a compact audit of a Fusion export, so a proposal can be written without reading the whole assembly.json.
//   node audit.mjs <export_dir>
// It lists every part (id, copies, linked, names, material, appearance, mass) and flags likely problems:
//   DEFAULT_NAME, PART_NUMBER_NAME, NO_MATERIAL, AIR, GENERIC_MATERIAL, MAT_APP_MISMATCH, NAME_MAT_MISMATCH, CUSTOM_APPEARANCE,
//   SAME_NAME_OTHER_MATERIAL, INCONSISTENT_NAME (the same name written two ways), FASTENER_ODD_MATERIAL (a screw, washer or nut whose
//   material differs from most fasteners), DUPLICATE_BODY_NAMES, EMPTY_CONTAINER, LINKED, IN_LINKED_FILE (inside a linked library file).
// It also prints the fastener material counts, because "13 of 15 fasteners are stainless" is the sort of fact a suggestion should rest on.
// The flags are hints for a person (or Claude) to judge, not verdicts: a red steel part may be red on purpose.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node audit.mjs <export_dir>'); process.exit(1); }
const A = JSON.parse(readFileSync(join(dir, 'assembly.json'), 'utf8'));
const libApp = new Set(A.libraries.appearances.map(a => a.name));

const FAMILIES = {
  metal: ['aluminum', 'aluminium', 'steel', 'stainless', 'brass', 'copper', 'bronze', 'titanium', 'iron', 'zinc', 'nickel', 'chrome', 'magnesium'],
  plastic: ['nylon', 'abs', 'pla', 'petg', 'polycarbonate', 'acrylic', 'delrin', 'acetal', 'pom', 'polyethylene', 'ptfe', 'polypropylene', 'pvc', 'resin'],
  rubber: ['rubber', 'buna', 'silicone', 'neoprene', 'epdm', 'viton', 'foam'],
};
const family = s => { const w = (s || '').toLowerCase().split(/[^a-z]+/); for (const [f, list] of Object.entries(FAMILIES)) if (list.some(k => w.includes(k))) return f; return null; };
const GENERIC = new Set(['aluminum', 'steel', 'stainless steel', 'brass', 'copper', 'plastic', 'generic', 'default']);
const isDefaultName = n => /^(Body|Component|Part|Untitled|Solid|Surface)\s*\(?\d*\)?$/i.test((n || '').trim());
const isPartNumberName = n => /^\d{3,}[A-Z]\d+/.test(n || '') || /_FILE_\d+$/i.test(n || '') || /^[A-Z0-9]{6,}(_[A-Z0-9()._-]+)+$/.test(n || '');
const norm = n => (n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const byName = new Map();
for (const p of A.parts) {
  const k = norm(p.name);
  if (!byName.has(k)) byName.set(k, new Set());
  for (const b of p.bodies) byName.get(k).add(b.material);
}

// names that differ only by case, spaces, dashes, underscores or a trailing "(1)": the same thing named two ways
const skeleton = n => (n || '').toLowerCase().replace(/\s*\(\d+\)\s*$/, '').replace(/[^a-z0-9]+/g, '');
const bySkeleton = new Map();
for (const p of A.parts) { const k = skeleton(p.name); if (!k) continue; if (!bySkeleton.has(k)) bySkeleton.set(k, new Set()); bySkeleton.get(k).add(p.name); }
// fasteners: parts named like screws, washers, nuts and standoffs should mostly share a material; flag the odd ones out
const isFastener = n => /\b(screw|bolt|washer|nut|standoff|locknut|torx|fhcs|shcs|bhcs|hex|rivet|stud)\b|^m\d+(\.\d+)?x\d+/i.test(n || '') || /^m\d+(\.\d+)?[ _x-]/i.test(n || '');
const fastMats = new Map();
for (const p of A.parts) if (isFastener(p.name)) for (const b of p.bodies) fastMats.set(b.material || '(none)', (fastMats.get(b.material || '(none)') || 0) + p.instances);
const topFast = [...fastMats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

let total = 0;
const matMass = {};
console.log(`${A.document.name}: ${A.parts.length} parts, ${A.parts.filter(p => p.referenced).length} linked, up axis ${A.upAxis}\n`);
for (const p of A.parts) {
  const flags = [];
  if (p.referenced) flags.push('LINKED');
  if (!p.bodies.length && A.mode !== 'library') flags.push('EMPTY_CONTAINER');
  if (isDefaultName(p.name)) flags.push('DEFAULT_NAME');
  else if (isPartNumberName(p.name)) flags.push('PART_NUMBER_NAME');
  if (p.kind === 'component' && p.bodies.some(b => isDefaultName(b.name)) && p.bodies.length > 1) flags.push('DEFAULT_BODY_NAMES');
  for (const b of p.bodies) {
    if (!b.material) flags.push('NO_MATERIAL');
    else if (b.material === 'Air') flags.push('AIR');
    else if (GENERIC.has(b.material.toLowerCase())) flags.push('GENERIC_MATERIAL');
    const fm = family(b.material), fa = family(b.appearance);
    if (fm && fa && fm !== fa) flags.push('MAT_APP_MISMATCH');
    if (b.appearance && !libApp.has(b.appearance)) flags.push('CUSTOM_APPEARANCE');
    const nl = (p.name + ' ' + b.name).toLowerCase(), ml = (b.material || '').toLowerCase();   // the name says "steel" but the material is stainless, or the other way round
    if (ml && ((/stainless/.test(ml) && /\bsteel\b/.test(nl) && !/stainless/.test(nl)) || (/stainless/.test(nl) && !/stainless/.test(ml)))) flags.push('NAME_MAT_MISMATCH');
    const g = b.massG * p.instances; total += g; matMass[b.material || '(none)'] = (matMass[b.material || '(none)'] || 0) + g;
  }
  if ([...(byName.get(norm(p.name)) || [])].length > 1) flags.push('SAME_NAME_OTHER_MATERIAL');
  if (bySkeleton.get(skeleton(p.name))?.size > 1) flags.push('INCONSISTENT_NAME');
  if (isFastener(p.name) && fastMats.size > 1 && p.bodies.some(b => (b.material || '(none)') !== topFast)) flags.push('FASTENER_ODD_MATERIAL');
  if (p.kind === 'component' && new Set(p.bodies.map(b => b.name)).size < p.bodies.length) flags.push('DUPLICATE_BODY_NAMES');
  if (p.viaLinked && p.viaLinked.length) flags.push('IN_LINKED_FILE');
  console.log(`${p.id}  ${p.kind}${p.instances > 1 ? ' x' + p.instances : ''}  "${p.name}"${flags.length ? '   [' + [...new Set(flags)].join(' ') + ']' : ''}`);
  p.bodies.forEach((b, k) => console.log(`      body ${k} "${b.name}" | ${b.material ?? '(none)'} | ${b.appearance ?? '(none)'}${b.color ? ' ' + b.color : ''} | ${b.massG} g | bbox ${(b.bboxMm[3] - b.bboxMm[0]).toFixed(1)} x ${(b.bboxMm[4] - b.bboxMm[1]).toFixed(1)} x ${(b.bboxMm[5] - b.bboxMm[2]).toFixed(1)} mm`));
}
if (fastMats.size) console.log('\nFastener materials (copies): ' + [...fastMats.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`).join(', '));
console.log('\nMass by material (all copies, from Fusion):');
for (const [m, g] of Object.entries(matMass).sort((a, b) => b[1] - a[1])) console.log(`  ${g.toFixed(1).padStart(8)} g  ${m}`);
console.log(`  ${total.toFixed(1).padStart(8)} g  total`);
