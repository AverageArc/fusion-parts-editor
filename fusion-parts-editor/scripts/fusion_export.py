# Fusion 360 script: export the active assembly for the parts editor.
#
# Run it through the Fusion MCP `execute` tool (featureType "script", readOnly true).
# Before sending it, replace __PARAMS__ on the PARAMS line with a JSON object, for example:
#   {"out_dir": "C:/work/assembly-export", "quality": 1.0, "tri_cap": 30000}
# "quality" scales mesh detail (1.0 is the default: curves are cut at about 8 degrees per facet; 2 is smoother, 0.5 is lighter).
# Optional: "mesh": false skips Fusion's own meshing (use with "step": true), and "step": true also writes the design as assembly.step.
# STEP option: the 3D shapes then come from that STEP file (run step_geometry.mjs afterwards) instead of Fusion's mesh calculator.
# It writes assembly.json and meshes.json (and assembly.step) into out_dir and prints a short summary. It never changes the design.
#
# Why parts are identified by occurrence paths: Fusion's entityToken and Component.id are NOT unique in real
# assemblies (components copied from the same template, or linked from other documents, share them). The one thing
# that is always unique is Occurrence.fullPathName, so every part carries the list of its occurrence paths.
import adsk.core, adsk.fusion, json, os, time, datetime

PARAMS = json.loads(r'''__PARAMS__''')


def color_hex(appearance):
    """Best-effort base color of an appearance as #rrggbb, or None."""
    if appearance is None:
        return None
    # plastics carry their color in opaque_albedo, metals in metal_f0, clear materials in transparent_color; surface_albedo is always white
    for pid in ('opaque_albedo', 'metal_f0', 'transparent_color', 'generic_diffuse', 'surface_albedo'):
        try:
            p = appearance.appearanceProperties.itemById(pid)
            if p is not None:
                c = p.value
                return '#%02x%02x%02x' % (c.red, c.green, c.blue)
        except Exception:
            pass
    return None


def rows(m):
    return [[m.getCell(r, c) for c in range(4)] for r in range(4)]


def diag_cm(b):
    a, z = b.boundingBox.minPoint, b.boundingBox.maxPoint
    return ((z.x - a.x) ** 2 + (z.y - a.y) ** 2 + (z.z - a.z) ** 2) ** 0.5


def mesh_body(body, quality, tri_cap):
    """Tessellate one body in its own component space, with Fusion's own vertex normals.
    maxNormalDeviation (degrees) is what controls how round curves look; the surface tolerance alone barely changes the count.
    Values of 1 or less make Fusion ignore the tolerance and produce millions of triangles, so it is kept at 3 or more.
    Nodes are duplicated along face boundaries, so the normals keep hard edges hard and curved faces smooth."""
    tol = max(0.001, min(0.012, diag_cm(body) * 0.001)) / max(0.25, quality)
    dev = min(30.0, max(3.0, 8.0 / max(0.25, quality)))
    m = None
    for _ in range(5):
        mc = body.meshManager.createMeshCalculator()
        mc.surfaceTolerance = tol
        mc.maxNormalDeviation = dev
        m = mc.calculate()
        if m.triangleCount <= tri_cap or dev >= 30.0:
            break
        tol *= 1.5
        dev = min(30.0, dev * 1.5)
    nrm = [max(-127, min(127, int(round(v * 127)))) for v in m.normalVectorsAsFloat]   # unit vectors as small integers
    return [round(v * 10, 3) for v in m.nodeCoordinatesAsFloat], list(m.nodeIndices), nrm   # cm -> mm


def density_of(m):
    try:
        pr = m.materialProperties.itemById('structural_Density')
        return round(pr.value, 2) if pr is not None else None
    except Exception:
        return None


