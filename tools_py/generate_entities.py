"""
PCraftRevorn -> Bedrock Phase 2: entities (Python port of tools/generate_entities.js).

Reads the extracted original mod (.work/mod) and generates:
  resource_pack/models/entity/*.geo.json        (copied, GeckoLib geo == Bedrock geo)
  resource_pack/animations/*.animation.json     (copied, GeckoLib anim == Bedrock anim)
  resource_pack/textures/entity/pcraftrevorn/*  (copied)
  resource_pack/entity/*.entity.json            (client entities + skin arrays)
  resource_pack/render_controllers/*.json       (skin selection via pc:skin property)
  resource_pack/animation_controllers/*.json    (idle/walk)
  behavior_pack/entities/*.json                 (behaviors + entity properties)
  behavior_pack/spawn_rules/*.json              (from forge biome modifiers)

Run after tools/extract.ps1:  python tools_py/generate_entities.py
"""
from __future__ import annotations

import json
import os
import re
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    ROOT,
    NS,
    ensure_dir,
    write_text,
    write_json,
    read_json,
    exists,
    rmrf,
    copy,
)

# Sibling ports. They may not be present yet; keep this module importable
# regardless, but call them from main() when available. Accept either the
# camelCase names from the JS pipeline description or the snake_case names
# used by the sibling Python ports.
try:  # pragma: no cover - depends on parallel ports existing
    from generate_community import generateCommunity
except Exception:  # noqa: BLE001
    try:
        from generate_community import generate_community as generateCommunity
    except Exception:  # noqa: BLE001
        generateCommunity = None

# shared PNG helpers (a superset of this module's own: they also read palette PNGs)
from generate_community import decode_png_rgba, write_png  # noqa: E402

try:  # pragma: no cover - depends on parallel ports existing
    from generate_variants import generateVariants
except Exception:  # noqa: BLE001
    try:
        from generate_variants import generate_variants as generateVariants
    except Exception:  # noqa: BLE001
        generateVariants = None

# VCM (Internalised) import - merged into the PCraftRevorn packs.
try:  # pragma: no cover - depends on the extracted jar assets
    from generate_vcm import generate_vcm as generateVcm
except Exception:  # noqa: BLE001
    generateVcm = None

MOD = ROOT / ".work" / "mod"
SRC_GEO = MOD / "assets" / "pcraftrevorn" / "geo"
SRC_ANIM = MOD / "assets" / "pcraftrevorn" / "animations"
SRC_TEX = MOD / "assets" / "pcraftrevorn" / "textures" / "entities"
BP = ROOT / "behavior_pack"
RP = ROOT / "resource_pack"


# ---- minimal png writer (transparent placeholder icon) ----
def _crc_table():
    t = []
    for n in range(256):
        c = n
        for _ in range(8):
            c = (0xEDB88320 ^ (c >> 1)) if (c & 1) else (c >> 1)
        t.append(c & 0xFFFFFFFF)
    return t


CRC = _crc_table()


def crc32(b):
    c = 0xFFFFFFFF
    for x in b:
        c = CRC[(c ^ x) & 0xFF] ^ (c >> 8)
    return (c ^ 0xFFFFFFFF) & 0xFFFFFFFF


def chunk(t, d):
    l = struct.pack(">I", len(d))
    b = t.encode("ascii") + d
    c = struct.pack(">I", crc32(b))
    return l + b + c


def writePng(f, w, h, rgba):
    sig = bytes([137, 80, 78, 71, 13, 10, 26, 10])
    ih = bytearray(13)
    struct.pack_into(">I", ih, 0, w)
    struct.pack_into(">I", ih, 4, h)
    ih[8] = 8
    ih[9] = 6
    stride = w * 4
    raw = bytearray((stride + 1) * h)
    for y in range(h):
        start = y * (stride + 1) + 1
        raw[start:start + stride] = rgba[y * stride:y * stride + stride]
    data = (sig + chunk("IHDR", bytes(ih))
            + chunk("IDAT", zlib.compress(bytes(raw)))
            + chunk("IEND", b""))
    p = Path(f)
    ensure_dir(p.parent)
    p.write_bytes(data)


