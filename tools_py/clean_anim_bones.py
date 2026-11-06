"""Drop animation bone channels that no geometry of their entity can use.

The port copies geometry and animation 1:1 from the original packs, so no bone
was lost in porting (verified: every generated bone set equals its source).
What remains are over-broad channels the original authors left behind - bones
that exist on other models of the same rig but not on this one.

For every animation we build the union of bones from all geometries of every
entity that references it, then remove the channels outside that union. A shared
animation keeps every bone at least one user actually has.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RP = ROOT / "resource_pack"
ENT = RP / "entity"
GEO = RP / "models/entity"
ANIM = RP / "animations"


def load(p):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


geo_bones = {}
for p in GEO.glob("*.geo.json"):
    d = load(p)
    if not d:
        continue
    for g in d.get("minecraft:geometry", []):
        ident = (g.get("description") or {}).get("identifier")
        if ident:
            geo_bones[ident] = {b.get("name") for b in g.get("bones", []) if b.get("name")}

# animation id -> entities that use it
anim_users = {}
for p in ENT.glob("*.entity.json"):
    d = load(p)
    if not d:
        continue
    desc = d.get("minecraft:client_entity", {}).get("description", {})
    ent = desc.get("identifier")
    geos = desc.get("geometry") or {}
    ids = []
    for v in geos.values():
        if isinstance(v, str):
            ids.append(v)
        elif isinstance(v, list):
            ids.extend(x for x in v if isinstance(x, str))
    bones = set()
    for gid in ids:
        bones |= geo_bones.get(gid, set())
    for anim in (desc.get("animations") or {}).values():
        if isinstance(anim, str) and anim.startswith("animation."):
            anim_users.setdefault(anim, {})[ent] = bones

removed_total = 0
changed_files = 0
for p in sorted(ANIM.glob("*.animation.json")):
    d = load(p)
    if not d:
        continue
    changed = False
    for name, a in (d.get("animations") or {}).items():
        users = anim_users.get(name)
        if not users:
            continue
        allowed = set()
        for bones in users.values():
            allowed |= bones
        if not allowed:
            continue
        ch = a.get("bones") or {}
        dead = [b for b in ch if b not in allowed]
        if dead:
            for b in dead:
                del ch[b]
            removed_total += len(dead)
            changed = True
    if changed:
        p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        changed_files += 1

print(f"[anim] removed {removed_total} dead bone channels from {changed_files} files")
