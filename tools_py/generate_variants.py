"""Community "rework" importer: adds alternative look-sets to EXISTING creatures,
switched at runtime by the in-game menu (game/variants.js).

Python port of tools/generate_variants.js (faithful translation).

For each species it appends, to the generated client entity:
  - geometry array  (Array.geos indexed by pcraftrevorn:set)
  - texture array   (base skins + each set's skins, indexed by pcraftrevorn:skin)
  - set-specific idle/walk animations (gated by pcraftrevorn:set)
and widens the BP entity's skin range + adds the pcraftrevorn:set property.
Writes behavior_pack/scripts/pcraftrevorn/data/variants.js for the scripts.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import ROOT, NS, ensure_dir, write_text, write_json, read_json, exists, rmrf, copy  # noqa: E402,F401

COMM = ROOT / ".work" / "community"
BP = ROOT / "behavior_pack"
RP = ROOT / "resource_pack"

LOOP_ANIMS = {"idle", "walk", "sprint", "hidden"}

_VALID_SEG = re.compile(r"^[A-Za-z][A-Za-z0-9_.]*$")
_VALID_BONE = re.compile(r"^[A-Za-z][A-Za-z0-9_.]*$")
_BAD_BONE_CHARS = re.compile(r"[^A-Za-z0-9_.]")
_BONE_BASE_START = re.compile(r"^[A-Za-z_]")


def valid_seg(s) -> bool:
    return bool(_VALID_SEG.match(s))


def convert_anim_object(j):
    def unwrap(v):
        if v and isinstance(v, dict):
            if isinstance(v.get("vector"), list):
                return v["vector"]
            if "pre" in v or "post" in v or "lerp_mode" in v:
                o = {}
                if "pre" in v:
                    pre = v["pre"]
                    o["pre"] = pre["vector"] if (pre and isinstance(pre, dict) and isinstance(pre.get("vector"), list)) else pre
                if "post" in v:
                    post = v["post"]
                    o["post"] = post["vector"] if (post and isinstance(post, dict) and isinstance(post.get("vector"), list)) else post
                if "lerp_mode" in v:
                    o["lerp_mode"] = v["lerp_mode"]
                return o
        return v

    def convert_channel(ch):
        if ch is None or not isinstance(ch, dict):
            return ch
        if isinstance(ch.get("vector"), list):
            return ch["vector"]
        out = {}
        for t, v in ch.items():
            out[t] = unwrap(v)
        return out

    j.pop("geckolib_format_version", None)
    for name, anim in (j.get("animations") or {}).items():
        declared = anim.get("loop")
        if declared is True or declared is False or declared == "hold_on_last_frame":
            anim["loop"] = declared
        else:
            anim["loop"] = name.split(".")[-1] in LOOP_ANIMS
        for bd in (anim.get("bones") or {}).values():
            for ch in ("rotation", "position", "scale"):
                if ch in bd:
                    bd[ch] = convert_channel(bd[ch])
    return j


# parse a rework texture basename into its variant/gender/counter/wg/belly state
def parse_tex(name):
    n = name
    belly = 0
    wg = 0
    counter = 0
    gender = "-"
    variant = 0
    if re.search(r"_belly$", n):
        belly = 1
        n = re.sub(r"_belly$", "", n)
    if re.search(r"_wg2$", n):
        wg = 2
        n = re.sub(r"_wg2$", "", n)
    elif re.search(r"_wg$", n):
        wg = 1
        n = re.sub(r"_wg$", "", n)
    m = re.search(r"_(decor|health|scale|armor)(\d+)$", n)
    if m:
        counter = int(m.group(2))
        n = n[: m.start()]
    m = re.search(r"_(male|female)(\d+)$", n)
    if m:
        gender = 1 if m.group(1) == "male" else 0
        variant = int(m.group(2))
    else:
        m = re.search(r"(\d+)$", n)
        if m:
            variant = int(m.group(1))
    return {"variant": variant, "gender": gender, "counter": counter, "wg": wg, "belly": belly}


def state_key(t) -> str:
    return f"{t['variant']}|{t['gender']}|{t['counter']}|{t['wg']}|{t['belly']}"


# rename Bedrock-illegal bone names identically in geo + anim (see generate_community)
def sanitize_bones(geo, anim) -> None:
    g = geo["minecraft:geometry"][0]
    gb = g.get("bones") or []
    names = []
    seen = set()
    for b in gb:
        nm = b.get("name")
        if nm not in seen:
            seen.add(nm)
            names.append(nm)
    anims = (anim or {}).get("animations") or {}
    for a in anims.values():
        for k in (a.get("bones") or {}).keys():
            if k not in seen:
                seen.add(k)
                names.append(k)
    used = {n for n in names if _VALID_BONE.match(n)}
    mapping = {}
    for n in names:
        if _VALID_BONE.match(n):
            continue
        base = _BAD_BONE_CHARS.sub("_", str(n))
        if not _BONE_BASE_START.match(base):
            base = "_" + base
        cand = base
        i = 1
        while cand in used and cand != n:
            cand = f"{base}_{i}"
            i += 1
        used.add(cand)
        mapping[n] = cand
    if not mapping:
        return
    for b in gb:
        if b.get("name") in mapping:
            b["name"] = mapping[b["name"]]
        if b.get("parent") and b["parent"] in mapping:
            b["parent"] = mapping[b["parent"]]
    for a in anims.values():
        nb = {}
        for k, v in (a.get("bones") or {}).items():
            nb[mapping.get(k, k)] = v
        a["bones"] = nb


SPECIES = [
    {"species": "zombie", "baseGeo": "zombiegirl", "sets": [
        {"id": "bibaso", "pack": "bibaso", "geo": "zombiegirl", "anim": "zombiegirl", "tex": re.compile(r"^zombie"), "prefix": "pcv_bibaso_", "name": "Bibaso"}
    ]},
    {"species": "piglin_royal", "baseGeo": "piglin_royalty", "sets": [
        {"id": "royalrump", "pack": "v_royalrump", "geo": "piglin_royalty", "anim": "piglin_royalty", "tex": re.compile(r"^piglin_royal_"), "prefix": "pcv_royalrump_", "name": "Royal Rump"}
    ]},
    {"species": "silverfish", "baseGeo": "silverfish", "sets": [
        {"id": "silverfishrework", "pack": "v_silverfish", "geo": "silverfish", "anim": "silverfish", "tex": re.compile(r"^silverfish_"), "prefix": "pcv_silverfish_", "name": "Silverfish 重绘"}
    ]},
    {"species": "scarecrow", "baseGeo": "scarecrow", "sets": [
        {"id": "scarecrowtaste", "pack": "v_scarecrowtaste", "geo": "scarecrow", "anim": None, "tex": re.compile(r"^scarecrow_"), "prefix": "pcv_scarecrow_", "name": "TasteTested"}
    ]}
]


def generate_variants() -> None:
    reg = {}
    read_json(RP / "textures" / "item_texture.json")  # noqa: F841 (read for parity with the JS tool)
    for sp in SPECIES:
        ent_path = RP / "entity" / (sp["species"] + ".entity.json")
        rc_path = RP / "render_controllers" / (sp["species"] + ".render_controllers.json")
        bp_path = BP / "entities" / (sp["species"] + ".json")
        if not (exists(ent_path) and exists(rc_path) and exists(bp_path)):
            print(f"skip variant {sp['species']}: base files missing", file=sys.stderr)
            continue
        ent = read_json(ent_path)
        rc = read_json(rc_path)
        bp = read_json(bp_path)
        desc = ent["minecraft:client_entity"]["description"]
        rc_name = desc["render_controllers"][0]
        rc_def = rc["render_controllers"][rc_name]
        # index base must be the render-controller skin-array length, NOT the texture-key
        # count (entities with a glow layer have an extra non-skin texture key).
        base_count = len(rc_def["arrays"]["textures"]["Array.skins"])
        all_have_anim = all(s["anim"] for s in sp["sets"])

        offset = base_count
        sets = []
        # geometry array entries must reference the client-entity geometry map
        # (Geometry.<key>), not raw identifiers, or Bedrock renders nothing.
        geo_array = ["Geometry.default"]
        skins_array = list(rc_def["arrays"]["textures"]["Array.skins"])
        for s in sp["sets"]:
            root = COMM / s["pack"] / "assets" / "pcraftrevorn"
            # geo
            # geo + anim (sanitize illegal bone names consistently across both)
            geo = read_json(root / "geo" / (s["geo"] + ".geo.json"))
            anim = convert_anim_object(read_json(root / "animations" / (s["anim"] + ".animation.json"))) if s["anim"] else None
            sanitize_bones(geo, anim)  # always: a set with no animation can still carry illegal bone names (e.g. scarecrow "Head-neck")
            geo["minecraft:geometry"][0]["description"]["identifier"] = f"geometry.{sp['species']}.v_{s['id']}"
            write_json(RP / "models" / "entity" / f"{sp['species']}.v_{s['id']}.geo.json", geo)
            desc["geometry"][f"v_{s['id']}"] = f"geometry.{sp['species']}.v_{s['id']}"
            geo_array.append(f"Geometry.v_{s['id']}")
            # anim
            idle_key = None
            walk_key = None
            if anim:
                renamed = {}
                for k, v in (anim.get("animations") or {}).items():
                    short = k.split(".")[-1]
                    if not valid_seg(short):
                        continue
                    renamed[f"animation.{sp['species']}.v_{s['id']}.{short}"] = v
                    if short == "idle":
                        idle_key = f"{s['id']}_idle"
                    if short == "walk":
                        walk_key = f"{s['id']}_walk"
                anim["animations"] = renamed
                write_json(RP / "animations" / f"{sp['species']}.v_{s['id']}.animation.json", anim)
                if idle_key:
                    desc["animations"][idle_key] = f"animation.{sp['species']}.v_{s['id']}.idle"
                if walk_key:
                    desc["animations"][walk_key] = f"animation.{sp['species']}.v_{s['id']}.walk"
            # textures
            tex_dir = root / "textures" / "entities"
            by_state = {}
            names = [f for f in os.listdir(tex_dir) if f.endswith(".png") and s["tex"].match(f[:-4])]
            names.sort()
            for f in names:
                base = f[:-4]
                nn = s["prefix"] + base
                copy(tex_dir / f, RP / "textures" / "entity" / "pcraftrevorn" / (nn + ".png"))
                key = "skin" + str(offset)
                desc["textures"][key] = f"textures/entity/pcraftrevorn/{nn}"
                skins_array.append(f"Texture.{key}")
                by_state[state_key(parse_tex(base))] = offset
                offset += 1
            sets.append({"id": s["id"], "name": s["name"], "geoId": f"geometry.{sp['species']}.v_{s['id']}", "byState": by_state, "idleKey": idle_key, "walkKey": walk_key, "count": len(names)})
        # render controller
        rc_def["arrays"]["textures"]["Array.skins"] = skins_array
        rc_def["arrays"]["geometries"] = {"Array.geos": geo_array}
        # point every controller in this file (incl. glow layers) at the set-selected
        # geometry, and give each one its own Array.geos definition.
        for d in rc["render_controllers"].values():
            arr = dict(d.get("arrays") or {})
            arr["geometries"] = {"Array.geos": geo_array}
            d["arrays"] = arr
            if d.get("geometry") == "Geometry.default":
                d["geometry"] = f"Array.geos[q.property('{NS}:set')]"
        # scripts.animate gating
        if all_have_anim:
            desc["scripts"]["animate"] = [
                {"idle": f"q.property('{NS}:set') == 0 ? (1.0 - math.min(1.0, query.modified_move_speed * 4.0)) : 0.0"},
                {"walk": f"q.property('{NS}:set') == 0 ? math.min(1.0, query.modified_move_speed * 4.0) : 0.0"},
            ]
            for i in range(len(sets)):
                if sets[i]["idleKey"]:
                    desc["scripts"]["animate"].append({sets[i]["idleKey"]: f"q.property('{NS}:set') == {i + 1} ? (1.0 - math.min(1.0, query.modified_move_speed * 4.0)) : 0.0"})
                if sets[i]["walkKey"]:
                    desc["scripts"]["animate"].append({sets[i]["walkKey"]: f"q.property('{NS}:set') == {i + 1} ? math.min(1.0, query.modified_move_speed * 4.0) : 0.0"})
        write_json(ent_path, ent)
        write_json(rc_path, rc)
        # BP entity: add set property + widen skin range
        bp["minecraft:entity"]["description"]["properties"][f"{NS}:set"] = {"type": "int", "range": [0, len(sets)], "default": 0, "client_sync": True}
        bp["minecraft:entity"]["description"]["properties"][f"{NS}:skin"]["range"] = [0, max(1, offset - 1)]
        write_json(bp_path, bp)

        reg[sp["species"]] = {"baseCount": base_count, "total": offset, "sets": sets}
    js = (
        "// AUTO-GENERATED by tools/generate_variants.js. Per-species rework look-sets.\n"
        + "export const VARIANTS = " + json.dumps(reg, indent=2, ensure_ascii=False) + ";\n"
    )
    write_text(BP / "scripts" / "pcraftrevorn" / "data" / "variants.js", js)
    print("Variant sets generated: " + ", ".join(f"{k}({len(v['sets'])})" for k, v in reg.items()))


if __name__ == "__main__":
    generate_variants()