# ---- entity table ----
# skins: regex applied to texture basenames (without extension)
ENTITIES = [
    {"id": "basaltmite", "geo": "basaltmite", "anim": "basaltmite", "skins": re.compile(r"^basaltmite_", re.ASCII), "kind": "monster", "hp": 40, "speed": 0.18, "dmg": 3, "follow": 16, "kbr": 0.4, "size": [0.6, 1.8], "hostile": True, "families": ["basaltmite", "predator", "monster", "arthropod"], "pop": "monster"},
    {"id": "gilded_basaltmite", "geo": "basaltmite", "anim": "basaltmite", "skins": re.compile(r"^gilded_basaltmite_", re.ASCII), "kind": "monster", "hp": 70, "speed": 0.21, "dmg": 3, "follow": 16, "kbr": 0.6, "size": [0.6, 1.8], "hostile": True, "families": ["basaltmite", "gilded_basaltmite", "predator", "monster", "arthropod"], "pop": "monster"},
    {"id": "silverfish", "geo": "silverfish", "anim": "silverfish", "skins": re.compile(r"^silverfish_", re.ASCII), "kind": "monster", "hp": 12, "speed": 0.3, "dmg": 4, "follow": 16, "kbr": 0.4, "size": [0.6, 1.8], "hostile": True, "families": ["silverfish", "predator", "monster", "arthropod"], "pop": "monster"},
    {"id": "vinemaiden", "geo": "vinemaiden", "anim": "vinemaiden", "skins": re.compile(r"^vinemaiden(\d|_buried)", re.ASCII), "kind": "creature", "hp": 30, "speed": 0.3, "dmg": 5, "follow": 12, "kbr": 0, "size": [0.7, 1.9], "hostile": True, "families": ["vinemaiden", "predator", "monster"], "pop": "monster"},
    {"id": "vinemaiden_seedling", "geo": "vinemaiden_seedling", "anim": "vinemaiden_seedling", "skins": re.compile(r"^vinemaiden_seedling", re.ASCII), "kind": "creature", "hp": 8, "speed": 0.3, "dmg": 3, "follow": 16, "kbr": 0, "size": [0.6, 1.8], "hostile": False, "families": ["vinemaiden", "monster"], "pop": "monster"},
    {"id": "zombie", "geo": "zombiegirl", "anim": "zombiegirl", "skins": re.compile(r"^zombie(\d|_girl)", re.ASCII), "kind": "monster", "hp": 20, "speed": 0.23, "dmg": 3, "follow": 35, "kbr": 0, "size": [0.6, 1.8], "hostile": True, "families": ["zombie", "predator", "undead", "monster"], "pop": "monster", "loot": "zombie"},
    {"id": "scarecrow", "geo": "scarecrow", "anim": "scarecrow", "skins": re.compile(r"^scarecrow_(?!glow)", re.ASCII), "kind": "monster", "hp": 50, "speed": 0.3, "dmg": 3, "follow": 64, "kbr": 0, "size": [0.8, 2.4], "hostile": True, "families": ["scarecrow", "predator", "monster"], "pop": "monster"},
    {"id": "rabbit_wizard", "geo": "rabbit", "anim": "rabbit", "skins": re.compile(r"^rabbit\d", re.ASCII), "kind": "creature", "hp": 24, "speed": 0.25, "dmg": 3, "follow": 16, "kbr": 0, "size": [0.6, 1.8], "hostile": True, "families": ["rabbit_wizard", "predator", "village_protector"], "pop": "animal"},
    {"id": "piglin_royal", "geo": "piglin_royalty", "anim": "piglin_royalty", "skins": re.compile(r"^piglin_royal_(?!knight)", re.ASCII), "kind": "monster", "hp": 150, "speed": 0.3, "dmg": 3, "follow": 16, "kbr": 1, "size": [1.5, 3.4], "hostile": False, "families": ["piglin", "piglin_royal", "monster"], "pop": "monster", "loot": "piglin_royal"},
    {"id": "piglin_royal_knight", "geo": "piglin_royal_knight", "anim": "piglin_royal_knight", "skins": re.compile(r"^piglin_royal_knight_", re.ASCII), "kind": "monster", "hp": 32, "speed": 0.32, "dmg": 5, "follow": 16, "kbr": 0, "size": [0.6, 1.8], "hostile": True, "families": ["piglin", "piglin_royal_knight", "predator", "monster"], "pop": "monster"},
    {"id": "binding_ring", "geo": "binding_ring", "anim": "binding_ring", "skins": re.compile(r"^binding_ring$", re.ASCII), "kind": "monster", "hp": 10, "speed": 0.6, "dmg": 3, "follow": 16, "kbr": 0.35, "size": [0.6, 1.8], "hostile": False, "families": ["binding_ring", "accessory"], "pop": "monster"},
    {"id": "shielding_ring", "geo": "shielding_ring", "anim": "shielding_ring", "skins": re.compile(r"^shielding_ring$", re.ASCII), "kind": "monster", "hp": 20, "speed": 0.45, "dmg": 3, "follow": 16, "kbr": 2, "size": [0.6, 1.8], "hostile": False, "families": ["shielding_ring", "accessory"], "pop": "monster"},
]
SPECIAL = [
    {"id": "piglin_royal_spawner", "hp": 10, "size": [0, 0], "families": ["piglin_royal_spawner", "spawner"]},
    {"id": "piglin_throneroom_spawner", "hp": 10, "size": [0, 0], "families": ["piglin_throneroom_spawner", "spawner"]},
    {"id": "rabbit_player_projectile", "projectile": True, "families": ["projectile"]},
    {"id": "rabbit_projectile_bloodlust", "projectile": True, "families": ["projectile"]},
    {"id": "digestion_bar", "boss": True, "hp": 100, "size": [0, 0], "families": ["digestion_bar"]},
    # invisible stash that holds digested players' belongings until the predator dies
    {"id": "belly_storage", "container": True, "hp": 100, "size": [0, 0], "families": ["belly_storage"]},
]
INVISIBLE_GEO = "geometry.pcraftrevorn.invisible"
INVISIBLE_TEX = "textures/entity/pcraftrevorn/invisible"
# preds that can be tamed (pcraftrevorn:tameable_preds tag)
TAMEABLE = {"gilded_basaltmite", "piglin_royal_knight", "rabbit_wizard"}
# Right-click "bribe" per species. Those are the only taming routes: the cupid's
# arrow was removed (Bedrock bows cannot fire custom ammo).
TAME_ITEMS = {
    "gilded_basaltmite": ["minecraft:golden_apple"],
    "piglin_royal_knight": [NS + ":piglin_royal_talisman"],
    "rabbit_wizard": ["minecraft:golden_carrot"],
}
# entities that ship a spawn egg item
SPAWN_EGG = {"zombie", "piglin_royal", "vinemaiden", "piglin_royal_knight", "silverfish", "basaltmite", "rabbit_wizard", "gilded_basaltmite", "scarecrow"}
# entities with a separate emissive glow texture (drawn as a 2nd render controller)
GLOW = {"binding_ring": "binding_ring_glow", "shielding_ring": "shielding_ring_glow", "scarecrow": "scarecrow_glow"}
# Per-predator target lists, taken from the original entity goals
# (net/mcreator/pcraftrevorn/entity/*Entity.java -> NearestAttackableTargetGoal).
# Anything not listed keeps the port default (players + villagers).
TARGETS = {
    # magma cubes only
    "basaltmite": ["magma_cube"],
    "gilded_basaltmite": ["magma_cube"],
    # cow, sheep, pig, goat, wolf, (mod) zombie, pillager, vindicator + player
    "vinemaiden": ["cow", "sheep", "pig", "goat", "wolf", "zombie", "pillager", "vindicator", "player"],
    "zombie": ["villager", "player"],
    "silverfish": ["player", "villager", "pillager", "vindicator", "witch"],
    "scarecrow": ["monster"],
    "rabbit_wizard": ["monster", "player"],
    "piglin_royal_knight": ["monster", "player"],
}
# temporary/loop animations (short name): only these loop, the rest play once
LOOP_ANIMS = {"idle", "walk", "sprint", "hidden"}


