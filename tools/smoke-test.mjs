// A quick check that the page builds from the sample export. Run with: npm test
// (The two Fusion scripts run inside Fusion's own Python, so they cannot be checked here.)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), 'fpe-'));
const out = join(tmp, 'parts-editor.html');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok    ' : 'FAIL  ') + what); if (!ok) failed++; };

// the sample is regenerated into a temporary folder, so running the tests never rewrites the tracked examples
const sample = join(tmp, 'sample-export');
execFileSync(process.execPath, [join(root, 'tools', 'make-sample.mjs'), sample], { stdio: 'pipe' });
execFileSync(process.execPath, [join(root, 'fusion-parts-editor', 'scripts', 'build_editor.mjs'), sample, out], { stdio: 'pipe' });
const html = readFileSync(out, 'utf8');
check(statSync(out).size > 10000, 'the page is a reasonable size (' + Math.round(statSync(out).size / 1024) + ' KB)');
check(!html.includes('__ASSEMBLY__') && !html.includes('__GEO__'), 'no template placeholders are left');
check(html.includes('Demo bracket'), 'it carries the document name');
check(html.includes('"referenced":true'), 'it carries the linked-part flag');
check(/"instances":\[/.test(html) && html.includes('"partId":"p0"'), 'it carries the placed copies');
const answers = JSON.parse(readFileSync(join(root, 'examples', 'answers.example.json'), 'utf8'));
check(answers.format === 'fusion-parts-answers/1' && Array.isArray(answers.edits) && answers.edits.length > 0, 'the example answers file has the expected shape');

// audit, proposal and a page built with a proposal
const scripts = join(root, 'fusion-parts-editor', 'scripts');
const run = (script, ...a) => execFileSync(process.execPath, [join(scripts, script), ...a], { stdio: 'pipe' }).toString();
const audit = run('audit.mjs', sample);
check(audit.includes('DEFAULT_NAME') && audit.includes('Mass by material'), 'the audit flags default names and totals mass by material');
const prop = join(tmp, 'proposal.json'), pout = join(tmp, 'with-proposal.html');
const made = run('make_proposal.mjs', sample, join(root, 'examples', 'proposal.spec.example.json'), prop);
const pj = JSON.parse(readFileSync(prop, 'utf8'));
check(pj.format === 'fusion-parts-answers/1' && pj.edits.length === 4 && pj.edits.every(e => e.reason), 'the proposal has four edits, each with a reason (' + made.split('\n')[0].replace(/^wrote .*?: /, '') + ')');
check(pj.edits.find(e => e.part === 'p4').bodies[0].was.material === 'Steel', 'the proposal fills in "was" values from the export');
check(pj.edits.find(e => e.part === 'p3').linked === true && pj.allowLinked === true, 'a linked part with body edits sets allowLinked, as the page does');
const rs = pj.edits.find(e => e.part === 'p3').renameSource;
check(rs && rs.from === 'M3x8 screw' && rs.to === 'M3x8 socket screw' && rs.fileId.startsWith('urn:') && pj.allowSourceRename === true && !pj.edits.find(e => e.part === 'p3').rename, 'renaming a linked part becomes a library-file rename that carries the file id');
execFileSync(process.execPath, [join(scripts, 'build_editor.mjs'), sample, pout, '--proposal', prop], { stdio: 'pipe' });
const phtml = readFileSync(pout, 'utf8');
check(!phtml.includes('__PROPOSAL__') && phtml.includes('Printed-looking ABS'), 'the page carries the proposal and its reasons');
check(readFileSync(out, 'utf8').includes('const PROPOSAL = null;'), 'a page built without a proposal has none');
// a mesh that carries Fusion's normals is packed with them; the sample (no normals) falls back to computed ones
const withN = join(tmp, 'with-normals'); mkdirSync(withN);
copyFileSync(join(sample, 'assembly.json'), join(withN, 'assembly.json'));
const mj = JSON.parse(readFileSync(join(sample, 'meshes.json'), 'utf8'));
for (const m of Object.values(mj)) m.nrm = m.pos.map((_, i) => (i % 3 === 2 ? 127 : 0));
writeFileSync(join(withN, 'meshes.json'), JSON.stringify(mj));
execFileSync(process.execPath, [join(scripts, 'build_editor.mjs'), withN, join(withN, 'p.html')], { stdio: 'pipe' });
check(readFileSync(join(withN, 'p.html'), 'utf8').includes('"hn":1') && html.includes('"hn":0'), 'normals from the export are packed into the page, and meshes without them are marked');
let refused = false;
try { const bad = join(tmp, 'bad.json'); writeFileSync(bad, JSON.stringify({ ...pj, document: 'Some other design' })); run('build_editor.mjs', sample, join(tmp, 'x.html'), '--proposal', bad); } catch { refused = true; }
check(refused, 'a proposal made for another document is refused');

// ledger: text format round trip, expansion against the export, verification and undo
const { formatLedger, parseLedger, expandLedger, closest } = await import(pathToFileURL(join(scripts, 'ledger.mjs')).href);
const A = JSON.parse(readFileSync(join(sample, 'assembly.json'), 'utf8'));
const screw = A.parts.find(p => p.source), plate = A.parts.find(p => p.kind === 'component' && !p.referenced && p.bodies.length);
const rows = [
  { part: screw.id, scope: 'file', field: 'name', from: screw.source.file, to: 'M3x8 "socket" screw', origin: 'owner', where: screw.source.project + '/' + screw.source.folder },
  { part: screw.id, scope: 'body', body: 0, field: 'material', from: screw.bodies[0].material, to: 'Stainless Steel AISI 304', origin: 'suggested', where: 'library file "' + screw.source.file + '"' },
  { part: plate.id, scope: 'comp', field: 'name', from: plate.name, to: 'Base plate', origin: 'suggested, changed' },
  { part: plate.id, scope: 'body', body: 0, field: 'name', from: plate.bodies[0].name, to: 'Base-1', origin: 'owner' },
];
const text = formatLedger({ doc: A.document.name, exportedAt: A.exportedAt, rows });
const back = parseLedger(text);
check(back.rows.length === 4 && back.rows[0].to === 'M3x8 "socket" screw' && back.rows[3].body === 0 && back.rows[2].origin === 'suggested, changed', 'a ledger survives write and read, including quotes in names');
check(parseLedger('```\n' + text + '```\n').rows.length === 4, 'a ledger pasted inside a code fence still reads');
let bad = false; try { parseLedger(text.replace('->', '=>')); } catch { bad = true; }
check(bad, 'a damaged ledger line is refused, not skipped');
const x = expandLedger(back, A);
check(x.problems.length === 0 && x.answers.edits.length === 2 && x.answers.allowSourceRename === true && x.answers.allowLinked === true, 'a ledger expands into answers (' + x.held.length + ' held, ' + x.warnings.length + ' warnings)');
check(x.answers.edits.find(e => e.part === screw.id).renameSource.fileId === screw.source.fileId, 'the library-file rename picks up the file id from the export');
const libMat = A.libraries.materials.map(m => m.name);
check(libMat.includes('Stainless Steel AISI 304') && x.held.length === 0, 'a material name Fusion has is not held back');
const typo = expandLedger(parseLedger(text.replace('"Stainless Steel AISI 304"', '"stainless"')), A);
check(typo.held.length === 1 && typo.answers.edits.every(e => e.part !== screw.id || !(e.bodies || []).some(b => b.set.material)), 'a material name that Fusion does not have is held back, not guessed');
check(closest('steel', ['Aluminum 6061', 'Stainless Steel', 'Steel']).includes('Steel') && closest('stainless steel', ['Stainless Steel'])[0] === 'Stainless Steel', 'closest names are suggested for a typo');
check(expandLedger({ ...back, exportedAt: '1999-01-01T00:00:00' }, A).problems.length === 1, 'a ledger from a different export is a problem');
check(expandLedger({ ...back, rows: [{ ...back.rows[2], from: 'Not the name' }] }, A).problems.length === 1, 'a "from" value that differs from the export is a problem');
const dup = expandLedger({ ...back, rows: [{ ...back.rows[3], to: plate.bodies[0].name === 'x' ? 'y' : 'Dup' }, { part: plate.id, n: 9, scope: 'body', body: 0, field: 'name', from: plate.bodies[0].name, to: 'Dup', origin: 'owner', where: '' }] }, A);
check(dup.problems.length === 0, 'the same row twice does not crash the expander');
// the tools on the command line
const lp = join(tmp, 'ledger.txt'), ap = join(tmp, 'answers.json');
writeFileSync(lp, text);
const ex = run('expand_ledger.mjs', sample, lp, ap);
check(JSON.parse(readFileSync(ap, 'utf8')).edits.length === 2 && ex.includes('wrote'), 'expand_ledger.mjs writes answers.json');
let refusedExpand = false; try { run('expand_ledger.mjs', sample, lp.replace('ledger', 'missing'), ap); } catch { refusedExpand = true; }
check(refusedExpand, 'expand_ledger.mjs fails when the ledger cannot be read');
// verify: fake an "after" export where the ledger was applied, and one where a side effect slipped in
const after = join(tmp, 'after'); mkdirSync(after);
const Z = JSON.parse(JSON.stringify(A));
const zs = Z.parts.find(p => p.id === screw.id), zp = Z.parts.find(p => p.id === plate.id);
zs.source.file = 'M3x8 "socket" screw'; zs.name = 'M3x8 "socket" screw'; zs.bodies[0].material = 'Stainless Steel AISI 304'; zs.bodies[0].appearance = 'Stainless Steel - Satin';
zp.name = 'Base plate'; zp.bodies[0].name = 'Base-1';
writeFileSync(join(after, 'assembly.json'), JSON.stringify(Z)); copyFileSync(join(sample, 'meshes.json'), join(after, 'meshes.json'));
const undoPath = join(tmp, 'undo.txt');
const ver = run('verify_ledger.mjs', sample, after, lp, '--undo', undoPath);
check(ver.includes('4 of 4 ledger rows DONE') && ver.includes('SIDE EFFECTS') && ver.includes('Stainless Steel - Satin'), 'verify confirms every row and reports the appearance that changed on its own');
const undo = parseLedger(readFileSync(undoPath, 'utf8'));
check(undo.exportedAt === A.exportedAt && undo.rows.some(r => r.field === 'appearance' && r.to === screw.bodies[0].appearance) && undo.rows.some(r => r.scope === 'file' && r.to === screw.source.file), 'the undo ledger puts back the ledger values and the side effect');
zp.name = 'Plate (unchanged)'; writeFileSync(join(after, 'assembly.json'), JSON.stringify(Z));
let notDone = false; try { run('verify_ledger.mjs', sample, after, lp); } catch (e) { notDone = e.status === 2; }
check(notDone, 'verify exits with a failure when a ledger row did not happen');
// a material change without an appearance row warns once; with one it stays quiet
check(x.warnings.some(w => /material change.*without an appearance row/.test(w)), 'a material change with no appearance row gets one warning about the appearance');
const withApp = expandLedger({ ...back, rows: [...back.rows, { n: 9, part: screw.id, scope: 'body', body: 0, field: 'appearance', from: screw.bodies[0].appearance, to: 'Stainless Steel - Satin', origin: 'owner', where: '' }] }, A);
check(!withApp.warnings.some(w => /without an appearance row/.test(w)), 'no appearance warning when the ledger sets the appearance too');
// new audit flags, on a copy of the sample with a fastener in the wrong material and one name written two ways
const aud = join(tmp, 'audit-export'); mkdirSync(aud);
const AA = JSON.parse(JSON.stringify(A));
const w1 = AA.parts.find(p => p.name === 'M3 WASHER'); w1.name = 'M3 Washer'; AA.parts.push({ ...JSON.parse(JSON.stringify(w1)), id: 'p99', name: 'M3-washer', bodies: w1.bodies.map(b => ({ ...b, material: 'Aluminum 6061' })) });
writeFileSync(join(aud, 'assembly.json'), JSON.stringify(AA)); writeFileSync(join(aud, 'meshes.json'), '{}');
const audOut = run('audit.mjs', aud);
check(/INCONSISTENT_NAME/.test(audOut) && /FASTENER_ODD_MATERIAL/.test(audOut) && /Fastener materials/.test(audOut), 'the audit flags one name written two ways and a fastener in an odd material');
// library mode: a folder listing (no bodies, no meshes) goes through the same page, ledger and expander
const lib = join(tmp, 'library'); mkdirSync(lib);
const LB = { format: 'fusion-assembly-export/2', mode: 'library', document: { name: 'Library: Demo / Fasteners' }, exportedAt: '2026-01-02T00:00:00', units: 'mm', upAxis: 'Z', transformMaxErrorMm: 0, instances: [], libraries: { materials: [], appearances: [] },
  parts: [0, 1].map(i => ({ id: 'p' + i, kind: 'component', name: i ? 'Screw M4' : 'M3 SCREW', referenced: true, paths: [], instances: 1, bodies: [], source: { fileId: 'urn:test:' + i, file: i ? 'Screw M4' : 'M3 SCREW', version: 1, folder: 'Fasteners', project: 'Demo' } })) };
writeFileSync(join(lib, 'assembly.json'), JSON.stringify(LB)); writeFileSync(join(lib, 'meshes.json'), '{}');
run('build_editor.mjs', lib, join(lib, 'p.html'));
check(readFileSync(join(lib, 'p.html'), 'utf8').includes('A library file, listed without opening it'), 'a library listing builds a page');
const llp = join(lib, 'ledger.txt'); writeFileSync(llp, formatLedger({ doc: LB.document.name, exportedAt: LB.exportedAt, rows: [{ part: 'p0', scope: 'file', field: 'name', from: 'M3 SCREW', to: 'M3 screw', origin: 'owner', where: 'Demo/Fasteners' }] }));
run('expand_ledger.mjs', lib, llp, join(lib, 'answers.json'));
const la = JSON.parse(readFileSync(join(lib, 'answers.json'), 'utf8'));
check(la.mode === 'library' && la.allowSourceRename === true && la.edits[0].renameSource.fileId === 'urn:test:0', 'a library ledger expands to answers marked mode "library"');
// the offline build inlines three.js (only when it is installed here)
try {
  const off = join(tmp, 'offline.html'); run('build_editor.mjs', sample, off, '--offline');
  const oh = readFileSync(off, 'utf8'); check(!oh.includes('cdn.jsdelivr.net/npm/three') && oh.includes('data:text/javascript;base64,'), 'the offline page carries three.js and no CDN address');
} catch { console.log('skip  offline build (three.js not installed in fusion-parts-editor/scripts)'); }
const setup = run('check_setup.mjs', join(tmp, 'work'));
check(setup.includes('Node side is ready'), 'check_setup.mjs passes on a good install');
// library contents: parts inside a linked library file are grouped under it by occurrence path, and the audit folds them
const nest = join(tmp, 'nested'); execFileSync(process.execPath, [join(root, 'tools', 'make-sample.mjs'), nest, '--nested'], { stdio: 'pipe' });
const { libraryGroups } = await import(pathToFileURL(join(scripts, 'groups.mjs')).href);
const NA = JSON.parse(readFileSync(join(nest, 'assembly.json'), 'utf8'));
const gr = libraryGroups(NA), servoId = NA.parts.find(p => p.name === 'Micro servo').id;
check(gr.kids[servoId]?.length === 3 && Object.keys(gr.topOf).length === 3 && gr.stats[servoId].parts === 3 && gr.stats[servoId].bodies === 2, 'the three parts inside a library file are grouped under it (found by occurrence path)');
check(Object.keys(libraryGroups(A).topOf).length === 0, 'an assembly with nothing inside library files has no groups');
const foldedAudit = run('audit.mjs', nest), fullAudit = run('audit.mjs', nest, '--all');
check(!/"Gear 2"/.test(foldedAudit) && /folded: 3 parts, 2 bodies inside/.test(foldedAudit) && /3 parts inside library files are folded/.test(foldedAudit), 'the audit folds library contents into the library part');
check(/"Gear 2"/.test(fullAudit) && /IN_LINKED_FILE/.test(fullAudit), 'audit --all lists them again');
const massLine = s => s.split('\n').find(l => /g\s+total/.test(l));
check(massLine(foldedAudit) === massLine(fullAudit), 'folding changes what is listed, never the mass totals');
// the built page carries the ledger library and no placeholder
check(html.includes('function parseLedger') && html.includes('function expandLedger') && !html.includes('__LEDGER_LIB__') && !html.includes('export function'), 'the page carries the ledger library, inlined without export keywords');
check(html.includes('function libraryGroups') && !html.includes('__GROUPS_LIB__'), 'the page carries the library grouping');
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
