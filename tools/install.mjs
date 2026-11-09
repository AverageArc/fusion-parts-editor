// Copies the skill folder into your Claude skills folder, replacing an older copy.
//   node tools/install.mjs                  install into ~/.claude/skills
//   node tools/install.mjs --dest <folder>  install somewhere else (for example to try it out)
import { cpSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const i = process.argv.indexOf('--dest');
const skillsDir = i > 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : join(homedir(), '.claude', 'skills');
const from = join(root, 'fusion-parts-editor'), to = join(skillsDir, 'fusion-parts-editor');

if (!existsSync(join(from, 'SKILL.md'))) { console.error('Cannot find fusion-parts-editor/SKILL.md next to this script.'); process.exit(1); }
if (existsSync(to)) { rmSync(to, { recursive: true, force: true }); console.log('replaced the copy that was there'); }
cpSync(from, to, { recursive: true });
console.log('installed: ' + to);
console.log('Start a new Claude session so the skill is picked up.');