# ---- helpers ----
def texFiles():
    return [f[:-4] for f in sorted(os.listdir(SRC_TEX)) if f.endswith(".png")]


# Resolve geometry/animation sources from the generated RP when present, so
# entities whose files are renamed/derived (e.g. variant look-sets) work too.
def geoIdent(file):
    if file == "vinemaiden_seedling":
        return "geometry.vinemaiden_seedling"
    rp = RP / "models" / "entity" / (file + ".geo.json")
    j = read_json(rp if exists(rp) else SRC_GEO / (file + ".geo.json"))
    return j["minecraft:geometry"][0]["description"]["identifier"]


def animNames(file):
    rp = RP / "animations" / (file + ".animation.json")
    j = read_json(rp if exists(rp) else SRC_ANIM / (file + ".animation.json"))
    return list(j["animations"].keys())


allTex = texFiles()


# Output texture basenames for an entity (applies an optional rename prefix).
def skinsFor(e):
    out = [n for n in allTex if e["skins"].search(n)]
    out.sort()
    if e.get("texPrefix"):
        out = [e["texPrefix"] + n for n in out]
    return out


def _unwrap_vector(val):
    # (v.pre && Array.isArray(v.pre.vector)) ? v.pre.vector : v.pre
    if val and isinstance(val, dict) and isinstance(val.get("vector"), list):
        return val["vector"]
    return val


# Convert a GeckoLib animation JSON to Bedrock: unwrap {vector:...} keyframes,
# keep {pre,post,lerp_mode}, drop the GeckoLib root field and add loop flags.
# GeckoLib/Blockbench sometimes export a whole channel as an easing marker,
# e.g. "rotation": ["easeInOutSine", ...]. Bedrock parses that as Molang and
# logs "unknown token"; the channel carries no numeric data, so zero it.
EASING_NAMES = {n.lower() for n in (
    "linear", "step", "catmullrom", "auto", "smooth",
    "easeInSine", "easeOutSine", "easeInOutSine",
    "easeInQuad", "easeOutQuad", "easeInOutQuad",
    "easeInCubic", "easeOutCubic", "easeInOutCubic",
    "easeInQuart", "easeOutQuart", "easeInOutQuart",
    "easeInQuint", "easeOutQuint", "easeInOutQuint",
    "easeInExpo", "easeOutExpo", "easeInOutExpo",
    "easeInCirc", "easeOutCirc", "easeInOutCirc",
    "easeInBack", "easeOutBack", "easeInOutBack",
    "easeInElastic", "easeOutElastic", "easeInOutElastic",
    "easeInBounce", "easeOutBounce", "easeInOutBounce",
)}


