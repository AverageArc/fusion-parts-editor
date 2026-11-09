// A quick check that the page builds from the sample export. Run with: npm test
// (The two Fusion scripts run inside Fusion's own Python, so they cannot be checked here.)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tmp = mkdtempSync(join(tmpdir(), 'fpe-'));
const out = join(tmp, 'parts-editor.html');
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok    ' : 'FAIL  ') + what); if (!ok) failed++; };

execFileSync(process.execPath, [join(root, 'tools', 'make-sample.mjs')], { stdio: 'pipe' });
execFileSync(process.execPath, [join(root, 'fusion-parts-editor', 'scripts', 'build_editor.mjs'), join(root, 'examples', 'sample-export'), out], { stdio: 'pipe' });
const html = readFileSync(out, 'utf8');
check(statSync(out).size > 10000, 'the page is a reasonable size (' + Math.round(statSync(out).size / 1024) + ' KB)');
check(!html.includes('__ASSEMBLY__') && !html.includes('__GEO__'), 'no template placeholders are left');
check(html.includes('Demo bracket'), 'it carries the document name');
check(html.includes('"referenced":true'), 'it carries the linked-part flag');
check(/"instances":\[/.test(html) && html.includes('"partId":"p0"'), 'it carries the placed copies');
const answers = JSON.parse(readFileSync(join(root, 'examples', 'answers.example.json'), 'utf8'));
check(answers.format === 'fusion-parts-answers/1' && Array.isArray(answers.edits) && answers.edits.length > 0, 'the example answers file has the expected shape');
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
