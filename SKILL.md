---
name: fusion-parts-editor
description: Clean up and curate the parts of the Fusion 360 assembly that is open right now. Exports every part with its geometry, makes an interactive 3D scratchpad where the user renames parts, fixes materials and appearances, edits colors in bulk, then takes the pasted answers back and applies them to the open Fusion design. Use this whenever the user wants to rename or tidy parts in a Fusion assembly, fix or assign materials and appearances, clean up "Body1 / Body2 / Component3" names, audit what an assembly is made of, review or correct a bill of materials before documenting it, or says things like "go through my parts", "update all the parts to match", or "make a parts sheet I can edit" for an open Fusion design. Use it as the first step before building assembly instructions or a step-by-step viewer from a Fusion model, even if the user does not mention a scratchpad.
---

# Fusion parts editor

Two halves, one loop:

1. **Export and scratchpad.** Read the open Fusion assembly, build one self-contained HTML page with a 3D view and an editable parts table.
2. **Apply.** The user edits in the page, clicks **Copy answers**, pastes the JSON back to you, and you update Fusion to match, after checking it against the live model.

The page never touches Fusion. Everything that changes the design happens in `scripts/fusion_apply.py`, and only after a dry run.

## Before you start

- `<SKILL_DIR>` in the commands below means this skill's own folder: the base directory shown when the skill loads (usually `~/.claude/skills/fusion-parts-editor`). Fill in its full path, with forward slashes, before running anything.
- The Fusion MCP tools (`mcp__Autodesk_Fusion__fusion_mcp_execute` and `..._read`) must be loaded. They are usually deferred, so load them with ToolSearch first. If they are not available, say so and stop: the user needs to connect Fusion.
- `node` must be on the PATH (the page builder is a small Node script).
- Check which document is active: `fusion_mcp_read` with `queryType: "document", operation: "open"`, or just read the name from the export summary. Tell the user which document you are about to export. If several are open and it is not the one they meant, ask.
- Pick a work folder for this run, for example `<current project>/assembly-work/<document name>/`, and use absolute paths with forward slashes (`C:/Users/...`) everywhere, because they are pasted into Python source.

## Step 1: export (read-only)

Do not paste the whole script into the tool call. The Fusion script runner can execute a file from disk, so send this short stub (set `PARAMS_JSON` for the run; keep it free of triple quotes and backslashes):

```python
import json
SCRIPT = r'<SKILL_DIR>/scripts/fusion_export.py'
PARAMS_JSON = json.dumps({'out_dir': '<WORK_DIR>/export', 'quality': 1.0})
exec(compile(open(SCRIPT, encoding='utf-8').read().replace('__PARAMS__', PARAMS_JSON), SCRIPT, 'exec'), globals())
```

Call `fusion_mcp_execute` with `featureType: "script"`, `object: {"readOnly": true, "script": <the stub>}`. If the skill is installed somewhere else, change `SCRIPT` to its real location.

It writes `assembly.json` and `meshes.json` and prints a summary: part count, how many are **linked**, triangle count, and a placement check (the worst error should be about 0.0000 mm; anything over 0.05 mm means the transforms are off, so tell the user). `quality` scales mesh detail (0.5 for a huge assembly, 2 for a small one); `tri_cap` limits triangles per body.

## Optional: shapes from the STEP file

By default the 3D shapes are triangles that Fusion's own mesh calculator makes from its exact bodies. If the user wants the shapes to come from the design's **STEP file** instead (the exact surfaces, turned into triangles by OpenCascade), do this:

1. Export with `'mesh': False, 'step': True` in `PARAMS_JSON`. It writes `assembly.step` and does no Fusion meshing.
2. Once, install the reader: run `npm install` in `<SKILL_DIR>/scripts` (about 8 MB, the `occt-import-js` package).
3. Run `node <SKILL_DIR>/scripts/step_geometry.mjs "<WORK_DIR>/export"` (add `--detail fine` for smoother curves, about three times the triangles).

The script matches each STEP solid to its Fusion body by center of mass and volume (a STEP file has no Fusion paths), moves the solid into its component's own space, and rewrites `meshes.json`. Read its report: how many placed bodies matched, the largest gap between a Fusion center of mass and its solid (a good run is well under 0.1 mm; the pen-slide test gave 0.043 mm), and anything not matched. Then carry on with the next step as normal. The page and the apply script do not change, because edits are written back by occurrence path and never depend on the shapes.

Things to know:
- Hidden parts are not in the STEP file, so they have no shape in this mode.
- A STEP file has no materials or masses; those still come from Fusion's data in `assembly.json`.
- If many visible bodies go unmatched, export again the normal way.
- `assembly.step` stays in the work folder. It is the user's design, so do not publish it.

## Step 2: build the scratchpad

```bash
node <SKILL_DIR>/scripts/build_editor.mjs "<WORK_DIR>/export" "<WORK_DIR>/parts-editor.html"
```

It prints the file size. About 80,000 triangles gives roughly 800 KB. Files over about 600 KB cannot be opened by the Claude desktop preview pane, so give the user the path and tell them to open it in Chrome or Edge, or serve the folder locally for them if they ask to see it in the pane.