def _easing_channel(v) -> bool:
    return (isinstance(v, list) and bool(v)
            and all(isinstance(x, str) and x.lower() in EASING_NAMES for x in v))


def convertAnimObject(j):
    def unwrap(v):
        if v is not None and isinstance(v, dict) and not isinstance(v, list):
            if isinstance(v.get("vector"), list):
                return v["vector"]
            if ("pre" in v) or ("post" in v) or ("lerp_mode" in v):
                o = {}
                if "pre" in v:
                    o["pre"] = _unwrap_vector(v["pre"])
                if "post" in v:
                    o["post"] = _unwrap_vector(v["post"])
                if "lerp_mode" in v:
                    o["lerp_mode"] = v["lerp_mode"]
                return o
        return v

    def convertChannel(ch):
        if ch is None or not isinstance(ch, dict) or isinstance(ch, list):
            return ch  # constant or molang
        if isinstance(ch.get("vector"), list):
            return ch["vector"]  # constant channel written as {"vector":[...]}
        out = {}
        for t, v in ch.items():
            out[t] = unwrap(v)
        return out

    j.pop("geckolib_format_version", None)  # GeckoLib-only root field
    for name, anim in (j.get("animations") or {}).items():
        # Preserve an explicit GeckoLib loop mode (true / false / "hold_on_last_frame");
        # Bedrock supports all three. Only fall back to the name heuristic when the
        # source does not declare loop (otherwise e.g. rabbit.new / scarecrow.idleSMOOTH
        # / vinemaiden.witherstun would be forced non-looping, and vinemaiden.hidden
        # would lose its hold_on_last_frame).
        declared = anim.get("loop")
        anim["loop"] = declared if (declared is True or declared is False or declared == "hold_on_last_frame") else (name.split(".")[-1] in LOOP_ANIMS)
        for bd in (anim.get("bones") or {}).values():
            for ch in ("rotation", "position", "scale"):
                if bd.get(ch) is not None:
                    bd[ch] = convertChannel(bd[ch])
                    if _easing_channel(bd[ch]):
                        bd[ch] = [0, 0, 0]
    return j


def genTextureAndGeometry():
    # geometries
    for f in sorted(os.listdir(SRC_GEO)):
        if not f.endswith(".geo.json"):
            continue
        src = SRC_GEO / f
        j = read_json(src)
        # fix bad identifier
        if f == "vinemaiden_seedling.geo.json":
            j["minecraft:geometry"][0]["description"]["identifier"] = "geometry.vinemaiden_seedling"
        write_json(RP / "models" / "entity" / f, j)
    # animations: GeckoLib keyframes are {"vector":[...],"easing":...} which Bedrock
    # does NOT understand (Bedrock uses plain arrays / molang / {pre,post}). Convert.
    for f in sorted(os.listdir(SRC_ANIM)):
        if not f.endswith(".animation.json"):
            continue
        write_json(RP / "animations" / f, convertAnimObject(read_json(SRC_ANIM / f)))
    # binding_ring has a single ring: the shared shielding-ring animation also
    # drives ring2, which this model does not have.
    sh = RP / "animations" / "shielding_ring.animation.json"
    if exists(sh):
        d = read_json(sh)
        anims = {}
        for k, v in (d.get("animations") or {}).items():
            (v.get("bones") or {}).pop("ring2", None)
            anims[k.replace("animation.shielding_ring.", "animation.binding_ring.")] = v
        d["animations"] = anims
        write_json(RP / "animations" / "binding_ring.animation.json", d)
    # textures
    for f in sorted(os.listdir(SRC_TEX)):
        if not f.endswith(".png"):
            continue
        copy(SRC_TEX / f, RP / "textures" / "entity" / "pcraftrevorn" / f)
    # Restore the classic Zombie Girl as the base pcraftrevorn:zombie model.
    # (Bibaso is now its own entity; see genBibasoZombie.)
    ORIG = ROOT / ".work" / "matopt_orig"
    if exists(ORIG / "geo" / "zombiegirl.geo.json"):
        write_json(RP / "models" / "entity" / "zombiegirl.geo.json", read_json(ORIG / "geo" / "zombiegirl.geo.json"))
    if exists(ORIG / "animations" / "zombiegirl.animation.json"):
        write_json(RP / "animations" / "zombiegirl.animation.json", convertAnimObject(read_json(ORIG / "animations" / "zombiegirl.animation.json")))
    if exists(ORIG / "textures"):
        for f in sorted(os.listdir(ORIG / "textures")):
            if f.startswith("zombie") and f.endswith(".png"):
                copy(ORIG / "textures" / f, RP / "textures" / "entity" / "pcraftrevorn" / f)
    # Use the ORIGINAL piglin king model (from the Salmonpred pack) as the base
    # pcraftrevorn:piglin_royal model. The dragon-girl model (mod) instead becomes
    # the independent creature pcraftrevorn:piglin_dragon (see generate_community).
    PORIG = ROOT / ".work" / "community" / "piglin_original" / "assets" / "pcraftrevorn"
    if exists(PORIG / "geo" / "piglin_royalty.geo.json"):
        write_json(RP / "models" / "entity" / "piglin_royalty.geo.json", read_json(PORIG / "geo" / "piglin_royalty.geo.json"))
        write_json(RP / "animations" / "piglin_royalty.animation.json", convertAnimObject(read_json(PORIG / "animations" / "piglin_royalty.animation.json")))
        for f in sorted(os.listdir(PORIG / "textures" / "entities")):
            if re.search(r"^piglin_royal_(female|male)0(_belly)?\.png$", f):
                copy(PORIG / "textures" / "entities" / f, RP / "textures" / "entity" / "pcraftrevorn" / f)
    # invisible placeholder texture + geometry
    writePng(RP / "textures" / "entity" / "pcraftrevorn" / "invisible.png", 16, 16, bytes(16 * 16 * 4))
    write_json(RP / "models" / "entity" / "invisible.geo.json", {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": INVISIBLE_GEO, "texture_width": 16, "texture_height": 16, "visible_bounds_width": 0.1, "visible_bounds_height": 0.1, "visible_bounds_offset": [0, 0, 0]},
            "bones": [{"name": "root", "pivot": [0, 0, 0], "cubes": [{"origin": [-0.01, 0, -0.01], "size": [0.02, 0.02, 0.02], "uv": [0, 0]}]}],
        }],
    })
    # simple projectile model (rabbit staff projectiles)
    write_json(RP / "models" / "entity" / "projectile.geo.json", {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {"identifier": "geometry.pcraftrevorn.projectile", "texture_width": 16, "texture_height": 16, "visible_bounds_width": 0.6, "visible_bounds_height": 0.6, "visible_bounds_offset": [0, 0.3, 0]},
            "bones": [{"name": "root", "pivot": [0, 0, 0], "cubes": [{"origin": [-2, 2, -7], "size": [4, 4, 14], "uv": [0, 0]}]}],
        }],
    })


