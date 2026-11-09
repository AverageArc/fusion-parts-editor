// Takes the README screenshot: the sample page with a few edits made, so the picture shows what the page does.
//   node tools/screenshot.mjs        writes docs/editor-screenshot.jpg
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openSamplePage, root } from './headless.mjs';

const b = await openSamplePage({ width: 1400, height: 860 });
if (!b) process.exit(0);
try {
  await b.evalJs(`(async () => {
    const set = (el, v, change) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); if (change) el.dispatchEvent(new Event('change', { bubbles: true })); };
    const arts = [...document.querySelectorAll('.part')], by = n => arts.find(a => a.querySelector('[data-pname]').value === n);
    const roots = arts.filter(a => a.innerHTML.includes('>body<'));
    set(roots[0].querySelector('[data-pname]'), 'Base plate'); set(roots[1].querySelector('[data-pname]'), 'Cover plate');
    const screw = by('M3x8 screw'); set(screw.querySelector('[data-pname]'), 'M3x8 socket screw'); set(screw.querySelector('input[data-f=material]'), 'Stainless Steel AISI 304', true);
    await new Promise(r => setTimeout(r, 1500)); })()`);
  const shot = await b.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'editor-screenshot.jpg'), Buffer.from(shot.result.data, 'base64'));
  console.log('wrote docs/editor-screenshot.jpg');
} finally { b.close(); }
