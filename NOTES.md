# Notes

Written 2026-11-09 when this project was split into its own folder. Read this first in a new session.

## What this is

One Claude skill, `fusion-parts-editor`, that lets you change the names, materials, appearances and colors of a Fusion 360 assembly quickly: export, edit in a page, paste the answers back, Claude applies them to the open design. The README describes use; this file records how it came to be and what is known.

## How it came about

It started as a request to analyze one assembly (a pen-slide toolhead) and show the findings on a page with a rotatable 3D view. Looking at the real Fusion model through the Fusion MCP connector showed how messy names and materials were ("Body1", "Component3", the same part under several materials). The useful thing was not a report but a fast way to fix them, so the work became: export everything, show it in a scratchpad, apply the answers. A second, separate project (an assembly guide builder) uses the same export.

## Decisions

- **A skill, not a standalone tool.** Writing to Fusion needs a Claude session with Fusion connected. The page is only a scratchpad; every change to Fusion goes through the apply script after a dry run.
- **Fusion's own tessellation for the 3D view by default**, with the design's STEP file as an option (added 2026-11-09). The default keeps hidden state and needs no extra install; placement was verified to 0.0000 mm against Fusion's own placed bodies. The STEP option exports `assembly.step`, reads it with occt-import-js, and matches each solid to a Fusion body by center of mass and volume (`step_geometry.mjs`), because a STEP file has no Fusion occurrence paths. Shapes are then stored once per part in component space. On the pen-slide assembly, 44 of 44 visible placed bodies matched and the largest gap was 0.043 mm. Neither route uses STL, and neither affects the edits, which are written back by occurrence path.
- **Claude suggests, the owner decides** (added 2026-11-09). The loop was owner-types-everything; now Claude proposes edits with reasons and the owner reviews them in the same page. A proposal is just an answers file with an optional `reason`, so applying is unchanged and still goes through the dry run. Claude writes a short spec and `make_proposal.mjs` fills in paths and "was" values, because hand-copying them is error-prone. Proposed edits are matched to parts by id and name, and skipped if the export has changed.
- **Viewer quality** (2026-11-09). The first exports cut curves coarsely (a pen tip showed as a hexagon, 27k triangles for 24 bodies) and the page recomputed smooth normals over every edge. The export now sets `maxNormalDeviation` to 8 degrees and stores Fusion's own vertex normals (see `fusion-api-notes.md`); 149k triangles, 1.5 MB page. STEP shapes still use the old shading because they carry no normals; passing OpenCascade's normals through (rotated into component space) is a possible next step.
- **Linked parts are renamed by renaming their library file** (added 2026-11-09). Fusion refuses to rename a linked component because its name is the root component of the source file, which follows the file name. The export records each linked part's source file (`source.fileId` from `occurrence.documentReference.dataFile`), the page lets the owner type a new name, and `fusion_apply.py` renames the file with `DataFile.name` behind a separate switch (`allow_source_rename`), because it changes every design that uses the file. Verified: export of source files (11 of 13 linked parts), dry run and blocked path on a real file. **Verified on a real apply (3 library renames, 25 lines):** renaming files that are open works and the assembly follows at once, unless the library file also has unsaved edits. See `fusion-api-notes.md`. Known gaps from that run: the page lets a misspelled material through (`stainless steel`, `stainless`), the export's `referenced` flag misses parts nested inside linked files, and duplicate body names get a `(1)` suffix. Nested links (a link inside a linked file) have no source and need the middle file. Idea: a "library mode" that runs on a whole folder of library files instead of one assembly at a time.
- **The ledger is text rows, and every apply is checked after** (2026-11-09). The first real apply showed the JSON ledger was 480 lines for 27 changes and mostly bookkeeping (paths, file ids, body names) the export already holds. The ledger is now one row per change (`ledger.mjs`, `references/ledger-format.md`), read back by `expand_ledger.mjs` against the export, so a ledger cannot disagree with the export it came from. The page inlines the same library, shows problems before copying (unknown material names with the closest ones, duplicate body names, edits inside linked files) and records where each row came from. After applying, `verify_ledger.mjs` compares two exports: DONE / STALE / NOT DONE per row, side effects (a material changing the appearance), and an undo ledger. Old JSON ledgers still apply. Not yet run on a real Fusion session at the time of writing: the export's new `viaLinked` field and file-id grouping, and the `UNSAVED DOCUMENTS` line.
- **Parts are identified by occurrence path** (`Occurrence.fullPathName`), because `entityToken` and `Component.id` collide in real assemblies.
- **The page is the same every run** (one template, data filled in), so scratchpads are uniform.
- **Never save the document.** Saving is the owner's decision.
- **Library parts are editable, nested links are locked** (changed 2026-11-09). A linked part with a known source file is a library part and its page fields are editable, since the ledger is the go-ahead (see below). Links inside linked files stay locked until unlocked. Body edits reach the library only when the source file is saved, and the skill never saves, so the owner saves the modified source files.
- American spelling in all text and code.