# ---- entities ----
def genMobs():
    for e in ENTITIES:
        skins = skinsFor(e)
        n = len(skins)
        textureMap = {}
        arrayEntries = []
        for i, s in enumerate(skins):
            textureMap["skin" + str(i)] = "textures/entity/pcraftrevorn/" + s
            arrayEntries.append("Texture.skin" + str(i))

        anims = animNames(e["anim"])

        def short(a):
            return a.split(".")[-1]

        animMap = {}
        for a in anims:
            animMap[short(a)] = a
        animKeys = [short(a) for a in anims]
        idleKey = "idle" if "idle" in animKeys else (animKeys[0] if animKeys else None)
        walkKey = "walk" if "walk" in animKeys else idleKey
        # vanilla-style direct animate (no animation controller -> fewer failure points)
        animate = [{idleKey: "1.0 - math.min(1.0, query.modified_move_speed * 4.0)"}]
        if walkKey != idleKey:
            animate.append({walkKey: "math.min(1.0, query.modified_move_speed * 4.0)"})

        # client entity
        materials = {"default": "entity_alphatest"}
        textures = dict(textureMap)
        renderControllers = ["controller.render." + NS + "." + e["id"]]
        glowTex = GLOW.get(e["id"])
        if glowTex:
            materials["glow"] = "entity_emissive_alpha"
            textures["glow"] = "textures/entity/pcraftrevorn/" + glowTex
            renderControllers.append("controller.render." + NS + "." + e["id"] + ".glow")
        desc = {
            "identifier": NS + ":" + e["id"],
            "min_engine_version": "1.8.0",
            "materials": materials,
            "textures": textures,
            "geometry": {"default": geoIdent(e["geo"])},
            "animations": animMap,
            "scripts": {"animate": animate},
            "render_controllers": renderControllers,
        }
        # modern per-entity spawn egg texture (1.21+ format)
        if e["id"] in SPAWN_EGG:
            desc["spawn_egg"] = {"texture": NS + "_" + e["id"] + "_spawn_egg"}
        write_json(RP / "entity" / (e["id"] + ".entity.json"), {
            "format_version": "1.10.0",
            "minecraft:client_entity": {"description": desc},
        })
        # render controller(s)
        rc = {
            "controller.render." + NS + "." + e["id"]: {
                "geometry": "Geometry.default",
                "materials": [{"*": "Material.default"}],
                "arrays": {"textures": {"Array.skins": arrayEntries}},
                "textures": ["Array.skins[q.property('" + NS + ":skin')]"],
            }
        }
        if glowTex:
            rc["controller.render." + NS + "." + e["id"] + ".glow"] = {
                "geometry": "Geometry.default",
                "materials": [{"*": "Material.glow"}],
                "textures": ["Texture.glow"],
            }
        write_json(RP / "render_controllers" / (e["id"] + ".render_controllers.json"), {
            "format_version": "1.10.0",
            "render_controllers": rc,
        })
        # behavior
        genBehavior(e, n - 1)