def body_record(index, body):
    ap, mat, pp = body.appearance, body.material, body.physicalProperties
    a, z = body.boundingBox.minPoint, body.boundingBox.maxPoint
    com = pp.centerOfMass          # in the component's own space; used to match this body to its solid in a STEP file
    return {'index': index, 'name': body.name, 'material': mat.name if mat else None,
            'appearance': ap.name if ap else None, 'color': color_hex(ap),
            'comMm': [round(com.x * 10, 3), round(com.y * 10, 3), round(com.z * 10, 3)],
            'massG': round(pp.mass * 1000, 3), 'volumeMm3': round(body.volume * 1000, 1),
            'bboxMm': [round(v * 10, 2) for v in (a.x, a.y, a.z, z.x, z.y, z.z)], 'hiddenInDefinition': not body.isVisible}


def source_of(o):
    """For a linked occurrence: the cloud file the component lives in (its name IS the linked component's name), or None.
    The file id has no version, so Fusion resolves it to the latest. Nested references (a link inside a linked file) raise here and give None."""
    if not o.isReferencedComponent:
        return None
    try:
        df = o.documentReference.dataFile
        return {'fileId': df.id.split('?')[0], 'file': df.name, 'version': df.versionNumber,
                'folder': df.parentFolder.name, 'project': df.parentProject.name}
    except Exception:
        return None


def via_linked(o):
    """Names of the linked components this occurrence sits inside (outermost first). A part inside a linked file is library content
    even though its own isReferencedComponent is false: editing it changes those library files."""
    names = []
    p = o.assemblyContext
    while p:
        if p.isReferencedComponent:
            names.append(p.component.name)
        p = p.assemblyContext
    return names[::-1]