## Things learned the hard way

All of the Fusion API behavior is in `fusion-parts-editor/references/fusion-api-notes.md`. The ones that matter most:

- Linked components accept body edits silently, which would change the other document. Renaming a linked component fails.
- Renaming a component changes its occurrence paths, so every target is resolved first.
- Assigning a material can reset the appearance; the order is name, material, appearance, custom color.
- Visible color lives in `opaque_albedo` (plastics), `metal_f0` (metals) or `transparent_color` (clear); `surface_albedo` is always white.
- `transform2` is already the full assembly transform, even for nested occurrences.
- The script tool runs top-level code before `run()`, so top-level prints come first.
- A short stub can load a script from disk (`exec(compile(open(path).read().replace('__PARAMS__', json), path, 'exec'), globals())`), which keeps tool calls small and avoids quoting problems.
- Text written by some editing tools can contain raw U+2028/U+2029 characters, which break JavaScript regex literals. Use `String.fromCharCode`.

## What was tested

- The export on a 61-part, 145-occurrence assembly, including linked and nested components. Placement error 0.0000 mm.
- The editor page on that export (filters, bulk edits, review list, answers) and on the made-up sample in `examples/` (`npm test` builds it).
- The apply script on a throwaway Fusion document: dry run, apply, re-export. It covered renames of components and bodies, material and appearance changes, a custom metal color, and the conflict, missing and blocked cases.

## What was not tested

- Very large assemblies; other Fusion versions; assemblies that use configurations or external references in unusual ways.
- Direct (non-parametric) versus parametric designs beyond the cases above; designs with suppressed or hidden bodies in odd states.
- The skill has not been run through skill-creator evals.
- The apply script cannot be tested outside Fusion; `npm test` only covers the page builder.

## Ideas for next

1. **Chat shortcut.** Say "set all M3 washers to Stainless Steel and rename the plates Plate-1…" and apply it directly through the same dry-run path, without opening the page. The page stays for bigger reviews.
2. ~~**Assembly audit.**~~ Started 2026-11-09 as part of "Claude proposes edits": `audit.mjs` prints flags and mass by material, `make_proposal.mjs` and `build_editor.mjs --proposal` pre-fill the page with reasons. Not yet done: an audit view inside the page itself, and trying it on more than the pen-slide and sample assemblies.
3. **Run skill-creator evals** with a few realistic prompts, and keep a throwaway-document test as a regression check.
4. **Save a real screenshot** of a bigger assembly for the README (the current one is the made-up sample).
5. **Pick a license** and add a `LICENSE` file before publishing.
6. A way to host the page's three.js locally so the page works offline (today it loads from a CDN).

## Relationship to the assembly guide project

A second project (an assembly guide builder, in its own repository) uses the same `fusion_export.py` and carries copies of this skill in its `skills/` folder. **This repository is the source of truth for `fusion-parts-editor/`**, including `fusion_export.py` and `step_geometry.mjs`. When either changes here, copy it into the other project's `skills/fusion-parts-editor/scripts/` and `skills/fusion-assembly-guide/scripts/`, and into your installed skills (`node tools/install.mjs` does the installed one for this skill).

## A first prompt for a new session in this folder

```
Read CLAUDE.md, NOTES.md and README.md. Then run `npm test` and open examples/sample-export/parts-editor.html to see the page.
Tell me in a few lines what you understood, what is tested and what is not, and what you would do first. Then ask me, with a recommendation each,
which of the "Ideas for next" in NOTES.md we should start with. Fusion is connected through the Fusion MCP connector, so you can test against a real
assembly if I open one. Do not commit, deploy or change anything outside this folder without asking.
```

## Privacy

Exports contain part names, materials and the 3D shape of the open design, and nothing else. They are written to a folder you choose and are never uploaded by this skill. `assembly-work/` is in `.gitignore` so real exports do not get committed by accident. The files in `examples/` are made up.