def genBehavior(e, skinMax):
    components = {
        "minecraft:type_family": {"family": e["families"]},
        "minecraft:health": {"value": e["hp"], "max": e["hp"]},
        "minecraft:movement": {"value": e["speed"]},
        "minecraft:navigation.walk": {"can_path_over_water": True, "avoid_water": True},
        "minecraft:movement.basic": {},
        "minecraft:jump.static": {},
        "minecraft:physics": {},
        "minecraft:collision_box": {"width": e["size"][0], "height": e["size"][1]},
        "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
        "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0},
        "minecraft:nameable": {},
        "minecraft:damage_sensor": {"triggers": [{"cause": "fall", "deals_damage": False}]},
    }
    if e.get("dmg"):
        components["minecraft:attack"] = {"damage": e["dmg"]}
    if e.get("follow"):
        components["minecraft:follow_range"] = {"value": e["follow"], "max": e["follow"]}
    if e.get("kbr"):
        components["minecraft:knockback_resistance"] = {"value": e["kbr"]}
    components["minecraft:behavior.float"] = {"priority": 0}
    components["minecraft:behavior.random_stroll"] = {"priority": 4, "speed_multiplier": 1}
    components["minecraft:behavior.random_look_around"] = {"priority": 5}
    if e.get("loot"):
        components["minecraft:loot"] = {"table": "loot_tables/entities/" + e["loot"] + ".json"}

    componentGroups = {}
    events = {}
    # aggressive behaviors live in a group so the script can disable them while the
    # predator is swallowing (fixes "the mob keeps hitting me after being eaten")
    if e.get("hostile"):
        componentGroups[NS + ":aggressive"] = {
            "minecraft:behavior.melee_attack": {"priority": 1, "speed_multiplier": 1.2},
            "minecraft:behavior.hurt_by_target": {"priority": 2},
        }
        targets = TARGETS.get(e["id"], ["player", "villager"])
        if len(targets):
            componentGroups[NS + ":aggressive"]["minecraft:behavior.nearest_attackable_target"] = {
                "priority": 3, "must_see": True, "reselect_targets": True, "within_radius": e.get("follow") or 16,
                "entity_types": [{"filters": {"test": "is_family", "subject": "other", "value": t}, "max_dist": e.get("follow") or 16} for t in targets],
            }
        # during swallow the prey rides the predator (free look, position follows)
        componentGroups[NS + ":prey_holder"] = {
            "minecraft:rideable": {
                "seat_count": 1,
                "family_types": ["player"],
                "seats": [{"position": [0, 0, 0]}],
            }
        }
        events["minecraft:entity_spawned"] = {"add": {"component_groups": [NS + ":aggressive"]}}
        events[NS + ":on_swallow"] = {"remove": {"component_groups": [NS + ":aggressive"]}, "add": {"component_groups": [NS + ":prey_holder"]}}
        events[NS + ":on_release"] = {"add": {"component_groups": [NS + ":aggressive"]}, "remove": {"component_groups": [NS + ":prey_holder"]}}
    if e["id"] in TAMEABLE:
        componentGroups[NS + ":tamed"] = {
            "minecraft:is_tamed": {},
            "minecraft:behavior.follow_owner": {"priority": 6, "speed_multiplier": 1, "start_distance": 10, "stop_distance": 2},
        }
        events[NS + ":on_tame"] = {"add": {"component_groups": [NS + ":tamed"]}}
        items = TAME_ITEMS.get(e["id"], [])
        if items:
            components["minecraft:tameable"] = {
                "probability": 1,
                "tame_items": items,
                "tame_event": {"event": NS + ":on_tame", "target": "self"},
            }

    write_json(BP / "entities" / (e["id"] + ".json"), {
        "format_version": "1.21.0",
        "minecraft:entity": {
            "description": {
                "identifier": NS + ":" + e["id"],
                "is_spawnable": True,
                "is_summonable": True,
                "properties": {NS + ":skin": {"type": "int", "range": [0, max(1, skinMax)], "default": 0, "client_sync": True}},
            },
            "component_groups": componentGroups,
            "components": components,
            "events": events,
        },
    })


