// Turn the owner's pasted ledger into the answers file the apply script reads, checking it against the export first.
//   node expand_ledger.mjs <export_dir> <ledger.txt> <answers.json>
// Prints what it found. Exit code 1 when the ledger does not fit the export (wrong document or export, unknown part, a value that
// differs from the export): do not apply then. "HELD" rows (a name that is not in Fusion's library, a cleared value) are left out of
// answers.json with suggestions; apply the rest and ask the owner once about those. WARN lines are for the report, not a stop.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandLedger, parseLedger } from './ledger.mjs';

const [dir, ledgerPath, outPath] = process.argv.slice(2);
if (!dir || !ledgerPath || !outPath) { console.error('usage: node expand_ledger.mjs <export_dir> <ledger.txt> <answers.json>'); process.exit(1); }
const A = JSON.parse(readFileSync(join(dir, 'assembly.json'), 'utf8'));
let L;
try { L = parseLedger(readFileSync(ledgerPath, 'utf8')); } catch (e) { console.error('PROBLEM: ' + e.message); process.exit(1); }
const { answers, problems, held, warnings } = expandLedger(L, A);
for (const p of problems) console.log('PROBLEM: ' + p);
for (const h of held) console.log('HELD:    ' + h.what + ': ' + h.why + (h.suggestions.length ? '. Closest in Fusion: ' + h.suggestions.map(s => '"' + s + '"').join(', ') : ''));
for (const w of warnings) console.log('WARN:    ' + w);
if (problems.length) { console.log('\nNothing written: the ledger does not fit this export.'); process.exit(1); }
writeFileSync(outPath, JSON.stringify(answers, null, 1));
const nb = answers.edits.reduce((n, e) => n + (e.bodies || []).reduce((m, b) => m + Object.keys(b.set).length, 0) + (e.rename ? 1 : 0) + (e.renameSource ? 1 : 0), 0);
console.log('wrote ' + outPath + ': ' + answers.edits.length + ' parts, ' + nb + ' changes' + (held.length ? ', ' + held.length + ' held back' : '') + (warnings.length ? ', ' + warnings.length + ' warning(s)' : ''));
