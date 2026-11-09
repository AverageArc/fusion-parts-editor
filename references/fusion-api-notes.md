# Fusion API notes (learned the hard way while building this skill)

Read before changing the scripts. Everything here was observed on a live assembly with about 60 parts, 178 placed copies, 123 linked occurrences and 73 nested occurrences.

## Identity
- `entityToken` and `Component.id` are **not unique** in real designs. Components copied from the same template, or linked from other documents, share both (six groups of colliding tokens and four of colliding ids were seen). `findEntityByToken` round-trips for simple local bodies but cannot be trusted in general.
- `Occurrence.fullPathName` is unique (184 of 184 distinct). It changes when a component is renamed (`Screw:1` becomes `M3 screw:1`), so resolve every target to an object before renaming anything.
- Two occurrences are treated as the same part when the component name, the linked flag and the body names plus volumes agree. Edits are applied through every path, and re-setting an identical value is harmless.

## Geometry and placement
- `Occurrence.transform2` is already the full assembly-space transform, including for nested occurrences. Composing parent transforms on top of it is wrong (about 77 mm of error in the test). The export spot-checks every occurrence against the real placed body and reports the worst error.
- `Matrix3D.getCell(row, col)` has the translation in column 3, in centimeters. The export converts to millimeters.
- Component bodies are meshed in component space, and each copy carries a matrix, so repeated parts share one mesh.
- `defaultModelingOrientation` is a user preference, not a property of the document, so the up axis is only a hint. The editor has a Z up / Y up toggle.

## Linked components (`isReferencedComponent`)
- Setting `material`, `appearance` or a body `name` on a linked component's bodies **succeeds without warning**, so it would change the other document. Treat as blocked unless the user agrees.
- Renaming a linked component fails with "root component name cannot be changed".

## Materials and appearances
- Look up by exact name in `app.materialLibraries` (and `design.materials` / `design.appearances` for anything already in the design).
- Assigning a material can reset the appearance, so set the appearance after.
- Where the visible color lives: plastics `opaque_albedo`; metals `metal_f0`; clear materials `transparent_color`. `surface_albedo` is always white and not the color you see.
- A custom color: `design.appearances.addByCopy(base, name)`, then set that color property to `adsk.core.Color.create(r, g, b, 255)`, then assign the copy. Reuse the copy by name when the same color is requested again.
- Density is `structural_Density` in kg/m³ on a material's `materialProperties`.

## Running scripts
- The MCP script tool calls `run(_context)` **after** the top-level code of the script has executed. Prints at top level appear before anything `run` does.
- `exec(compile(open(path).read(), path, 'exec'), globals())` works inside a script, so a short stub can load the real script from disk and substitute `__PARAMS__`.
- A second Fusion window state matters: creating a throwaway test document (`app.documents.add(...)`, direct design) is a safe way to test write operations. Close it with `doc.close(False)`.
- Do not call `doc.save`. Saving is the user's decision.
