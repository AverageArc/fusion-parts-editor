# Fusion Parts Editor: project rules

A Claude skill (`fusion-parts-editor/`) that exports an open Fusion 360 assembly, builds an editing page, and applies the owner's answers back to the design. Read `NOTES.md` first, then `README.md`.

## Rules
- **The skill folder is the product.** `fusion-parts-editor/SKILL.md` is what Claude follows in a user's session, so keep it accurate when scripts or the page change. `<SKILL_DIR>` in it stands for the skill's own folder; do not put real machine paths in it.
- **Never save the Fusion document, and never apply without a dry run first.** Linked parts stay locked unless the owner agrees in the conversation.
- **Identify parts by occurrence path**, never by `entityToken` or `Component.id` (they are not unique in real assemblies).
- `fusion_export.py` and `fusion_apply.py` run inside Fusion's Python. Do not wrap `run()` in a blanket try/except (the tool returns the exception); catch only around optional property reads and around each single edit.
- Run `npm test` after changing the page builder or the template. The Fusion scripts can only be checked in a real Fusion session; say so when reporting.
- Examples are made up (`tools/make-sample.mjs`). Do not add exports from a real design: they carry part names and geometry (including purchased parts' geometry). `assembly-work/` is git-ignored for that reason.
- No personal details, machine paths or names of other projects in any file.
- American spelling in all text, code and docs.
- Use the Edit tool, not scripted text replacement, to change files.
- Do not commit, push or publish unless asked; when committing, add no `Co-Authored-By` or other attribution lines.
- Report outcomes faithfully: what was tested, what was not, what failed.
- Confirm the current step before starting. When a choice is the owner's, ask with a short form (a recommendation first) and say what you recommend.
- Give a one-line "good point to commit" reminder at natural checkpoints.
- This repository is the source of truth for the skill. Another project carries copies of the scripts; see NOTES.md ("Relationship to the assembly guide project").