def run(_context: str):
    t0 = time.time()
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    root = design.rootComponent
    quality = float(PARAMS.get('quality', 1.0))
    tri_cap = int(PARAMS.get('tri_cap', 30000))
    do_mesh = bool(PARAMS.get('mesh', True))
    do_step = bool(PARAMS.get('step', False))
    out_dir = PARAMS['out_dir']
    os.makedirs(out_dir, exist_ok=True)

    parts, instances, meshes = [], [], {}
    groups = {}

    def add_part(kind, name, referenced, path, comp_bodies, comp_obj):
        pid = 'p%d' % len(parts)
        part = {'id': pid, 'kind': kind, 'name': name, 'referenced': referenced, 'paths': [path] if path else [],
                'instances': 1, 'bodies': [body_record(i, b) for i, b in enumerate(comp_bodies)]}
        parts.append(part)
        if do_mesh:
            for i, b in enumerate(comp_bodies):
                pos, idx, nrm = mesh_body(b, quality, tri_cap)
                meshes['%s:%d' % (pid, i)] = {'pos': pos, 'idx': idx, 'nrm': nrm}
                part['bodies'][i]['triangles'] = len(idx) // 3
        return part

    # bodies that sit directly in the root component: one part each, edited by body name
    for i, body in enumerate(root.bRepBodies):
        part = add_part('root', body.name, False, '', [body], root)
        part['rootBodyIndex'] = i
        instances.append({'partId': part['id'], 'bodyIndex': 0, 'path': '', 'visible': bool(body.isVisible),
                          'matrix': [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]})

    # every occurrence, grouped into parts. Two occurrences are the same part when name, referenced-ness and bodies agree.
    worst = 0.0
    for o in root.allOccurrences:
        comp = o.component
        bodies = [b for b in comp.bRepBodies]
        src = source_of(o)
        via = via_linked(o)
        # the source file and the linked ancestors are part of the identity: two library files that hold identically named
        # and sized parts must stay two parts, and a part inside a linked file is not the same as a local copy of it
        sig = (comp.name, bool(o.isReferencedComponent), src['fileId'] if src else None, tuple(via),
               tuple((b.name, round(b.volume * 1000, 1)) for b in bodies))
        part = groups.get(sig)
        if part is None:
            part = add_part('component', comp.name, bool(o.isReferencedComponent), o.fullPathName, bodies, comp)
            if src:
                part['source'] = src
            if via:
                part['viaLinked'] = via
            groups[sig] = part
        else:
            part['paths'].append(o.fullPathName)
            part['instances'] += 1
        m = rows(o.transform2)           # transform2 is the full assembly-space transform, also for nested occurrences
        mm = [[m[r][c] * (10 if c == 3 else 1) for c in range(4)] for r in range(3)] + [[0, 0, 0, 1]]
        for i, db in enumerate(bodies):
            instances.append({'partId': part['id'], 'bodyIndex': i, 'path': o.fullPathName,
                              'visible': bool(o.isVisible and db.isVisible),
                              'matrix': [[round(v, 5) for v in row] for row in mm]})
        # spot-check the transform against the real placed geometry
        if o.bRepBodies.count and bodies:
            pb, db = o.bRepBodies.item(0), bodies[0]
            pa, pz, da, dz = pb.boundingBox.minPoint, pb.boundingBox.maxPoint, db.boundingBox.minPoint, db.boundingBox.maxPoint
            c = [(da.x + dz.x) / 2, (da.y + dz.y) / 2, (da.z + dz.z) / 2]
            w = [m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2] + m[0][3], m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2] + m[1][3], m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2] + m[2][3]]
            real = [(pa.x + pz.x) / 2, (pa.y + pz.y) / 2, (pa.z + pz.z) / 2]
            worst = max(worst, max(abs(w[i] - real[i]) for i in range(3)) * 10)

    # libraries for the dropdowns
    mats, apps, seen_m, seen_a = [], [], set(), set()
    for lib in app.materialLibraries:
        for m in lib.materials:
            if m.name not in seen_m:
                seen_m.add(m.name)
                mats.append({'name': m.name, 'density': density_of(m)})
        for a in lib.appearances:
            if a.name not in seen_a:
                seen_a.add(a.name)
                apps.append({'name': a.name, 'color': color_hex(a)})
    for a in design.appearances:
        if a.name not in seen_a:
            seen_a.add(a.name)
            apps.append({'name': a.name, 'color': color_hex(a)})
    for m in design.materials:
        if m.name not in seen_m:
            seen_m.add(m.name)
            mats.append({'name': m.name, 'density': density_of(m)})

    try:
        up = str(app.preferences.generalPreferences.defaultModelingOrientation)
        up_axis = 'Y' if 'Y' in up.split('.')[-1] else 'Z'
    except Exception:
        up_axis = 'Z'
    doc = app.activeDocument
    step_path = None
    if do_step:
        step_path = os.path.join(out_dir, 'assembly.step')
        em = design.exportManager
        em.execute(em.createSTEPExportOptions(step_path, design.rootComponent))   # a file write; the design is not changed
    meta = {'format': 'fusion-assembly-export/2', 'document': {'name': doc.name}, 'geometry': 'mesh' if do_mesh else 'pending-step', 'stepFile': 'assembly.step' if step_path else None,
            'exportedAt': datetime.datetime.now().isoformat(timespec='seconds'), 'units': 'mm', 'upAxis': up_axis,
            'transformMaxErrorMm': round(worst, 4), 'parts': parts, 'instances': instances,
            'libraries': {'materials': mats, 'appearances': apps}}
    with open(os.path.join(out_dir, 'assembly.json'), 'w') as f:
        json.dump(meta, f)
    with open(os.path.join(out_dir, 'meshes.json'), 'w') as f:
        json.dump(meshes, f)
    tris = sum(len(v['idx']) // 3 for v in meshes.values())
    nb = sum(len(p['bodies']) for p in parts)
    linked = sum(1 for p in parts if p['referenced'])
    with_src = sum(1 for p in parts if p.get('source'))
    print('exported "%s": %d parts (%d linked), %d bodies, %d instances, %d triangles, %.1fs' % (doc.name, len(parts), linked, nb, len(instances), tris, time.time() - t0))
    print('placement check: worst error %.4f mm | up axis %s | %d materials, %d appearances' % (worst, up_axis, len(mats), len(apps)))
    if linked:
        print('linked parts: %d, of which %d have a known source file (the rest are links inside linked files)' % (linked, with_src))
    if step_path:
        print('STEP file: %s (%.1f MB)%s' % (step_path, os.path.getsize(step_path) / 1e6, '' if do_mesh else ' | no Fusion meshes written: run step_geometry.mjs to build the shapes from it'))
