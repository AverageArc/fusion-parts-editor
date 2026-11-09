# Fusion 360 script: apply the answers copied from the parts editor to the open design.
#
# Run it through the Fusion MCP `execute` tool (featureType "script").
# Before sending it, replace __PARAMS__ on the PARAMS line with a JSON object:
#   {"answers_path": "C:/work/answers.json", "dry_run": true, "allow_linked": false, "allow_source_rename": false}
# "allow_source_rename" lets an edit rename the library FILE a linked part comes from (the answers carry "renameSource").
# That renames the part in every design that uses the file, so set it only after the owner has agreed to the dry-run list.
# ("answers": {...} with the object inline also works, but a file avoids quoting problems.)
# Always run it once with "dry_run": true (and "readOnly": true on the tool call). A dry run changes nothing; it only
# reports what would happen and which edits cannot be applied. Run it again with "dry_run": false to apply.
#
# It never saves the document. Changes are in the open design only; closing without saving discards them.
import adsk.core, adsk.fusion, json

PARAMS = json.loads(r'''__PARAMS__''')


def find_by_name(collection, name):
    for i in range(collection.count):
        if collection.item(i).name == name:
            return collection.item(i)
    return None


def lookup(app, design, kind, name):
    """Find a material or appearance by exact name, preferring what the design already holds."""
    own = design.materials if kind == 'material' else design.appearances
    hit = find_by_name(own, name)
    if hit is not None:
        return hit
    for lib in app.materialLibraries:
        coll = lib.materials if kind == 'material' else lib.appearances
        hit = find_by_name(coll, name)
        if hit is not None:
            return hit
    return None


def hex_to_rgb(h):
    h = h.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def custom_appearance(design, base, hex_color):
    """A design appearance copied from `base` with its base color set to hex_color. Reused when it already exists."""
    r, g, b = hex_to_rgb(hex_color)
    name = 'Custom %s (%s)' % (hex_color.lstrip('#').lower(), base.name)
    existing = find_by_name(design.appearances, name)
    if existing is not None:
        return existing
    ap = design.appearances.addByCopy(base, name)
    for pid in ('opaque_albedo', 'metal_f0', 'transparent_color', 'generic_diffuse', 'surface_albedo'):   # the property that carries the visible color
        prop = ap.appearanceProperties.itemById(pid)
        if prop is not None and hasattr(prop, 'value'):
            prop.value = adsk.core.Color.create(r, g, b, 255)
            return ap
    ap.deleteMe()
    return None


