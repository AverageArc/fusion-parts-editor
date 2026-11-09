// The ledger: what the page copies and Claude reads. One row per change, readable by a person, exact for a machine.
//
//   # fusion-parts-ledger/2
//   # doc: "PEN_SLIDE (NEW)"  export: 2026-11-09T17:29:29
//   # 27 changes in 19 parts; 3 library-file renames (each renames the part in every design that uses the file)
//     1  p1   body 0  name        "Body6" -> "Clamp-Front"  [suggested, changed]
//     2  p6   file    name        "M3 WASHER" -> "M3-Washer"  [owner]  (Main/FASTENERS)
//
// Columns: row number, part id (from the export), scope (file | comp | body N), field (name | material | appearance | color),
// "from" -> "to" (JSON strings, so any character is exact), [origin], optional (note).
// Everything else a change needs (occurrence paths, linked flag, file id, body names) is looked up in the export by part id,
// so the paste stays short. This file has no imports: the page builder inlines it into the page, and Node tools import it.

export const LEDGER_FORMAT = 'fusion-parts-ledger/2';
const QS = '"(?:[^"\\\\]|\\\\.)*"';
const ROW_RE = new RegExp('^\\s*(\\d+)\\s+(p\\d+)\\s+(file|comp|body\\s+\\d+)\\s+(name|material|appearance|color)\\s+(' + QS + ')\\s+->\\s+(' + QS + ')\\s+\\[([^\\]]*)\\](?:\\s+\\((.*)\\))?\\s*$');
const DOC_RE = new RegExp('^#\\s*doc:\\s*(' + QS + ')\\s+export:\\s*(\\S+)\\s*$');
const FIELD_ORDER = ['name', 'material', 'appearance', 'color'];

export function scopeLabel(r) { return r.scope === 'body' ? 'body ' + r.body : r.scope; }

/** rows: [{ part, scope: 'file'|'comp'|'body', body?: number, field, from, to, origin, where? }] */
export function formatLedger({ doc, exportedAt, rows }) {
  const files = rows.filter(r => r.scope === 'file').length, inLinked = rows.filter(r => r.where && /^inside linked file/.test(r.where)).length;
  const parts = new Set(rows.map(r => r.part)).size;
  const head = [
    '# ' + LEDGER_FORMAT,
    '# doc: ' + JSON.stringify(doc) + '  export: ' + exportedAt,
    '# ' + rows.length + ' change' + (rows.length === 1 ? '' : 's') + ' in ' + parts + ' part' + (parts === 1 ? '' : 's')
      + (files ? '; ' + files + ' library-file rename' + (files === 1 ? '' : 's') + ' (each renames the part in every design that uses the file)' : '')
      + (inLinked ? '; ' + inLinked + ' row' + (inLinked === 1 ? '' : 's') + ' inside linked files (they change those library files)' : ''),
  ];
  const w = String(rows.length).length;
  const body = rows.map((r, i) => String(i + 1).padStart(w + 1) + '  ' + r.part.padEnd(4) + ' ' + scopeLabel(r).padEnd(7) + ' ' + r.field.padEnd(10) + '  '
    + JSON.stringify(r.from ?? '') + ' -> ' + JSON.stringify(r.to ?? '') + '  [' + (r.origin || 'owner') + ']' + (r.where ? '  (' + r.where + ')' : ''));
  return head.concat(body).join('\n') + '\n';
}

