# Fusion 360 script: list the design files in one folder, so a whole library can be renamed in one pass ("library mode"). Read-only.
#
# Run it through the Fusion MCP `execute` tool (featureType "script", readOnly true). Replace __PARAMS__ with JSON:
#   {"out_dir": "C:/work/library-export", "from_document": "M3-Washer", "recurse": false}
#   "from_document"  the name of an open document: lists the folder that holds it. The easiest way to name a folder, nested or not.
#   "project"  project name (exact). Omit to use the project of the active document.
#   "folder"   folder path inside that project (exact names, "Parts/FASTENERS"), or "@active" for the active document's folder. Omit for the top folder.
#   "recurse"  true to include subfolders.
# It writes assembly.json (no meshes, no bodies: files are listed, not opened) in the same shape as an assembly export, so the same
# page, ledger, expand and verify tools work. Every file becomes a "part" with a `source`, and the page lets you type a new name for it:
# each rename is a library-file row (renames the file in the cloud, in every design that uses it). It does not open any file, and it
# never changes anything. The apply script handles these answers when they carry "mode": "library" (no open design needed).
import adsk.core, json, os, datetime

PARAMS = json.loads(r'''__PARAMS__''')


# Use asArray(): reading a folder one item(i) at a time makes one slow cloud request per item and times the tool out (136 files: seconds with
# asArray, minutes with item(i)).
def find_folder(root, path):
    cur = root
    for name in [p for p in path.replace('\\', '/').split('/') if p]:
        nxt = None
        for f in cur.dataFolders.asArray():
            if f.name == name:
                nxt = f
                break
        if nxt is None:
            raise RuntimeError('folder "%s" not found under "%s"' % (name, cur.name))
        cur = nxt
    return cur


def collect(folder, recurse, out):
    out.extend(folder.dataFiles.asArray())
    if recurse:
        for f in folder.dataFolders.asArray():
            collect(f, recurse, out)


def run(_context: str):
    t0 = datetime.datetime.now()
    app = adsk.core.Application.get()
    out_dir = PARAMS['out_dir']
    os.makedirs(out_dir, exist_ok=True)
    pname = PARAMS.get('project')
    project = None
    if pname:
        for pr in app.data.dataProjects.asArray():
            if pr.name == pname:
                project = pr
                break
        if project is None:
            raise RuntimeError('project "%s" not found' % pname)
    else:
        project = app.activeDocument.dataFile.parentProject
    start = project.rootFolder
    fpath = PARAMS.get('folder') or ''
    if PARAMS.get('from_document'):
        # the folder that holds an open document, named here: no path to type, and it also finds folders nested deep in the project
        hit = [d for d in app.documents if d.name == PARAMS['from_document']]
        if len(hit) != 1:
            raise RuntimeError('"from_document" must name exactly one open document (found %d named "%s")' % (len(hit), PARAMS['from_document']))
        folder = hit[0].dataFile.parentFolder
        project = hit[0].dataFile.parentProject
    elif fpath == '@active':
        folder = app.activeDocument.dataFile.parentFolder
    else:
        folder = find_folder(start, fpath)
    files = []
    collect(folder, bool(PARAMS.get('recurse', False)), files)
    # only Fusion designs: other file types (drawings, images) are not parts
    files = [f for f in files if (f.fileExtension or '').lower() == 'f3d']
    files.sort(key=lambda f: f.name.lower())
    parts = []
    for df in files:
        fid = df.id.split('?')[0]
        parts.append({'id': 'p%d' % len(parts), 'kind': 'component', 'name': df.name, 'referenced': True, 'paths': [], 'instances': 1, 'bodies': [],
                      'source': {'fileId': fid, 'file': df.name, 'version': df.versionNumber, 'folder': df.parentFolder.name, 'project': df.parentProject.name,
                                 'modified': str(getattr(df, 'dateModified', '') or '')}})
    label = 'Library: %s / %s' % (project.name, folder.name)
    meta = {'format': 'fusion-assembly-export/2', 'mode': 'library', 'document': {'name': label}, 'geometry': 'mesh', 'stepFile': None,
            'exportedAt': datetime.datetime.now().isoformat(timespec='seconds'), 'units': 'mm', 'upAxis': 'Z', 'transformMaxErrorMm': 0,
            'parts': parts, 'instances': [], 'libraries': {'materials': [], 'appearances': []}}
    with open(os.path.join(out_dir, 'assembly.json'), 'w') as f:
        json.dump(meta, f)
    with open(os.path.join(out_dir, 'meshes.json'), 'w') as f:
        json.dump({}, f)
    print('listed "%s": %d design files (not opened) in %.1fs' % (label, len(parts), (datetime.datetime.now() - t0).total_seconds()))
