// Checks the Node side of the setup in one go, so a first run fails with a plain message and not halfway through.
//   node check_setup.mjs [work_dir]
// It cannot see Fusion itself: confirm that by listing the open documents with the Fusion tool (see SKILL.md, "Before you start").
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), skill = join(here, '..');
const work = process.argv[2];
let bad = 0;
const row = (ok, what, fix) => { console.log((ok ? 'ok    ' : 'FAIL  ') + what + (!ok && fix ? '\n      -> ' + fix : '')); if (!ok) bad++; };
const note = s => console.log('note  ' + s);

const major = +process.versions.node.split('.')[0];
row(major >= 18, 'Node ' + process.versions.node + ' (18 or newer is needed)', 'install a current Node from nodejs.org');
for (const f of ['scripts/fusion_export.py', 'scripts/fusion_apply.py', 'scripts/fusion_save.py', 'scripts/build_editor.mjs', 'scripts/ledger.mjs', 'scripts/expand_ledger.mjs', 'scripts/verify_ledger.mjs', 'scripts/audit.mjs', 'scripts/make_proposal.mjs', 'assets/parts-editor.template.html'])
  row(existsSync(join(skill, f)), f, 'the skill folder is incomplete: reinstall it');
if (work) {
  try { mkdirSync(work, { recursive: true }); const t = join(work, '.write-test'); writeFileSync(t, 'x'); rmSync(t); row(true, 'the work folder is writable: ' + work); }
  catch (e) { row(false, 'the work folder is writable: ' + work, e.message); }
}
note(existsSync(join(here, 'node_modules', 'three')) ? 'three.js is installed here: pages can be built with --offline' : 'three.js is not installed: pages load it from the internet. For offline pages run: npm install three@0.160.0 --no-save (in ' + here + ')');
note(existsSync(join(here, 'node_modules', 'occt-import-js')) ? 'occt-import-js is installed: the STEP shapes option works' : 'occt-import-js is not installed: only needed for the optional STEP shapes (npm install in ' + here + ')');
console.log(bad ? '\n' + bad + ' problem(s). Fix them before exporting.' : '\nNode side is ready. Now confirm Fusion: list its open documents with the Fusion tool; the assembly to edit should be the active one.');
process.exit(bad ? 1 : 0);
