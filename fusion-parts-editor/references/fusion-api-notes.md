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

## Meshing (`body.meshManager.createMeshCalculator()`)
- Defaults for `surfaceTolerance`, `maxSideLength`, `maxAspectRatio` and `maxNormalDeviation` all read 0.0 (engine defaults).
- `maxNormalDeviation` is in **degrees** and is what makes curves look round. `surfaceTolerance` barely changes the count (a 5x change moved a test assembly from 27k to 51k triangles).
- A `maxNormalDeviation` of 1 or less (or any radian-looking value) makes Fusion ignore the tolerance and return a huge mesh (5.5 million triangles for 24 bodies). Keep it at 3 or more. Measured on a 24-body assembly with tolerance at 0.1% of the body diagonal: 6 degrees gave 228k triangles, 8 gave 149k, 10 gave 110k, 15 gave 74k.
- Mesh nodes are duplicated along face boundaries and `normalVectorsAsFloat` gives one exact normal per node, so the normals keep hard edges hard and curved faces smooth. Use them instead of recomputing normals in the viewer.

## Linked components (`isReferencedComponent`)
- Setting `material`, `appearance` or a body `name` on a linked component's bodies **succeeds without warning**, so it would change the other document. Treat as blocked unless the user agrees.
- Renaming a linked component fails with "root component name cannot be changed". The reason: the component's name is the name of the **root component of the source file**, which follows the file name (all 11 linked parts checked in one assembly matched their source file name exactly).
- The source file: `occurrence.documentReference.dataFile` gives a `DataFile` (`id`, `name`, `versionNumber`, `parentFolder.name`, `parentProject.name`). Its `id` carries `?version=N`; strip that for a stable id and `app.data.findFileById(id)` returns the latest. For a reference inside a linked file, `documentReference` raises "Cannot get allDocumentReferences of a non-top-level document", so those have no source.
- `DataFile.name` is settable (renames the file in the cloud, in every design that uses it). `DataFile.isReadOnly` is true when someone else is editing it. `DataFiles` (a folder's files) has `item`, `itemById`, `count` and `asArray`; there is no lookup by name, so a name collision in a folder is checked by looping. **Not yet tested:** renaming a file that is open in this session, and how soon the open assembly shows the new name.

## Materials and appearances
- Look up by exact name in `app.materialLibraries` (and `design.materials` / `design.appearances` for anything already in the design).
- Assigning a material can reset the appearance, so set the appearance after.
- Where the visible color lives: plastics `opaque_albedo`; metals `metal_f0`; clear materials `transparent_color`. `surface_albedo` is always white and not the color you see.
- A custom color: `design.appearances.addByCopy(base, name)`, then set that color property to `adsk.core.Color.create(r, g, b, 255)`, then assign the copy. Reuse the copy by name when the same color is requested again.
- Density is `structural_Density` in kg/m³ on a material's `materialProperties`.

## Observed on the first real apply (library parts, 2026-11-09)
- Renaming a library file with `DataFile.name` worked on files open in the session. The documents showed the new name at once, and the linked component's name in the open assembly followed (`Washer` became `Washer-M3`). A library file that also had unsaved edits (body renames) kept its old component name in the assembly while its cloud file name was already the new one, so expect that name to follow once the file is saved.
- Body and material edits on linked parts made the source documents modified (unsaved) in the session: 9 library documents plus the assembly after one apply. Nothing was saved.
- Assigning a material also changed the appearance to the new material's own default (an aluminum screw set to Stainless Steel went from `Aluminum - Satin` to `Stainless Steel - Satin`), except where the part had a design-level appearance such as `ABS (White) (1)` or a Nylon print appearance, which stayed. So a material change usually carries a sensible appearance with it, but it is not guaranteed.
- Two bodies in one component cannot share a name: Fusion renamed the second one asked to be `Plate` to `Plate (1)`. A dry run cannot predict this, so the page should warn about duplicate names.
- `Occurrence.isReferencedComponent` is false for a component that lives inside a linked file reached through a linked parent (for example an O-ring inside a linked collar file, whose path starts with the linked collar). Editing them modified their linked parents' documents. Treat a part as library content when any ancestor in its path is linked.

## Running scripts
- The MCP script tool calls `run(_context)` **after** the top-level code of the script has executed. Prints at top level appear before anything `run` does.
- `exec(compile(open(path).read(), path, 'exec'), globals())` works inside a script, so a short stub can load the real script from disk and substitute `__PARAMS__`.
- A second Fusion window state matters: creating a throwaway test document (`app.documents.add(...)`, direct design) is a safe way to test write operations. Close it with `doc.close(False)`.
- Do not call `doc.save`. Saving is the user's decision.
