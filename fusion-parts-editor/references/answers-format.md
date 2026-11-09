# Answers format

What `fusion_apply.py` reads. Only changed things are included. The page's **Copy ledger** now produces the shorter text ledger (`references/ledger-format.md`); `scripts/expand_ledger.mjs` turns that into this file using the export. Older ledgers in this JSON form still apply as they are. A proposal file for the page (`make_proposal.mjs`) has this shape too.

```json
{
  "format": "fusion-parts-answers/1",
  "document": "Demo bracket",
  "exportedAt": "2026-11-08T23:44:24",
  "allowLinked": false,
  "edits": [
    {
      "part": "p5",
      "kind": "component",
      "linked": false,
      "partName": "M3 WASHER",
      "paths": ["M3 WASHER:1", "M3 WASHER:2", "BELT_MOUNT:1+M3 WASHER:1"],
      "rename": { "from": "M3 WASHER", "to": "M3 washer" },
      "bodies": [
        {
          "index": 0,
          "bodyName": "Body1",
          "was": { "name": "Body1", "material": "Aluminum", "appearance": "Surface - Matte" },
          "set": { "name": "Washer", "material": "Stainless Steel AISI 304", "appearance": "Stainless Steel - Satin", "customColor": "#aabbcc" }
        }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `document` | Name of the Fusion document the export came from. Compare with the active document before applying. |
| `allowLinked` | `true` when an edit changes the bodies of a linked part (a library part, or a nested link the owner unlocked). Applying linked edits also needs `allow_linked: true` in the script parameters; the pasted ledger is the owner's go-ahead. Edits on locked nested links are left out of the ledger. |
| `part` | Part id from the export (`p0`, `p1`...). Informational; matching uses paths. |
| `kind` | `root`: a body directly under the top-level component (edited by body name; `paths` is empty). `component`: a component definition with one or more copies. |
| `linked` | The component lives in another document. |
| `paths` | `Occurrence.fullPathName` of every copy. The apply script visits all of them, which is why edits reach every copy. |
| `rename` | Component rename, applies to every copy. Not possible for linked components. |
| `renameSource` | Linked parts only: `{ "fileId", "from", "to", "project", "folder" }`. Renames the **library file** the part comes from, because a linked component's name is its source file's name. It renames the part in every design that uses that file, so `fusion_apply.py` blocks it unless it runs with `allow_source_rename: true` (set only after the owner agrees to the dry-run list). `fileId` comes from the export (`source.fileId`) and identifies the file; `from` is checked against the file's current name (CONFLICT if it changed). |
| `allowSourceRename` | `true` when any edit has `renameSource`. Informational: the real gate is the script parameter. |
| `bodies[].index` | Position of the body inside the component (stable while the model is unchanged). `bodyName` is its name at export time. |
| `bodies[].was` | Values at export time, used to detect that someone changed the model since. A mismatch is reported as CONFLICT and that field is skipped. |
| `bodies[].set` | New values. `name`, `material`, `appearance` are names looked up exactly in the libraries and the design; `customColor` is `#rrggbb`. |

| `reason` | Optional, on an edit. Why the change was suggested; shown in the page next to the part and carried through when the page copies answers. `fusion_apply.py` ignores it. |

The same format is used for a **proposal** (edits Claude suggests): `scripts/make_proposal.mjs` writes it from a short spec, and the page loads it through `build_editor.mjs --proposal` or the **Load answers…** button. A proposal is only loaded for parts whose names still match the export, so a stale one skips those parts.

Fields are applied in a fixed order: `name`, `material`, `appearance`, `customColor`.