/** Parses ledger text. Tolerates blank lines, other "#" comment lines and a surrounding markdown code fence. */
export function parseLedger(text) {
  const out = { format: null, doc: null, exportedAt: null, rows: [] };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || /^\s*```/.test(line)) continue;
    if (/^#/.test(line)) {
      const f = line.match(/^#\s*(fusion-parts-ledger\/\d+)\s*$/); if (f) { out.format = f[1]; continue; }
      const d = line.match(DOC_RE); if (d) { out.doc = JSON.parse(d[1]); out.exportedAt = d[2]; }
      continue;
    }
    const m = line.match(ROW_RE);
    if (!m) throw new Error('cannot read this ledger line: ' + line.slice(0, 120));
    const scope = m[3].startsWith('body') ? 'body' : m[3];
    out.rows.push({ n: +m[1], part: m[2], scope, body: scope === 'body' ? +m[3].split(/\s+/)[1] : null, field: m[4], from: JSON.parse(m[5]), to: JSON.parse(m[6]), origin: m[7].trim(), where: m[8] || '' });
  }
  if (out.format !== LEDGER_FORMAT) throw new Error('this is not a ' + LEDGER_FORMAT + ' ledger (the first line should be "# ' + LEDGER_FORMAT + '")');
  if (out.doc === null) throw new Error('the ledger has no "# doc:" line');
  return out;
}

/** Closest library names to a misspelled one: an exact match ignoring case first, then names that contain it or its words. */
export function closest(name, list, n = 3) {
  const t = String(name).toLowerCase().trim();
  const exact = list.filter(x => x.toLowerCase() === t); if (exact.length) return exact.slice(0, n);
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  return list.map(x => { const l = x.toLowerCase(); let s = 0; if (l.startsWith(t)) s += 5; if (l.includes(t)) s += 3; for (const w of words) if (l.includes(w)) s += 1; return [s - Math.abs(l.length - t.length) / 100, x]; })
    .filter(a => a[0] > 0.5).sort((a, b) => b[0] - a[0]).slice(0, n).map(a => a[1]);
}

/**
 * Turns a parsed ledger into the answers object fusion_apply.py reads, using the export for everything the ledger leaves out.
 * Returns { answers, problems, held, warnings }:
 *   problems: the ledger does not fit this export (wrong document or export, unknown part, value differs from the export). Do not apply.
 *   held: rows left out because they cannot be applied as written (a name that is not in the library, a cleared value), with suggestions.
 *   warnings: rows that will work but may not do what the owner expects (duplicate names, edits inside linked files).
 */
export function expandLedger(L, A) {
  const problems = [], held = [], warnings = [];
  if (L.doc !== A.document.name) problems.push('the ledger is for "' + L.doc + '" but this export is "' + A.document.name + '"');
  if (L.exportedAt !== A.exportedAt) problems.push('the ledger was made from the export of ' + L.exportedAt + ' but this export is from ' + A.exportedAt + ' (use the export the page was built from)');
  const byId = Object.fromEntries(A.parts.map(p => [p.id, p]));
  const mats = A.libraries.materials.map(m => m.name), apps = A.libraries.appearances.map(a => a.name);
  const edits = new Map();
  const edit = p => { if (!edits.has(p.id)) edits.set(p.id, { part: p.id, kind: p.kind, linked: p.referenced, paths: p.paths.slice(0, 400), partName: p.name, rename: null, renameSource: null, bodies: new Map() }); return edits.get(p.id); };
  const finalName = new Map();   // "p3:0" -> the body name after the ledger, to spot duplicates
  const matRows = new Map(), appRows = new Set();   // material changes, and bodies whose appearance or color the ledger also sets
  for (const r of L.rows) {
    const p = byId[r.part], tag = 'row ' + r.n + ' (' + r.part + (p ? ' "' + p.name + '"' : '') + ' ' + scopeLabel(r) + ' ' + r.field + ')';
    if (!p) { problems.push('row ' + r.n + ': this export has no part ' + r.part); continue; }
    if (r.scope === 'file') {
      if (r.field !== 'name') { problems.push(tag + ': a library file row can only change the name'); continue; }
      if (!p.referenced || !p.source) { problems.push(tag + ': this part has no known source file, so it cannot be renamed here'); continue; }
      if (r.from !== p.source.file) { problems.push(tag + ': the export says the file is "' + p.source.file + '", not "' + r.from + '"'); continue; }
      if (!r.to.trim()) { held.push({ n: r.n, what: tag, why: 'an empty name', suggestions: [] }); continue; }
      edit(p).renameSource = { fileId: p.source.fileId, from: r.from, to: r.to, project: p.source.project, folder: p.source.folder };
    } else if (r.scope === 'comp') {
      if (r.field !== 'name') { problems.push(tag + ': a component row can only change the name'); continue; }
      if (p.kind === 'root') { problems.push(tag + ': this is a top-level body, use a body row'); continue; }
      if (p.referenced) { problems.push(tag + ': a linked component is renamed by renaming its library file (a file row)'); continue; }
      if (r.from !== p.name) { problems.push(tag + ': the export says the name is "' + p.name + '", not "' + r.from + '"'); continue; }
      if (!r.to.trim()) { held.push({ n: r.n, what: tag, why: 'an empty name', suggestions: [] }); continue; }
      edit(p).rename = { from: r.from, to: r.to };
    } else {
      const b = p.bodies[r.body];
      if (!b) { problems.push(tag + ': this part has no body ' + r.body); continue; }
      const field = r.field === 'color' ? 'customColor' : r.field;
      if (field === 'customColor') {
        if (r.to && !/^#[0-9a-fA-F]{6}$/.test(r.to)) { held.push({ n: r.n, what: tag, why: '"' + r.to + '" is not a #rrggbb color', suggestions: [] }); continue; }
        if (!r.to) continue;
      } else {
        if ((b[field] ?? '') !== r.from) { problems.push(tag + ': the export says it is "' + (b[field] ?? '') + '", not "' + r.from + '"'); continue; }
        if (!r.to.trim()) { held.push({ n: r.n, what: tag, why: field === 'name' ? 'an empty name' : 'it cannot be cleared; pick another ' + field, suggestions: [] }); continue; }
        const lib = field === 'material' ? mats : field === 'appearance' ? apps : null;
        if (lib && !lib.includes(r.to)) { held.push({ n: r.n, what: tag, why: '"' + r.to + '" is not a ' + field + ' name in Fusion', suggestions: closest(r.to, lib) }); continue; }
      }
      const e = edit(p);
      if (!e.bodies.has(r.body)) e.bodies.set(r.body, { index: r.body, bodyName: b.name, was: {}, set: {} });
      const bd = e.bodies.get(r.body);
      bd.set[field] = field === 'customColor' ? r.to.toLowerCase() : r.to;
      if (field !== 'customColor') bd.was[field] = b[field] ?? null;
      if (field === 'name') finalName.set(p.id + ':' + r.body, r.to);
      if (field === 'material') matRows.set(p.id + ':' + r.body, p.id + ' "' + p.name + '"');
      if (field === 'appearance' || field === 'customColor') appRows.add(p.id + ':' + r.body);
    }
  }
  // a new material usually pulls in its own appearance (seen on a real apply: "Aluminum - Satin" became "Stainless Steel - Satin", and one
  // part got "Surface - Matte"). Say so once, so an appearance that matters can be pinned with its own row.
  const loose = [...matRows.entries()].filter(([k]) => !appRows.has(k)).map(([, v]) => v);
  if (loose.length) warnings.push(loose.length + ' material change' + (loose.length === 1 ? '' : 's') + ' without an appearance row (' + [...new Set(loose)].slice(0, 6).join(', ') + (loose.length > 6 ? ', …' : '')
    + '): Fusion usually switches the appearance to the new material\'s own default, so the look may change. Add an appearance row to keep or choose it.');
  // duplicate body names: Fusion keeps names unique inside one component (and among top-level bodies) by adding " (1)" to the later one
  // Only groups that include a body this ledger renames are reported, so old duplicates the owner did not touch stay quiet.
  const scopes = new Map();   // scope key -> name -> [{ label, renamed }]
  for (const p of A.parts) p.bodies.forEach((b, k) => {
    const key = p.kind === 'root' ? 'top level' : p.id, renamed = finalName.has(p.id + ':' + k), nm = renamed ? finalName.get(p.id + ':' + k) : b.name;
    if (!scopes.has(key)) scopes.set(key, new Map());
    const m = scopes.get(key); if (!m.has(nm)) m.set(nm, []);
    m.get(nm).push({ label: p.id + (p.kind === 'root' ? '' : ' body ' + k) + ' "' + b.name + '"', renamed });
  });
  for (const [key, m] of scopes) for (const [nm, who] of m) if (who.length > 1 && who.some(w => w.renamed))
    warnings.push('the name "' + nm + '" would be used ' + who.length + ' times (' + who.map(w => w.label).join(', ') + ') ' + (key === 'top level' ? 'among top-level bodies' : 'inside one component') + '; Fusion renames the later ones to "' + nm + ' (1)". Give each its own name, for example "' + nm + ' 1" and "' + nm + ' 2".');
  for (const e of edits.values()) { const p = byId[e.part]; if (p.viaLinked && p.viaLinked.length && !p.referenced) warnings.push(e.part + ' "' + p.name + '" lives inside the linked file' + (p.viaLinked.length > 1 ? 's ' : ' ') + p.viaLinked.map(x => '"' + x + '"').join(', ') + '; editing it changes that library file too'); }
  const list = [...edits.values()].filter(e => e.rename || e.renameSource || e.bodies.size).map(e => {
    const o = { part: e.part, kind: e.kind, linked: e.linked, paths: e.paths, partName: e.partName };
    if (e.rename) o.rename = e.rename;
    if (e.renameSource) o.renameSource = e.renameSource;
    if (e.bodies.size) o.bodies = [...e.bodies.values()].sort((a, b) => a.index - b.index);
    return o;
  });
  const answers = { format: 'fusion-parts-answers/1', document: A.document.name, exportedAt: A.exportedAt,
    allowLinked: list.some(e => e.linked && e.bodies), allowSourceRename: list.some(e => e.renameSource), edits: list };
  if (A.mode) answers.mode = A.mode;   // "library": made from a folder listing, so the apply script renames files without an open design
  return { answers, problems, held, warnings };
}

/** The same shape as the rows the page produces, for the edits in an answers object (used by tools that start from answers). */
export function sortRows(rows) {
  const pn = r => +r.part.slice(1), sc = r => (r.scope === 'file' ? 0 : r.scope === 'comp' ? 1 : 2), fo = r => FIELD_ORDER.indexOf(r.field);
  return rows.slice().sort((a, b) => pn(a) - pn(b) || sc(a) - sc(b) || (a.body ?? 0) - (b.body ?? 0) || fo(a) - fo(b));
}