Tell the user, briefly, what the page does:
- 3D view on the left. Click a part to tick it, hover to see its name.
- Table on the right: rename the component, rename each body, set material and appearance (type to search the libraries), pick a custom color. Edited fields turn amber, and the mass updates when the material changes.
- Search, filters ("Default names", "Linked", "Changed"...), and sorting. Tick several parts for bulk actions: set a material, appearance or color, find and replace in names, add a prefix or suffix.
- **Review changes** lists every edit. **Copy answers** copies the result to paste into the chat. The page autosaves in the browser, so closing it loses nothing.

## Step 3: apply the answers

When the user pastes the JSON (format in `references/answers-format.md`):

1. **Save it to a file** in the work folder (`answers.json`) with the Write tool, exactly as pasted. Passing a file avoids quoting problems.
2. **Check the document.** The JSON carries the document name. If the active Fusion document is a different one, stop and ask.
3. **Dry run first, always.** Use the apply stub with `dry_run: true` and `readOnly: true`:

```python
import json
SCRIPT = r'<SKILL_DIR>/scripts/fusion_apply.py'
PARAMS_JSON = json.dumps({'answers_path': '<WORK_DIR>/answers.json', 'dry_run': True, 'allow_linked': False})
exec(compile(open(SCRIPT, encoding='utf-8').read().replace('__PARAMS__', PARAMS_JSON), SCRIPT, 'exec'), globals())
```

   The output lists each edit as `OK`, `ALREADY`, `BLOCKED`, `CONFLICT`, `MISSING` or `FAILED`.
4. **Summarize the plan** to the user in plain words: how many parts and fields will change, and anything that will be skipped and why.
   - **CONFLICT** means the value in Fusion is no longer what the page saw (someone edited it since the export). Ask whether to re-export or override.
   - **MISSING** means a material or appearance name is not in Fusion's libraries or the design (usually a typo), or a part no longer exists. Offer the closest names from `assembly.json` (`libraries`).
   - **BLOCKED** (linked parts) is described below. Never pass `allow_linked: true` unless the user has said yes to editing the other document in this conversation.
5. **Apply** with the same stub and `dry_run: false` (no `readOnly`). Only proceed without asking if the dry run had no conflicts, missing items or blocked edits, or the user already told you what to do about them. The user pasting answers is their instruction to apply them.
6. **Verify.** Re-run the export into a fresh folder and compare the new `assembly.json` against what was asked for, or read a few parts back. Report real results: what changed, what was skipped, and anything that failed. Do not say "done" on the strength of the apply output alone.
7. **Never save the document.** Tell the user the changes are in the open design only, that Ctrl+Z or closing without saving discards them, and that saving is theirs to do.

## Things that will bite you

- **Identity is the occurrence path, not an ID.** Fusion's `entityToken` and `Component.id` collide in real assemblies (copied templates, linked documents). The scripts address parts by `Occurrence.fullPathName` and apply every edit idempotently across all copies. Do not "simplify" this to tokens. Renaming a component changes its occurrence paths, so the apply script resolves everything before it changes anything; keep it that way.
- **Linked parts** (`referenced: true`) live in another Fusion document. Fusion accepts material, appearance and body-name edits on them without complaint, which would silently change the other file, and it refuses to rename their component. The page locks them by default ("Unlock linked") and the apply script blocks them. The cleaner route is to open the linked document itself (often already open in the user's session) and run this skill there.
- **Order matters.** Assigning a material can reset the appearance, so the script applies name, then material, then appearance, then custom color. A custom color is stored as a design appearance copied from the part's appearance, with the visible color property changed (`opaque_albedo` for plastics, `metal_f0` for metals).
- **Units.** Fusion's API is in centimeters and kilograms; the exports are millimeters and grams. Densities are kg/m³.
- **A script that raises an exception returns it as the tool error.** Do not wrap `run()` in a blanket try/except; the scripts only catch around optional property reads and around each individual edit so one failure is reported without hiding the rest.
- **Hidden parts** are exported and shown faintly via "Show hidden". Spare variants that are hidden still count in Fusion's own mass readout, which is worth pointing out if the user's totals look wrong.
- **Big assemblies.** The export shares one mesh per part and places copies by matrix, so repeated screws cost almost nothing. If the page is still heavy, rerun with `quality` 0.5 or a lower `tri_cap`.

## After applying

Offer the next step: the exported data (`assembly.json`) is the input for building the step-by-step assembly viewer. Re-export after applying so downstream work sees the corrected names and materials.

## Files

- `scripts/fusion_export.py`: Fusion script, read-only. Writes `assembly.json` and `meshes.json`.
- `scripts/build_editor.mjs`: Node. Builds `parts-editor.html` from the export.
- `scripts/fusion_apply.py`: Fusion script. Dry run or apply.
- `assets/parts-editor.template.html`: the page template (three.js from a CDN).
- `references/answers-format.md`: the answers JSON, field by field.
- `references/fusion-api-notes.md`: API behavior discovered while building this (read it before changing the scripts).
