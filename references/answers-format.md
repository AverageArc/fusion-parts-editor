# Answers format

What **Copy answers** produces and what `fusion_apply.py` reads. Only changed things are included.

```json
{
  "format": "fusion-parts-answers/1",
  "document": "TOOLHEAD (NEWEST)",
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
| `allowLinked` | `true` only if the user ticked "Unlock linked" and edited a linked part. Applying linked edits also needs `allow_linked: true` in the script parameters, which you set only after the user agrees. |
| `part` | Part id from the export (`p0`, `p1`...). Informational; matching uses paths. |
| `kind` | `root`: a body directly under the top-level component (edited by body name; `paths` is empty). `component`: a component definition with one or more copies. |
| `linked` | The component lives in another document. |
| `paths` | `Occurrence.fullPathName` of every copy. The apply script visits all of them, which is why edits reach every copy. |
| `rename` | Component rename, applies to every copy. Not possible for linked components. |
| `bodies[].index` | Position of the body inside the component (stable while the model is unchanged). `bodyName` is its name at export time. |
| `bodies[].was` | Values at export time, used to detect that someone changed the model since. A mismatch is reported as CONFLICT and that field is skipped. |
| `bodies[].set` | New values. `name`, `material`, `appearance` are names looked up exactly in the libraries and the design; `customColor` is `#rrggbb`. |

Fields are applied in a fixed order: `name`, `material`, `appearance`, `customColor`.