def genSpecial():
    for s in SPECIAL:
        geometry = "geometry.pcraftrevorn.projectile" if s.get("projectile") else INVISIBLE_GEO
        texture = "textures/items/pcraftrevorn/cupid_arrow" if s.get("projectile") else INVISIBLE_TEX
        # client entity
        write_json(RP / "entity" / (s["id"] + ".entity.json"), {
            "format_version": "1.10.0",
            "minecraft:client_entity": {
                "description": {
                    "identifier": NS + ":" + s["id"],
                    "materials": {"default": "entity_alphatest"},
                    "textures": {"default": texture},
                    "geometry": {"default": geometry},
                    "render_controllers": ["controller.render." + NS + "." + s["id"]],
                }
            },
        })
        write_json(RP / "render_controllers" / (s["id"] + ".render_controllers.json"), {
            "format_version": "1.10.0",
            "render_controllers": {
                "controller.render." + NS + "." + s["id"]: {"geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"]}
            },
        })
        if s.get("projectile"):
            components = {
                "minecraft:type_family": {"family": s["families"]},
                "minecraft:collision_box": {"width": 0.25, "height": 0.25},
                "minecraft:physics": {},
                "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
            }
        elif s.get("container"):
            components = {
                "minecraft:type_family": {"family": s["families"]},
                "minecraft:health": {"value": s["hp"], "max": s["hp"]},
                "minecraft:inventory": {"container_type": "inventory", "inventory_size": 54, "can_be_siphoned_from": False},
                "minecraft:collision_box": {"width": 0, "height": 0},
                "minecraft:physics": {"has_gravity": False, "has_collision": False},
                "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
                "minecraft:fire_immune": {},
                "minecraft:persistent": {},
                "minecraft:damage_sensor": {"triggers": [{"deals_damage": False}]},
            }
        elif s.get("boss"):
            components = {
                "minecraft:type_family": {"family": s["families"]},
                "minecraft:boss": {"hud_range": 100, "should_darken_sky": False},
                "minecraft:health": {"value": s["hp"], "max": s["hp"]},
                "minecraft:collision_box": {"width": 0, "height": 0},
                "minecraft:physics": {"has_gravity": False, "has_collision": False},
                "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
                "minecraft:fire_immune": {},
                "minecraft:persistent": {},
                "minecraft:damage_sensor": {"triggers": [{"deals_damage": False}]},
            }
        else:
            components = {
                "minecraft:type_family": {"family": s["families"]},
                "minecraft:health": {"value": s["hp"], "max": s["hp"]},
                "minecraft:collision_box": {"width": s["size"][0], "height": s["size"][1]},
                "minecraft:physics": {},
                "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
                "minecraft:fire_immune": {},
                "minecraft:damage_sensor": {"triggers": [{"deals_damage": False}]},
            }
        write_json(BP / "entities" / (s["id"] + ".json"), {
            "format_version": "1.21.0",
            "minecraft:entity": {
                "description": {"identifier": NS + ":" + s["id"], "is_spawnable": False, "is_summonable": True},
                "components": components,
            },
        })


# ---- spawn rules ----
def genSpawnRules():
    rules = [
        {"id": "basaltmite", "weight": 20, "min": 1, "max": 2, "biome": {"test": "has_biome_tag", "value": "basalt"}, "pop": "monster"},
        {"id": "silverfish", "weight": 10, "min": 1, "max": 2, "anyBiome": True, "pop": "monster"},
        {"id": "vinemaiden", "weight": 5, "min": 1, "max": 1, "anyBiome": True, "pop": "monster"},
        {"id": "zombie", "weight": 15, "min": 1, "max": 2, "anyBiome": True, "pop": "monster"},
    ]
    anyFilter = {"test": "has_biome_tag", "value": "overworld"}
    for r in rules:
        cond = {
            "minecraft:spawns_on_surface": {},
            "minecraft:brightness_filter": {"min": 0, "max": 15, "adjust_for_weather": False},
            "minecraft:difficulty_filter": {"min": "easy", "max": "hard"},
            "minecraft:weight": {"default": r["weight"]},
            "minecraft:herd": {"min_size": r["min"], "max_size": r["max"]},
            "minecraft:biome_filter": anyFilter if r.get("anyBiome") else r["biome"],
        }
        write_json(BP / "spawn_rules" / (r["id"] + ".json"), {
            "format_version": "1.8.0",
            "minecraft:spawn_rules": {
                "description": {"identifier": NS + ":" + r["id"], "population_control": r["pop"]},
                "conditions": [cond],
            },
        })


# ---- skin index data (for scripts) ----
def genSkinData():
    out = {}
    for e in ENTITIES:
        skins = skinsFor(e)
        m = {}
        for i, s in enumerate(skins):
            m[s] = i
        out[e["id"]] = m
    js = ("// AUTO-GENERATED by tools/generate_entities.js. Texture base name -> pcraftrevorn:skin index.\n"
          + "export const SKINS = " + json.dumps(out, indent=2, ensure_ascii=False) + ";\n")
    ensure_dir(BP / "scripts" / "pcraftrevorn" / "data")
    write_text(BP / "scripts" / "pcraftrevorn" / "data" / "skins.js", js)