def run(_context: str):
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    root = design.rootComponent
    answers = PARAMS.get('answers')
    if answers is None:
        with open(PARAMS['answers_path'], encoding='utf-8') as fh:
            answers = json.load(fh)
    dry = bool(PARAMS.get('dry_run', True))
    allow_linked = bool(PARAMS.get('allow_linked', False)) and bool(answers.get('allowLinked', False))
    allow_source = bool(PARAMS.get('allow_source_rename', False)) and bool(answers.get('allowSourceRename', False))

    if answers.get('document') != app.activeDocument.name:
        print('WARNING: these answers were made for "%s" but the active document is "%s".' % (answers.get('document'), app.activeDocument.name))

    occ_by_path = {}
    for o in root.allOccurrences:
        occ_by_path[o.fullPathName] = o

    counts = {'ok': 0, 'already': 0, 'blocked': 0, 'conflict': 0, 'missing': 0, 'failed': 0}
    lines = []

    def note(status, who, what):
        counts[status] = counts.get(status, 0) + 1
        lines.append('%-9s %s: %s' % (status.upper(), who, what))

    # ---- resolve every target before changing anything (renaming a component changes its occurrence paths) ----
    plan = []
    source_work = []      # library files to rename, done last because renaming changes occurrence paths
    seen_files = set()
    for e in answers.get('edits', []):
        who = e.get('partName', e.get('part'))
        rs = e.get('renameSource')
        if rs:
            if not allow_source:
                note('blocked', who, 'renaming the library file "%s" would rename it in every design that uses it. Not touched. Re-run with allow_source_rename after the user confirms.' % rs.get('from'))
            elif rs['fileId'] in seen_files:
                note('failed', who, 'the library file "%s" appears twice in the answers' % rs.get('from'))
            else:
                seen_files.add(rs['fileId'])
                df = app.data.findFileById(rs['fileId'])
                if df is None:
                    note('missing', who, 'library file "%s" was not found (deleted, or no access)' % rs.get('from'))
                elif df.name == rs['to']:
                    note('already', who, 'library file is already named "%s"' % rs['to'])
                elif df.name != rs.get('from'):
                    note('conflict', who, 'library file was renamed since the export (was "%s", now "%s"); skipped' % (rs.get('from'), df.name))
                elif df.isReadOnly:
                    note('blocked', who, 'library file "%s" is read-only right now (someone may be editing it)' % df.name)
                elif any(f.name == rs['to'] and f.id.split('?')[0] != rs['fileId'] for f in df.parentFolder.dataFiles.asArray()):
                    note('conflict', who, 'a file named "%s" already exists in %s/%s; skipped' % (rs['to'], df.parentProject.name, df.parentFolder.name))
                else:
                    source_work.append((who, df, rs, len(e.get('paths', []))))
        if e.get('linked') and not allow_linked:
            if e.get('rename') or e.get('bodies'):
                note('blocked', who, 'lives in another document (linked). Not touched. Re-run with allow_linked after the user confirms.')
            continue
        comps = []        # component definitions to edit (all copies of this part)
        if e['kind'] == 'root':
            bn = e['bodies'][0]['bodyName']
            tgt = find_by_name(root.bRepBodies, bn)
            if tgt is None and e['bodies'][0]['set'].get('name'):
                tgt = find_by_name(root.bRepBodies, e['bodies'][0]['set']['name'])
            if tgt is None:
                note('missing', who, 'no top-level body named "%s"' % bn)
                continue
            body_targets = [(0, tgt)]
            comps = []
        else:
            for p in e.get('paths', []):
                o = occ_by_path.get(p)
                if o is not None:
                    comps.append(o.component)
            if not comps:
                note('missing', who, 'none of its %d occurrence paths exist any more' % len(e.get('paths', [])))
                continue
            body_targets = None
        plan.append((e, who, comps, body_targets))

    # ---- check "was" values and look up the materials / appearances ----
    work = []
    for e, who, comps, root_body in plan:
        ops = []
        if e.get('rename') and e['kind'] == 'component':
            if e.get('linked'):
                note('blocked', who, 'a linked component cannot be renamed here')
            else:
                ops.append(('rename', comps, e['rename']['to'], e['rename']['from']))
        for bd in e.get('bodies', []):
            k = bd['index']
            bodies = [root_body[0][1]] if e['kind'] == 'root' else [c.bRepBodies.item(k) for c in comps if c.bRepBodies.count > k]
            if not bodies:
                note('missing', who, 'body %d (%s) not found' % (k, bd['bodyName']))
                continue
            # fixed order: assigning a material can reset the appearance, so material goes before appearance, then the custom color
            for f in [x for x in ('name', 'material', 'appearance', 'customColor') if x in bd['set']]:
                v = bd['set'][f]
                if f == 'name':
                    ops.append(('bodyname', bodies, v, bd['bodyName']))
                elif f in ('material', 'appearance'):
                    cur = bodies[0].material.name if f == 'material' and bodies[0].material else (bodies[0].appearance.name if f == 'appearance' and bodies[0].appearance else None)
                    was = bd.get('was', {}).get(f)
                    if v is None:
                        note('failed', who, '%s cannot be cleared; pick another one' % f)
                        continue
                    if cur == v:
                        note('already', who, '%s is already "%s"' % (f, v))
                        continue
                    if was is not None and cur != was:
                        note('conflict', who, '%s changed in Fusion since the export (was "%s", now "%s"); skipped' % (f, was, cur))
                        continue
                    obj = lookup(app, design, f, v)
                    if obj is None:
                        note('missing', who, '%s "%s" is not in any library or the design' % (f, v))
                        continue
                    ops.append((f, bodies, obj, cur))
                elif f == 'customColor':
                    if v:
                        ops.append(('color', bodies, v, None))
        work.append((e, who, ops))

    # ---- apply (or just describe, on a dry run) ----
    for e, who, ops in work:
        for kind, targets, val, was in ops:
            label = {'rename': 'rename component', 'bodyname': 'rename body', 'material': 'set material', 'appearance': 'set appearance', 'color': 'set custom color'}[kind]
            shown = val.name if hasattr(val, 'name') and kind in ('material', 'appearance') else val
            if dry:
                note('ok', who, '%s -> "%s" (%d target%s)' % (label, shown, len(targets), '' if len(targets) == 1 else 's'))
                continue
            try:
                for t in targets:
                    if kind == 'rename':
                        if t.name != val:
                            t.name = val
                    elif kind == 'bodyname':
                        if t.name != val:
                            t.name = val
                    elif kind == 'material':
                        t.material = val
                    elif kind == 'appearance':
                        t.appearance = val
                    elif kind == 'color':
                        base = t.appearance or lookup(app, design, 'appearance', 'Surface - Matte')
                        ap = custom_appearance(design, base, val)
                        if ap is None:
                            raise RuntimeError('this appearance has no color property to change')
                        t.appearance = ap
                note('ok', who, '%s -> "%s"' % (label, shown))
            except Exception as ex:
                note('failed', who, '%s -> "%s": %s' % (label, shown, str(ex).strip().splitlines()[-1][:120]))

    # library files last: this changes the names (and occurrence paths) of linked parts everywhere the file is used
    for who, df, rs, copies in source_work:
        where = '%s/%s, v%s, %d cop%s here' % (df.parentProject.name, df.parentFolder.name, df.versionNumber, copies, 'y' if copies == 1 else 'ies')
        if dry:
            note('ok', who, 'rename library file "%s" -> "%s" (%s; also in every other design that uses it)' % (df.name, rs['to'], where))
            continue
        try:
            df.name = rs['to']
            note('ok', who, 'renamed library file to "%s" (%s)' % (rs['to'], where))
        except Exception as ex:
            note('failed', who, 'rename library file -> "%s": %s' % (rs['to'], str(ex).strip().splitlines()[-1][:120]))

    print(('DRY RUN (nothing was changed)' if dry else 'APPLIED (not saved)') + ' for "%s"' % app.activeDocument.name)
    for ln in lines:
        print(ln)
    print('SUMMARY ' + json.dumps(counts))
    if not dry:
        # edits on linked parts change the library documents themselves; list every open document with unsaved changes so the owner can save them
        try:
            unsaved = [d.name for d in app.documents if d.isModified]
            print('UNSAVED DOCUMENTS (%d): %s. Nothing was saved; the owner decides.' % (len(unsaved), ', '.join(unsaved)))
        except Exception:
            pass   # an optional report: never let it hide the apply result
