# The ledger (`fusion-parts-ledger/2`)

What **Copy answers** puts on the clipboard (the page calls it "your answers"; the format is a ledger), what the owner pastes back, and what `verify_ledger.mjs` writes as an undo ledger. One row per change, short enough to read by eye, exact enough to apply.

```
# fusion-parts-ledger/2
# doc: "Demo bracket"  export: 2026-01-01T00:00:00
# 4 changes in 2 parts; 1 library-file rename (each renames the part in every design that uses the file)
  1  p3   file    name        "M3x8 screw" -> "M3x8 socket screw"  [owner]  (Demo library/Fasteners)
  2  p3   body 0  material    "Steel" -> "Stainless Steel AISI 304"  [suggested]  (library file "M3x8 screw")
  3  p1   comp    name        "Component3" -> "Base plate"  [suggested, changed]
  4  p1   body 0  name        "Body1" -> "Base-1"  [owner]
```

## Rows

`n  part  scope  field  "from" -> "to"  [origin]  (note)`

- **part**: the part id from the export (`p3`). Occurrence paths, file ids, linked flags and body names are looked up in the export by this id, so the ledger stays short and cannot disagree with the export.
- **scope**: `file` (the library file a linked part comes from: only `name`), `comp` (a local component: only `name`), or `body N` (a body by index; top-level bodies are `body 0` of their own part).
- **field**: `name`, `material`, `appearance`, or `color` (a custom color, `#rrggbb`; `from` is empty).
- **"from" -> "to"**: JSON strings, so quotes and any other character are exact. `from` must equal what the export shows; a difference is a PROBLEM (the model or the export moved on).
- **[origin]**: `owner`, `suggested` (Claude's suggestion, kept), `suggested, changed` (Claude's suggestion, edited by the owner). Information only.
- **(note)**: information only. A library-file row shows the project and folder; rows inside linked files say so.

Lines starting with `#` other than the two header lines are comments. Blank lines and a surrounding code fence are ignored. A line that is not a row or a comment is an error: the ledger is refused, never partly read.

## Using it

- `node scripts/expand_ledger.mjs <export_dir> <ledger.txt> <answers.json>` checks it against the export and writes the answers file the apply script reads (`references/answers-format.md`). It reports `PROBLEM` (stop; nothing written), `HELD` (rows left out, with the closest library names) and `WARN` (duplicate names, edits inside linked files).
- `node scripts/verify_ledger.mjs <before> <after> <ledger.txt> --undo undo.txt --receipt receipt.txt` after applying and re-exporting. Each row is `DONE`, `STALE` or `NOT DONE`; side effects are listed; the undo ledger is a normal ledger made against the **after** export that restores every changed value (side effects included). It is applied like any other ledger.
- The page can load a saved ledger with **Load answers…**.

`scripts/ledger.mjs` has no imports: the page builder inlines it, so the page and the tools read and write the same format.
