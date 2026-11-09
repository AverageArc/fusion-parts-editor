// Drives the built page in a real headless browser (Edge or Chrome) and checks the parts that npm test cannot see: the page's own JavaScript.
//   npm run test:page
// Needs Edge or Chrome installed, and three.js for the offline build:  npm install three@0.160.0 --no-save  (in fusion-parts-editor/scripts).
// If either is missing it says so and exits 0 (skipped), so it never blocks the main tests.
import { openSamplePage } from './headless.mjs';

let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok    ' : 'FAIL  ') + what); if (!ok) failed++; };
let b;
try {
  b = await openSamplePage();
  if (!b) process.exit(0);
  check(await b.evalJs('document.querySelectorAll(".part").length') === 5, 'the page renders its five parts (three.js loaded with no network)');
  const r = await b.evalJs(`(async () => {
    const set = (el, v, change) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); if (change) el.dispatchEvent(new Event('change', { bubbles: true })); };
    const arts = [...document.querySelectorAll('.part')], by = n => arts.find(a => a.querySelector('[data-pname]').value === n);
    const out = {};
    const screw = by('M3x8 screw'); set(screw.querySelector('[data-pname]'), 'M3x8 socket screw');
    set(screw.querySelector('input[data-f=material]'), 'stainless steel aisi 304', true);
    out.snapped = screw.querySelector('input[data-f=material]').value;
    out.summary = document.querySelector('#reviewSum').textContent;
    set(by('M3 WASHER').querySelector('input[data-f=material]'), 'unobtainium', false);
    const roots = arts.filter(a => a.innerHTML.includes('>body<')); roots.slice(0, 2).forEach(a => set(a.querySelector('[data-pname]'), 'Same', false));
    let asked = null, copied = null; window.confirm = m => { asked = m; return true; }; navigator.clipboard.writeText = async t => { copied = t; };
    document.querySelector('#copy').click(); await new Promise(r => setTimeout(r, 200));
    out.asked = asked; out.copied = copied; out.flags = [...document.querySelectorAll('#changes .warn')].map(x => x.textContent);
    out.button = document.querySelector('#copy').textContent;
    document.querySelector('.part[data-pid="' + screw.dataset.pid + '"] [data-revert]').click();
    out.afterRevert = document.querySelector('#reviewSum').textContent;
    return out; })()`);
  check(r.snapped === 'Stainless Steel AISI 304', 'a wrong-case material name snaps to the library name');
  check(/^Your answers: 2 changes in 1 part$/.test(r.summary), 'the heading counts the changes (' + r.summary + ')');
  check(r.copied && r.copied.startsWith('# fusion-parts-ledger/2') && /\n\s*\d+\s+p\d+\s+file\s+name\s+"M3x8 screw" -> "M3x8 socket screw"\s+\[owner\]/.test(r.copied), 'Copy answers copies the text ledger, with the library-file rename row');
  check(r.asked && r.asked.includes('Held back') && r.asked.includes('unobtainium') && r.asked.includes('"Same" would be used 2 times'), 'copying asks about an unknown material and a duplicate name first');
  check(r.flags.length >= 2, 'the same warnings are shown under the answers');
  check(r.button === 'Copied ✓' || r.button === 'Copy answers', 'the button says "Copy answers"');
  check(/^Your answers: 3 changes in 3 parts$/.test(r.afterRevert), 'Revert on a part takes its rows out (' + r.afterRevert + ')');
  check(b.errors.length === 0, 'no JavaScript errors' + (b.errors.length ? ': ' + b.errors[0] : ''));
} catch (e) { console.log('FAIL  ' + e.message); failed++; }
finally { b?.close(); }
console.log(failed ? failed + ' check(s) failed' : 'all page checks passed');
process.exit(failed ? 1 : 0);
