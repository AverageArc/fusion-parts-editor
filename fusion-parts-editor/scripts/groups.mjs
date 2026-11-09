// Library groups: which parts sit inside a linked library file, and under which top-level library part.
// Used by the page (inlined by build_editor.mjs, so `export` is stripped there) and by audit.mjs.
//
// A linked file such as a servo or a collar holds its own components. The export lists each of them as a part (with `viaLinked`
// naming the linked files they sit in), but to the owner the unit is the library file itself: its name, and its material.
// A "top" is a part that is linked and not inside another linked file. Its "kids" are the parts inside it, found by occurrence
// path: a kid's path starts with the top's path plus "+" (Fusion's separator between nested occurrences).
//
// libraryGroups(A) returns { topOf, kids, stats }:
//   topOf[kidId] = id of the top-level library part the kid sits under (a kid with no matching top is not listed, so it stays visible)
//   kids[topId]  = ids of the parts inside it
//   stats[topId] = { parts, bodies }  (kids and their bodies; one entry per distinct part, copies not counted)
export function libraryGroups(A) {
  const parts = A.parts || [];
  const isKid = p => !!(p.viaLinked && p.viaLinked.length);
  const topByPath = new Map();
  for (const p of parts) if (p.referenced && !isKid(p)) for (const path of p.paths || []) if (!topByPath.has(path)) topByPath.set(path, p.id);
  const topOf = {}, kids = {}, stats = {};
  for (const p of parts) {
    if (!isKid(p)) continue;
    let top = null;
    for (const path of p.paths || []) {
      const segs = path.split('+');
      for (let n = 1; n < segs.length && !top; n++) top = topByPath.get(segs.slice(0, n).join('+')) || null;   // shortest prefix that is a top-level linked occurrence
      if (top) break;
    }
    if (!top) continue;
    topOf[p.id] = top;
    (kids[top] ||= []).push(p.id);
    const s = (stats[top] ||= { parts: 0, bodies: 0 });
    s.parts++; s.bodies += (p.bodies || []).length;
  }
  return { topOf, kids, stats };
}