# ---- attachables (custom armor + held 3D items) ----
def genAttachables():
    pieces = [
        {"item": "silverfish_plating_helmet", "piece": "helmet", "layer": 1, "vis": "helmet"},
        {"item": "silverfish_plating_chestplate", "piece": "chestplate", "layer": 1, "vis": "chest"},
        {"item": "silverfish_plating_leggings", "piece": "leggings", "layer": 2, "vis": "leg"},
        {"item": "silverfish_plating_boots", "piece": "boots", "layer": 1, "vis": "boot"},
    ]
    for p in pieces:
        tex = "textures/models/armor/silverfish_plating_layer_" + str(p["layer"])
        write_json(RP / "attachables" / (p["item"] + ".json"), {
            "format_version": "1.8.0",
            "minecraft:attachable": {
                "description": {
                    "identifier": NS + ":" + p["item"],
                    "materials": {"default": "armor", "enchanted": "armor_enchanted"},
                    "textures": {"default": tex, "enchanted": "textures/misc/enchanted_actor_glint"},
                    "geometry": {"default": "geometry.humanoid.armor." + p["piece"]},
                    "scripts": {"parent_setup": "variable." + p["vis"] + "_layer_visible = 0.0;"},
                    "render_controllers": ["controller.render.armor"],
                }
            },
        })
        write_json(RP / "attachables" / (p["item"] + ".player.json"), {
            "format_version": "1.10.0",
            "minecraft:attachable": {
                "description": {
                    "identifier": NS + ":" + p["item"] + ".player",
                    "item": {NS + ":" + p["item"]: "query.owner_identifier == 'minecraft:player'"},
                    "materials": {"default": "armor", "enchanted": "armor_enchanted"},
                    "textures": {"default": tex, "enchanted": "textures/misc/enchanted_actor_glint"},
                    "geometry": {"default": "geometry.player.armor." + p["piece"]},
                    "scripts": {"parent_setup": "variable." + p["vis"] + "_layer_visible = 0.0;", "animate": ["offset"]},
                    "animations": {"offset": "animation.armor." + p["piece"] + ".offset"},
                    "render_controllers": ["controller.render.armor"],
                }
            },
        })

    # rabbit staffs use a 3D geo model -> held-item attachables
    # held-item wield animation (positions the staff at the hand)
    write_json(RP / "animations" / "pcraftrevorn_held.animation.json", {
        "format_version": "1.8.0",
        "animations": {
            "animation.pcraftrevorn.held.wield": {
                "loop": True,
                "bones": {
                    "Staff": {"rotation": ["query.is_first_person ? 7 : 0", "query.is_first_person ? -29 : 0", 0], "position": [0, "query.is_first_person ? -2.75 : -6", "query.is_first_person ? -0.75 : 0"]},
                    "Eye": {"rotation": ["query.is_first_person ? 7 : 0", "query.is_first_person ? -29 : 0", 0], "position": [0, "query.is_first_person ? -2.75 : -6", "query.is_first_person ? -0.75 : 0"]},
                },
            }
        },
    })

    staffs = [
        {"item": "rabbit_staff", "tex": "rabbit_staff0"},
        {"item": "rabbit_staff_gold", "tex": "rabbit_staff1"},
        {"item": "rabbit_staff_bloodlust", "tex": "rabbit_staff2"},
    ]
    rc = {}
    for s in staffs:
        rcName = "controller.render." + NS + "." + s["item"]
        rc[rcName] = {"geometry": "Geometry.default", "materials": [{"*": "Material.default"}], "textures": ["Texture.default"]}
        write_json(RP / "attachables" / (s["item"] + ".json"), {
            "format_version": "1.10.0",
            "minecraft:attachable": {
                "description": {
                    "identifier": NS + ":" + s["item"],
                    "materials": {"default": "entity_alphatest", "enchanted": "entity_alphatest_glint"},
                    "textures": {"default": "textures/items/pcraftrevorn/" + s["tex"], "enchanted": "textures/misc/enchanted_item_glint"},
                    "geometry": {"default": "geometry.rabbit_staff"},
                    "animations": {"idle": "animation.rabbit_staff.idle", "wield": "animation.pcraftrevorn.held.wield"},
                    "scripts": {"animate": ["idle", "wield"]},
                    "render_controllers": [rcName],
                }
            },
        })
    write_json(RP / "render_controllers" / "staffs.render_controllers.json", {"format_version": "1.10.0", "render_controllers": rc})


# ---- Bibaso zombie is now a selectable look-set on pcraftrevorn:zombie
# (handled by generate_variants.js), not a standalone entity. ----


def main():
    if not exists(MOD):
        print("Missing .work/mod. Run tools/extract.ps1 first.", file=sys.stderr)
        sys.exit(1)
    for d in [
        BP / "entities", BP / "spawn_rules",
        # only skins.js is owned here; structures.js is produced by nbt_to_data.js
        BP / "scripts" / "pcraftrevorn" / "data" / "skins.js",
        RP / "entity", RP / "models" / "entity",
        RP / "animations", RP / "animation_controllers",
        RP / "render_controllers", RP / "attachables",
        RP / "textures" / "entity" / "pcraftrevorn",
        RP / "font",
        RP / "subpacks",
    ]:
        rmrf(d)
    genTextureAndGeometry()
    genMobs()
    genSpecial()
    genSpawnRules()
    genSkinData()
    genAttachables()
    if generateCommunity is not None:
        generateCommunity()
    else:
        print("warning: generate_community module not found; skipping generateCommunity()", file=sys.stderr)
    if generateVariants is not None:
        generateVariants()
    else:
        print("warning: generate_variants module not found; skipping generateVariants()", file=sys.stderr)
    if generateVcm is not None:
        generateVcm()
    else:
        print("warning: generate_vcm module not found; skipping generateVcm()", file=sys.stderr)
    print("Phase 2 entities generated.")


if __name__ == "__main__":
    main()
