// Shared by page-test.mjs and screenshot.mjs: build the sample page with three.js inlined, open it in headless Edge/Chrome, and drive it over the DevTools protocol.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scripts = join(root, 'fusion-parts-editor', 'scripts');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Returns null (with a reason printed) when no browser or no three.js is available. */
export async function openSamplePage({ width = 1400, height = 900, nested = false } = {}) {
  const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(existsSync);
  if (!exe) { console.log('skipped: no Edge or Chrome found'); return null; }
  if (!existsSync(join(scripts, 'node_modules', 'three'))) { console.log('skipped: three.js is not installed (npm install three@0.160.0 --no-save, in fusion-parts-editor/scripts)'); return null; }
  const tmp = mkdtempSync(join(tmpdir(), 'fpe-page-')), sample = join(tmp, 'sample'), page = join(tmp, 'page.html');
  execFileSync(process.execPath, [join(root, 'tools', 'make-sample.mjs'), sample, ...(nested ? ['--nested'] : [])], { stdio: 'pipe' });
  execFileSync(process.execPath, [join(scripts, 'build_editor.mjs'), sample, page, '--offline'], { stdio: 'pipe' });
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${width},${height}`,
    '--remote-debugging-port=' + port, '--user-data-dir=' + join(tmp, 'profile'), 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} }
  if (!target) { proc.kill(); throw new Error('the browser did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waiting = new Map(), errors = [];
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiting.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'script error'); return r.result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(page).href });
  for (let i = 0; i < 50; i++) { await sleep(200); if (await evalJs('document.querySelectorAll(".part").length')) break; }
  return { send, evalJs, errors, sleep, close() { try { ws.close(); } catch {} proc.kill(); } };
}
