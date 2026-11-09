# Fusion 360 script: save the open documents the owner names, and only those. OPT-IN: run it only after the owner has said yes in chat.
#
# The apply script never saves. Edits on library parts land in the library files' own documents, which then sit modified (unsaved)
# until someone saves them, and the new materials, appearances and body names are not permanent for other designs until then.
# This script is how the owner can say "save those" without clicking through each one.
#
# Params (replace __PARAMS__ with JSON):
#   {"names": ["M3-Washer", "Sharpie"], "dry_run": true, "comment": "Parts editor: renamed bodies and set materials"}
#   "names"   exact document names to save. Never "all": the owner picks (or agrees to) a list. Names not open or not modified are reported and skipped.
#   "dry_run" true (default) lists what would be saved and changes nothing (call it with readOnly true). false saves.
#   "comment" the version description Fusion stores with each save.
# It never saves a document that is not in "names", never closes anything, and reports each result. Saving creates a new cloud version
# of each document, which the owner can roll back to the previous version in Fusion.
import adsk.core, json

PARAMS = json.loads(r'''__PARAMS__''')


def run(_context: str):
    app = adsk.core.Application.get()
    names = list(PARAMS.get('names') or [])
    dry = bool(PARAMS.get('dry_run', True))
    comment = str(PARAMS.get('comment') or 'Parts editor changes')
    if not names:
        raise RuntimeError('give the exact document names to save in "names"; this script never saves everything')
    open_docs = {}
    for d in app.documents:
        open_docs.setdefault(d.name, []).append(d)
    saved, skipped = 0, 0
    print(('DRY RUN (nothing was saved)' if dry else 'SAVING') + ' %d document(s)' % len(names))
    for n in names:
        docs = open_docs.get(n, [])
        if not docs:
            print('SKIPPED  "%s": not open in this Fusion session' % n)
            skipped += 1
            continue
        if len(docs) > 1:
            print('SKIPPED  "%s": %d open documents have this name; save it by hand so the right one is saved' % (n, len(docs)))
            skipped += 1
            continue
        d = docs[0]
        if not d.isModified:
            print('SKIPPED  "%s": no unsaved changes' % n)
            skipped += 1
            continue
        if getattr(d, 'isReadOnly', False):
            print('SKIPPED  "%s": read-only (someone else may be editing it)' % n)
            skipped += 1
            continue
        if dry:
            print('WOULD SAVE "%s" (%s / %s)' % (n, d.dataFile.parentProject.name if d.dataFile else '?', d.dataFile.parentFolder.name if d.dataFile else '?'))
            continue
        try:
            d.save(comment)
            saved += 1
            print('SAVED    "%s"' % n)
        except Exception as ex:
            print('FAILED   "%s": %s' % (n, str(ex).strip().splitlines()[-1][:120]))
    print('SUMMARY saved=%d skipped=%d' % (saved, skipped))
