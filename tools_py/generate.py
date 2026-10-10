#!/usr/bin/env python3
"""PCraftRevorn -> Bedrock content generator (Phase 0 + Phase 1).

Python port of tools/generate.js. Behaviour, input paths and output paths match
the Node script exactly.

PREREQUISITE: the original Forge jar must be extracted to ./.work/mod
  (see tools/extract.ps1, or extract the jar manually preserving paths).

This script produces, from the decompiled/original assets:
  behavior_pack/   blocks, items, recipes, loot_tables, texts
  resource_pack/   textures, sounds, item/terrain atlases, block geometry, texts

Namespace: pcraftrevorn

Run:  python tools_py/generate.py
"""
from __future__ import annotations

import json
import math
import os
import re
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import ROOT, NS, ensure_dir, write_text, read_json, exists, rmrf, copy
from _common import write_json as _raw_write_json


def _is_dist_file(p) -> bool:
    """True for dist.json and version-variant files (e.g. menu.json.1.21.80.x)."""
    n = p.name.lower()
    return n == "dist.json" or n.endswith(".x") or ".x." in n


def _preserve_dist(dirs):
    """Snapshot dist.json + variant files so the clean step can not delete them."""
    stash = []
    for d in dirs:
        d = Path(d)
        if not d.exists():
            continue
        for f in sorted(d.rglob("*")):
            if f.is_file() and _is_dist_file(f):
                stash.append((d, f.relative_to(d), f.read_bytes()))
    return stash


def _restore_dist(stash) -> None:
    for d, rel, data in stash:
        p = Path(d) / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)



# Faithful JSON emission: JavaScript's JSON.stringify has no int/float
# distinction (3.0 prints as "3"), and V8 lists array-index object keys in
# ascending numeric order before all other keys regardless of insertion order.
def _js_order(obj):
    if isinstance(obj, dict):
        index_keys = []
        other_keys = []
        for k, v in obj.items():
            if isinstance(k, str) and k.isdigit() and str(int(k)) == k and 0 <= int(k) <= 0xFFFFFFFE:
                index_keys.append((int(k), k, v))
            else:
                other_keys.append((k, v))
        index_keys.sort(key=lambda t: t[0])
        out = {}
        for _, k, v in index_keys:
            out[k] = _js_order(v)
        for k, v in other_keys:
            out[k] = _js_order(v)
        return out
    if isinstance(obj, list):
        return [_js_order(x) for x in obj]
    if isinstance(obj, float) and obj.is_integer():
        return int(obj)
    return obj


def write_json(path, obj) -> None:
    _raw_write_json(path, _js_order(obj))


MOD = ROOT / ".work" / "mod"
SRC_ASSETS = MOD / "assets" / "pcraftrevorn"
SRC_DATA = MOD / "data" / "pcraftrevorn"
BP = ROOT / "behavior_pack"
RP = ROOT / "resource_pack"


# ---------------------------------------------------------------- helpers
def _js_round(x: float) -> int:
    """JavaScript Math.round: halves round towards +Infinity."""
    return int(math.floor(x + 0.5))


def rgb(java_int: int) -> str:
    n = java_int & 0xFFFFFF
    return "#" + format(n, "06x")


# ---------------------------------------------------------------- png writer
def _build_crc_table():
    table = []
    for n in range(256):
        c = n
        for _ in range(8):
            c = (0xEDB88320 ^ (c >> 1)) if (c & 1) else (c >> 1)
        table.append(c & 0xFFFFFFFF)
    return table


CRC_TABLE = _build_crc_table()


def _crc32(buf: bytes) -> int:
    c = 0xFFFFFFFF
    for byte in buf:
        c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >> 8)
    return (c ^ 0xFFFFFFFF) & 0xFFFFFFFF


def _chunk(ctype: bytes, data: bytes) -> bytes:
    body = ctype + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", _crc32(body))


def write_png(file, width: int, height: int, rgba) -> None:
    sig = bytes([137, 80, 78, 71, 13, 10, 26, 10])
    ihdr = bytearray(13)
    ihdr[0:4] = struct.pack(">I", width)
    ihdr[4:8] = struct.pack(">I", height)
    ihdr[8] = 8
    ihdr[9] = 6
    ihdr[10] = 0
    ihdr[11] = 0
    ihdr[12] = 0
    stride = width * 4
    raw = bytearray((stride + 1) * height)
    for y in range(height):
        base = y * (stride + 1)
        raw[base] = 0
        raw[base + 1:base + 1 + stride] = rgba[y * stride:y * stride + stride]
    png = (
        sig
        + _chunk(b"IHDR", bytes(ihdr))
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + _chunk(b"IEND", b"")
    )
    p = Path(file)
    ensure_dir(p.parent)
    with open(p, "wb") as f:
        f.write(png)


def hex_to_rgb(hexstr: str):
    n = int(hexstr[1:], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]


# ---- vanilla spawn-egg art (Java spawn_egg.png + overlay, tinted by colour) ----
def decode_png_rgba(buf: bytes):
    if len(buf) < 8 or int.from_bytes(buf[0:4], "big") != 0x89504E47:
        return None
    off = 8
    w = 0
    h = 0
    bit = 0
    color = 0
    interlace = 0
    idat = []
    while off < len(buf):
        length = int.from_bytes(buf[off:off + 4], "big")
        ctype = bytes(buf[off + 4:off + 8]).decode("ascii")
        d = buf[off + 8:off + 8 + length]
        if ctype == "IHDR":
            w = int.from_bytes(d[0:4], "big")
            h = int.from_bytes(d[4:8], "big")
            bit = d[8]
            color = d[9]
            interlace = d[12]
        elif ctype == "IDAT":
            idat.append(d)
        elif ctype == "IEND":
            break
        off += 12 + length
    if bit != 8 or interlace:
        return None
    ch = {2: 3, 6: 4}.get(color)
    if not ch:
        return None
    raw = zlib.decompress(b"".join(idat))
    stride = w * ch
    out = bytearray(w * h * 4)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        for i in range(stride):
            a = line[i - ch] if i >= ch else 0
            b = prev[i]
            c = prev[i - ch] if i >= ch else 0
            v = line[i]
            if ft == 1:
                v = (v + a) & 255
            elif ft == 2:
                v = (v + b) & 255
            elif ft == 3:
                v = (v + ((a + b) >> 1)) & 255
            elif ft == 4:
                pa = abs(b - c)
                pb = abs(a - c)
                pc = abs(a + b - 2 * c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                v = (v + pred) & 255
            line[i] = v
        for x in range(w):
            o = (y * w + x) * 4
            s = x * ch
            if color == 6:
                out[o] = line[s]
                out[o + 1] = line[s + 1]
                out[o + 2] = line[s + 2]
                out[o + 3] = line[s + 3]
            else:
                out[o] = line[s]
                out[o + 1] = line[s + 1]
                out[o + 2] = line[s + 2]
                out[o + 3] = 255
        prev = line
    return {"w": w, "h": h, "data": out}


EGG_DIR = ROOT / "tools" / "assets" / "egg"


def _load_egg_art():
    try:
        b = decode_png_rgba((EGG_DIR / "spawn_egg.png").read_bytes())
        o = decode_png_rgba((EGG_DIR / "spawn_egg_overlay.png").read_bytes())
        if b and o and b["w"] == o["w"] and b["h"] == o["h"]:
            return {"base": b, "overlay": o}
    except Exception:
        pass
    return None


EGG_ART = _load_egg_art()


def make_egg_png(file, base, overlay) -> None:
    br, bg, bb = hex_to_rgb(base)
    orr, og, ob = hex_to_rgb(overlay)
    if EGG_ART:
        data = EGG_ART["base"]["data"]
        od = EGG_ART["overlay"]["data"]
        w = EGG_ART["base"]["w"]
        h = EGG_ART["base"]["h"]
        out = bytearray(w * h * 4)
        for i in range(0, w * h * 4, 4):
            r = data[i] * br / 255
            g = data[i + 1] * bg / 255
            bl = data[i + 2] * bb / 255
            a = data[i + 3]
            if od[i + 3] > 0:
                oa = od[i + 3] / 255
                r = od[i] * orr / 255 * oa + r * (1 - oa)
                g = od[i + 1] * og / 255 * oa + g * (1 - oa)
                bl = od[i + 2] * ob / 255 * oa + bl * (1 - oa)
                a = max(a, od[i + 3])
            out[i] = _js_round(r)
            out[i + 1] = _js_round(g)
            out[i + 2] = _js_round(bl)
            out[i + 3] = a
        write_png(file, w, h, out)
        return
    # fallback: simple egg silhouette
    W = 16
    H = 16
    buf = bytearray(W * H * 4)

    def set_px(x, y, r, g, b, a=255):
        if x < 0 or y < 0 or x >= W or y >= H:
            return
        i = (y * W + x) * 4
        buf[i] = r
        buf[i + 1] = g
        buf[i + 2] = b
        buf[i + 3] = a

    rows = [[2, 7, 8], [3, 6, 9], [4, 5, 10], [5, 5, 10], [6, 4, 11], [7, 4, 11],
            [8, 4, 11], [9, 4, 11], [10, 4, 11], [11, 5, 10], [12, 5, 10], [13, 6, 9]]
    for y, x0, x1 in rows:
        shade = 1.0 if y <= 7 else (0.85 if y <= 10 else 0.7)
        for x in range(x0, x1 + 1):
            set_px(x, y, _js_round(br * shade), _js_round(bg * shade), _js_round(bb * shade))
    for x, y in [[6, 4], [9, 5], [6, 7], [10, 8], [5, 9], [8, 10], [11, 7], [7, 12]]:
        set_px(x, y, orr, og, ob)
    write_png(file, W, H, buf)


# ---------------------------------------------------------------- item data
# kind: item | food | armor | spawn_egg
FOOD = {
    "glowberry_juice_bottle": {"nutrition": 12, "saturation": 0.3, "alwaysEat": True},
    "fermented_glowberry_juice_bottle": {"nutrition": 12, "saturation": 0.5, "alwaysEat": True},
}
ARMOR = {
    "silverfish_plating_helmet": {"slot": "slot.armor.head", "protection": 2, "durability": 165},
    "silverfish_plating_chestplate": {"slot": "slot.armor.chest", "protection": 6, "durability": 240},
    "silverfish_plating_leggings": {"slot": "slot.armor.legs", "protection": 5, "durability": 225},
    "silverfish_plating_boots": {"slot": "slot.armor.feet", "protection": 2, "durability": 195},
}
SPAWN_EGGS = {
    "zombie_spawn_egg": {"entity": "zombie", "base": -11363863, "overlay": -13677023},
    "piglin_royal_spawn_egg": {"entity": "piglin_royal", "base": -2978963, "overlay": -3098555},
    "vinemaiden_spawn_egg": {"entity": "vinemaiden", "base": -8403377, "overlay": -3846321},
    "piglin_royal_knight_spawn_egg": {"entity": "piglin_royal_knight", "base": -6133183, "overlay": -3298757},
    "silverfish_spawn_egg": {"entity": "silverfish", "base": -10066330, "overlay": -13421773},
    "basaltmite_spawn_egg": {"entity": "basaltmite", "base": -14343893, "overlay": -13425901},
    "rabbit_wizard_spawn_egg": {"entity": "rabbit_wizard", "base": -10066177, "overlay": -52},
    "gilded_basaltmite_spawn_egg": {"entity": "gilded_basaltmite", "base": -14343893, "overlay": -13312},
    "scarecrow_spawn_egg": {"entity": "scarecrow", "base": -3407872, "overlay": -13312},
}
# name: [textureFile, stack, category, tags]
ITEMS = [
    ["attuned_binding_ring", "attuned_binding_ring", 1, "equipment"],
    ["basaltmite_plated_soles", "basaltmite_plated_soles", 1, "equipment"],
    ["basaltmite_scale", "basaltmite_scale", 64, "items", ["pcraftrevorn:basaltmite_scale"]],
    ["bejeweled_upgrade_kit", "jeweled_upgrade_template", 64, "items"],
    ["carbonated_water_bottle", "carbonated_water_bottle", 1, "items"],
    ["cupids_arrow", "cupid_arrow", 1, "items"],
    ["debugging_item", "pufferfish_bucket", 64, "items", None, True],
    ["fermented_glowberry_juice_bottle", "fermented_glowberry_bottle", 1, "nature"],
    ["gilded_basaltmite_scale", "basaltmite_plate_gilded", 64, "items", ["pcraftrevorn:basaltmite_scale"]],
    ["gilded_shield", "gilded_shield", 1, "equipment"],
    ["glowberry_juice_bottle", "glowberry_bottle", 1, "nature"],
    ["golden_bone_meal", "golden_bone_meal", 64, "nature"],
    ["golden_piglin_armor_kit", "golden_piglin_armor_kit", 1, "items"],
    ["hyperdense_porkchop", "hyperdense_porkchop", 1, "nature"],
    ["netherite_piglin_armor_kit", "netherite_piglin_armor_kit", 1, "items"],
    ["neutralizing_water", "neutralizing_water_bottle", 1, "items"],
    ["peculiar_mirror", "peculiar_mirror", 1, "items"],
    ["piglin_might_talisman", "piglin_might_talisman", 1, "equipment"],
    ["piglin_royal_talisman", "piglin_royal_talisman", 1, "equipment"],
    ["pred_guidebook_item", "pred_guidebook", 1, "items"],
    ["rabbit_staff", "rabbit_staff0", 1, "equipment"],
    ["rabbit_staff_bloodlust", "rabbit_staff2", 1, "equipment"],
    ["rabbit_staff_gold", "rabbit_staff1", 1, "equipment"],
    ["silverfish_plate", "silverfish_scale", 64, "items"],
    ["silverfish_plating_helmet", "silverfish_plating_helmet", 1, "equipment"],
    ["silverfish_plating_chestplate", "silverfish_plating_chestplate", 1, "equipment"],
    ["silverfish_plating_leggings", "silverfish_plating_leggings", 1, "equipment"],
    ["silverfish_plating_boots", "silverfish_plating_boots", 1, "equipment"],
    ["sugar_glass_bottle", "sugar_glass_bottle", 64, "items"],
    ["sugar_neutralizing_water", "neutralizing_sugar_bottle", 1, "items"],
    ["vibrant_elixir", "vibrant_tonic", 1, "items"],
]
HAND_EQUIPPED = {"rabbit_staff", "rabbit_staff_bloodlust", "rabbit_staff_gold", "gilded_shield"}

# Custom potions: Bedrock can't register new mob effects, so these are custom
# drinkable items (bottle recoloured to a similar hue + custom name) whose
# effect is applied by script.
POTIONS = [
    {"id": "fragrance_potion", "color": "#c9a0dc"},
    {"id": "stench_potion", "color": "#556b2f"},
    {"id": "fortitude_potion", "color": "#7f8fa6"},
    {"id": "pacifying_potion", "color": "#8fd0e8"},
    {"id": "rotten_stench_potion", "color": "#3b4020"},
]

ENC_SLOT = {
    "slot.armor.head": "armor_head",
    "slot.armor.chest": "armor_torso",
    "slot.armor.legs": "armor_legs",
    "slot.armor.feet": "armor_feet",
}


# ---------------------------------------------------------------- items
def gen_items() -> None:
    texture_data = {}
    for row in ITEMS:
        name = row[0]
        tex = row[1]
        stack = row[2]
        category = row[3]
        tags = row[4] if len(row) > 4 else None
        vanilla_tex = row[5] if len(row) > 5 else None
        components = {}
        if vanilla_tex:
            components["minecraft:icon"] = {"textures": {"default": tex}}
        else:
            texture_data["pcraftrevorn_" + name] = {"textures": "textures/items/pcraftrevorn/" + tex}
            components["minecraft:icon"] = {"textures": {"default": "pcraftrevorn_" + name}}
        components["minecraft:max_stack_size"] = 1 if name in ARMOR else stack
        if name in HAND_EQUIPPED:
            components["minecraft:hand_equipped"] = True
        if tags:
            components["minecraft:tags"] = {"tags": tags}
        if name in FOOD:
            f = FOOD[name]
            components["minecraft:food"] = {"nutrition": f["nutrition"], "saturation_modifier": f["saturation"]}
            if f.get("alwaysEat"):
                components["minecraft:food"]["can_always_eat"] = True
            components["minecraft:use_animation"] = {"value": "eat"}
            components["minecraft:use_modifiers"] = {
                "start_using": "always",
                "use_duration": 1.6,
                "movement_modifier": 0.35,
            }
        if name in ARMOR:
            a = ARMOR[name]
            components["minecraft:wearable"] = {"slot": a["slot"], "protection": a["protection"]}
            components["minecraft:durability"] = {"max_durability": a["durability"]}
            components["minecraft:repairable"] = {
                "repair_items": [{"items": ["pcraftrevorn:silverfish_plate"], "repair_amount": 60}]
            }
            components["minecraft:enchantable"] = {"value": 16, "slot": ENC_SLOT[a["slot"]]}
        defn = {
            "format_version": "1.21.0",
            "minecraft:item": {
                "description": {"identifier": f"{NS}:{name}", "menu_category": {"category": category}},
                "components": components,
            },
        }
        write_json(BP / "items" / (name + ".json"), defn)
    # spawn eggs
    for name, s in SPAWN_EGGS.items():
        gen_spawn_egg(name, s, texture_data)
    write_json(RP / "textures" / "item_texture.json", {
        "resource_pack_name": "pcraftrevorn",
        "texture_name": "atlas.items",
        "texture_data": texture_data,
    })


def gen_spawn_egg(name, s, texture_data) -> None:
    tex_key = "pcraftrevorn_" + name
    texture_data[tex_key] = {"textures": "textures/items/pcraftrevorn/" + name}
    write_json(BP / "items" / (name + ".json"), {
        "format_version": "1.21.0",
        "minecraft:item": {
            "description": {"identifier": f"{NS}:{name}", "menu_category": {"category": "nature"}},
            "components": {
                "minecraft:icon": {"textures": {"default": tex_key}},
                "minecraft:max_stack_size": 64,
                "minecraft:entity_placer": {"entity": f"{NS}:{s['entity']}"},
            },
        },
    })
    make_egg_png(RP / "textures" / "items" / "pcraftrevorn" / (name + ".png"), rgb(s["base"]), rgb(s["overlay"]))


# ---------------------------------------------------------------- block geometry
def java_element_to_bedrock(el, tex_key_map=None):
    frm = el["from"]
    to = el["to"]
    size = [to[0] - frm[0], to[1] - frm[1], to[2] - frm[2]]
    face_names = ["north", "east", "south", "west", "up", "down"]
    uv = {}
    for fn in face_names:
        faces = el.get("faces")
        f = faces.get(fn) if faces else None
        if not f or not f.get("uv"):
            uv[fn] = {"uv": [0, 0], "uv_size": [1, 1]}
            continue
        u1, v1, u2, v2 = f["uv"]
        uv[fn] = {"uv": [min(u1, u2), min(v1, v2)], "uv_size": [u2 - u1, v2 - v1]}
    cube = {
        "origin": [frm[0] - 8, frm[1], frm[2] - 8],
        "size": [size[0], size[1], size[2]],
        "uv": uv,
    }
    # element-level rotation (single axis) -> bedrock rotation + pivot
    if el.get("rotation"):
        r = el["rotation"]
        pivot = [r["origin"][0] - 8, r["origin"][1], r["origin"][2] - 8]
        rot = [0, 0, 0]
        if r["axis"] == "x":
            rot[0] = r["angle"]
        if r["axis"] == "y":
            rot[1] = r["angle"]
        if r["axis"] == "z":
            rot[2] = r["angle"]
        cube["pivot"] = pivot
        cube["rotation"] = rot
    # material from the texture the element's faces reference
    faces = el.get("faces")
    if faces and faces.get("north") and faces["north"].get("texture"):
        cube["material"] = faces["north"]["texture"].replace("#", "")
        if cube["material"] == "all":
            del cube["material"]
    return cube


def convert_java_model(src_file, identifier, override_size):
    m = read_json(src_file)
    cubes = [java_element_to_bedrock(el) for el in (m.get("elements") or [])]
    cubes = [c for c in cubes if c]
    size = override_size or [64, 64]
    geo = {
        "format_version": "1.12.0",
        "minecraft:geometry": [{
            "description": {
                "identifier": identifier,
                "texture_width": size[0],
                "texture_height": size[1],
                "visible_bounds_width": 8,
                "visible_bounds_height": 4,
                "visible_bounds_offset": [0, 1, 0],
            },
            "bones": [{"name": "root", "pivot": [0, 0, 0], "cubes": cubes}],
        }],
    }
    return geo


# ---------------------------------------------------------------- potions
def make_bottle_png(file, hexstr) -> None:
    W = 16
    H = 16
    buf = bytearray(W * H * 4)
    r, g, b = hex_to_rgb(hexstr)

    def set_px(x, y, cr, cg, cb, a=255):
        i = (y * W + x) * 4
        buf[i] = cr
        buf[i + 1] = cg
        buf[i + 2] = cb
        buf[i + 3] = a

    for y in range(6, 15):
        for x in range(5, 11):
            set_px(x, y, 222, 232, 238, 200)  # glass body
    for y in range(8, 14):
        for x in range(6, 10):
            set_px(x, y, r, g, b)  # liquid
    for y in range(3, 7):
        for x in range(7, 9):
            set_px(x, y, 222, 232, 238, 200)  # neck
    for y in range(2, 4):
        for x in range(6, 10):
            set_px(x, y, 139, 90, 43)  # cork
    for y in range(8, 13):
        set_px(6, y, 255, 255, 255, 120)  # highlight
    write_png(file, W, H, buf)


def gen_potions() -> None:
    atlas_path = RP / "textures" / "item_texture.json"
    atlas = read_json(atlas_path) if exists(atlas_path) else {
        "resource_pack_name": "pcraftrevorn",
        "texture_name": "atlas.items",
        "texture_data": {},
    }
    for p in POTIONS:
        key = "pcraftrevorn_" + p["id"]
        atlas["texture_data"][key] = {"textures": "textures/items/pcraftrevorn/" + p["id"]}
        write_json(BP / "items" / (p["id"] + ".json"), {
            "format_version": "1.21.0",
            "minecraft:item": {
                "description": {"identifier": f"{NS}:{p['id']}", "menu_category": {"category": "equipment"}},
                "components": {
                    "minecraft:icon": {"textures": {"default": key}},
                    "minecraft:max_stack_size": 1,
                    "minecraft:food": {"nutrition": 0, "saturation_modifier": 0, "can_always_eat": True},
                    "minecraft:use_animation": {"value": "drink"},
                    "minecraft:use_modifiers": {
                        "start_using": "always",
                        "use_duration": 1.6,
                        "movement_modifier": 0.35,
                    },
                },
            },
        })
        make_bottle_png(RP / "textures" / "items" / "pcraftrevorn" / (p["id"] + ".png"), p["color"])
    write_json(atlas_path, atlas)


# ---------------------------------------------------------------- blocks
# file -> resource path (relative to textures/)
BLOCK_TEX = {
    "glowberry_fermentation_barrel_top": "blocks/pcraftrevorn/glowberry_fermentation_barrel_top",
    "glowberry_fermentation_barrel_bottom": "blocks/pcraftrevorn/glowberry_fermentation_barrel_bottom",
    "glowberry_fermentation_barrel_front": "blocks/pcraftrevorn/glowberry_fermentation_barrel_front",
    "glowberry_fermentation_barrel_back": "blocks/pcraftrevorn/glowberry_fermentation_barrel_back",
    "glowberry_fermentation_barrel_side": "blocks/pcraftrevorn/glowberry_fermentation_barrel_side",
    "glowberry_fermentation_barrel_side2": "blocks/pcraftrevorn/glowberry_fermentation_barrel_side2",
    "soul_jack_o_lantern": "blocks/pcraftrevorn/soul_jack_o_lantern",
    "pumpkin_top": "blocks/pumpkin_top",
    "pumpkin_side": "blocks/pumpkin_side",
    "piglin_throne_base": "blocks/pcraftrevorn/piglin_throne_base",
    "piglin_throne_diagonals": "blocks/pcraftrevorn/piglin_throne_diagonals",
    "piglin_throne_backing": "blocks/pcraftrevorn/piglin_throne_backing",
    "piglin_throne_arm": "blocks/pcraftrevorn/piglin_throne_arm",
    "blaze_rod_supports": "blocks/pcraftrevorn/blaze_rod_supports",
    "skull_decoration": "blocks/pcraftrevorn/skull_decoration",
    "cloth_backing": "blocks/pcraftrevorn/cloth_backing",
}
BLOCKS = [
    {"name": "glowberry_fermentation_barrel", "light": 0, "loot": "glowberry_fermentation_barrel", "lootItem": "pcraftrevorn:glowberry_fermentation_barrel", "faces": {"up": "glowberry_fermentation_barrel_top", "down": "glowberry_fermentation_barrel_bottom", "north": "glowberry_fermentation_barrel_front", "south": "glowberry_fermentation_barrel_back", "east": "glowberry_fermentation_barrel_side", "west": "glowberry_fermentation_barrel_side2"}},
    {"name": "soul_jack_o_lantern", "light": 10, "loot": "soul_jack_o_lantern", "lootItem": "pcraftrevorn:soul_jack_o_lantern", "faces": {"up": "pumpkin_top", "down": "pumpkin_top", "north": "soul_jack_o_lantern", "south": "pumpkin_side", "east": "pumpkin_side", "west": "pumpkin_side"}},
    {"name": "piglin_throne_1", "geo": "custom/piglin_throne1", "texSize": [16, 16], "light": 0, "loot": "gilded_blackstone", "lootItem": "minecraft:gilded_blackstone", "materials": {"1": "piglin_throne_diagonals", "2": "blaze_rod_supports", "3": "skull_decoration", "4": "piglin_throne_base"}, "defaultTex": "piglin_throne_base"},
    {"name": "piglin_throne_2", "geo": "custom/piglin_throne2", "texSize": [64, 64], "light": 0, "loot": "gilded_blackstone", "lootItem": "minecraft:gilded_blackstone", "materials": {"1": "piglin_throne_backing", "2": "cloth_backing", "3": "piglin_throne_arm"}, "defaultTex": "piglin_throne_backing"},
]


def gen_blocks() -> None:
    terrain = {
        "resource_pack_name": "pcraftrevorn",
        "texture_name": "atlas.terrain",
        "padding": 8,
        "num_mip_levels": 4,
        "texture_data": {},
    }

    def tex_key(file):
        k = f"{NS}_{file}"
        if k not in terrain["texture_data"]:
            terrain["texture_data"][k] = {"textures": "textures/" + BLOCK_TEX[file]}
        return k

    for b in BLOCKS:
        ident = f"{NS}:{b['name']}"
        mi = {}
        if b.get("faces"):
            for face, file in b["faces"].items():
                mi[face] = {"texture": tex_key(file), "render_method": "opaque"}
        else:
            mi["*"] = {"texture": tex_key(b["defaultTex"]), "render_method": "opaque"}
            for key, file in b["materials"].items():
                mi[key] = {"texture": tex_key(file), "render_method": "opaque"}
        components = {
            "minecraft:geometry": {"identifier": "geometry.pcraftrevorn." + b["name"]} if b.get("geo") else "minecraft:geometry.full_block",
            "minecraft:material_instances": mi,
            "minecraft:destructible_by_mining": {"seconds_to_destroy": 2},
            "minecraft:destructible_by_explosion": {"explosion_resistance": 10},
            "minecraft:loot": f"loot_tables/blocks/{b['loot']}.json",
            "minecraft:map_color": "#5c4a37",
        }
        if b.get("light"):
            components["minecraft:light_emission"] = b["light"]
        write_json(BP / "blocks" / (b["name"] + ".json"), {
            "format_version": "1.21.0",
            "minecraft:block": {
                "description": {
                    "identifier": ident,
                    "menu_category": {"category": "construction"},
                    "states": {"minecraft:cardinal_direction": {"values": ["north", "east", "south", "west"]}},
                },
                "components": components,
                "permutations": [
                    {"condition": "q.block_state('minecraft:cardinal_direction') == 'north'", "components": {"minecraft:transformation": {"rotation": [0, 0, 0]}}},
                    {"condition": "q.block_state('minecraft:cardinal_direction') == 'east'", "components": {"minecraft:transformation": {"rotation": [0, 90, 0]}}},
                    {"condition": "q.block_state('minecraft:cardinal_direction') == 'south'", "components": {"minecraft:transformation": {"rotation": [0, 180, 0]}}},
                    {"condition": "q.block_state('minecraft:cardinal_direction') == 'west'", "components": {"minecraft:transformation": {"rotation": [0, 270, 0]}}},
                ],
            },
        })
        write_json(BP / "loot_tables" / "blocks" / (b["loot"] + ".json"), {
            "pools": [{"rolls": 1, "conditions": [{"condition": "minecraft:survives_explosion"}], "entries": [{"type": "item", "name": b["lootItem"], "weight": 1}]}]
        })
        if b.get("geo"):
            geo = convert_java_model(SRC_ASSETS / "models" / (b["geo"] + ".json"), "geometry.pcraftrevorn." + b["name"], b.get("texSize"))
            write_json(RP / "models" / "blocks" / (b["name"] + ".geo.json"), geo)
    write_json(RP / "textures" / "terrain_texture.json", terrain)


# ---------------------------------------------------------------- recipes
TAG_ITEMS = {"pcraftrevorn:basaltmite_scale": ["pcraftrevorn:basaltmite_scale", "pcraftrevorn:gilded_basaltmite_scale"]}


def convert_key(ing):
    if ing.get("item"):
        return {"item": ing["item"]}
    if ing.get("tag"):
        return {"tag": ing["tag"]}
    return ing


def gen_recipes() -> None:
    d = SRC_DATA / "recipes"
    if not exists(d):
        return
    for file in os.listdir(d):
        src = read_json(d / file)
        ident = f"{NS}:{Path(file).stem}"
        out = {"format_version": "1.20.10"}
        if src.get("type") == "minecraft:crafting_shaped":
            key = {}
            for k, v in src["key"].items():
                key[k] = convert_key(v)
            out["minecraft:recipe_shaped"] = {
                "description": {"identifier": ident},
                "tags": ["crafting_table"],
                "pattern": src["pattern"],
                "key": key,
                "result": {"item": src["result"].get("item"), "count": src["result"].get("count") or 1},
            }
        elif src.get("type") == "minecraft:crafting_shapeless":
            out["minecraft:recipe_shapeless"] = {
                "description": {"identifier": ident},
                "tags": ["crafting_table"],
                "ingredients": [convert_key(i) for i in src["ingredients"]],
                "result": {"item": src["result"].get("item"), "count": src["result"].get("count") or 1},
            }
        elif src.get("type") == "minecraft:smithing_transform":
            # Bedrock's smithing table only accepts a fixed netherite recipe shape
            # (template must be a tempate item, addition must be netherite_ingot,
            # base must be vanilla armor/tool). Custom smithing cannot be expressed,
            # so port it as a temporary crafting-table recipe; P5 restores the real
            # interaction via script.
            out["minecraft:recipe_shapeless"] = {
                "description": {"identifier": ident},
                "tags": ["crafting_table"],
                "ingredients": [convert_key(src["template"]), convert_key(src["base"]), convert_key(src["addition"])],
                "result": {"item": src["result"].get("item"), "count": src["result"].get("count") or 1},
            }
        elif src.get("type") == "minecraft:smelting":
            out["minecraft:recipe_furnace"] = {
                "description": {"identifier": ident},
                "tags": ["furnace"],
                "input": src["ingredient"].get("item") or src["ingredient"].get("tag"),
                "output": src["result"],
            }
        else:
            continue
        write_json(BP / "recipes" / file, out)


# ---------------------------------------------------------------- entity loot (ported for later entity phase)
def gen_entity_loot() -> None:
    mapping = {"entities/zombie.json": "zombie", "entities/piglin_royal.json": "piglin_royal"}
    for rel, name in mapping.items():
        src_file = SRC_DATA / "loot_tables" / rel
        if not exists(src_file):
            continue
        src = read_json(src_file)
        pools = []
        for p in src["pools"]:
            entries = []
            for e in p["entries"]:
                if e.get("name") == "minecraft:air":
                    continue
                entry = {"type": "item", "name": e["name"], "weight": e.get("weight") or 1}
                if "functions" in e:
                    entry["functions"] = e["functions"]
                entries.append(entry)
            pools.append({"rolls": p["rolls"], "entries": entries})
        write_json(BP / "loot_tables" / "entities" / (name + ".json"), {"pools": pools})


# ---------------------------------------------------------------- lang
# English display names. The bundled source lang is the Chinese-localised build,
# so zh_CN keeps the source text and these supply the en_US equivalents.
EN_ENTITY = {
    "rabbit_wizard": "Rabbit Wizard", "shielding_ring": "Shielding Ring", "scarecrow": "Scarecrow",
    "basaltmite": "Basaltmite", "silverfish": "Silverfish Maiden", "piglin_royal": "Piglin Royal",
    "piglin_throneroom_spawner": "Piglin Throne Room Spawner", "gilded_basaltmite": "Gilded Basaltmite",
    "piglin_royal_spawner": "Piglin Royal Spawner", "zombie": "Starved", "vinemaiden": "Vinemaiden",
    "piglin_royal_knight": "Piglin Royal Knight", "binding_ring": "Binding Ring", "vinemaiden_seedling": "Vinemaiden Seedling",
}
EN_EFFECT = {
    "regurgitation_armor": "Regurgitation Armor", "acid_resistance": "Acid Resistance", "softened": "Softened",
    "delectable_scent": "Delectable Scent", "visual_fx": "Visual FX", "warded": "Warded",
    "regurgitation_stench": "Regurgitation Stench", "rotten_stench": "Rotten Stench",
    "regurgitation_sickness": "Regurgitation Sickness", "shielded": "Shielded", "neutralized_acids": "Neutralized Acids",
    "rabbit_marked": "Rabbit Marked", "glowberry_high": "Glowberry High", "play_sound": "Play Sound",
    "piglins_decree": "Piglin's Decree", "bound": "Bound", "bloodlust": "Bloodlust", "carbonated": "Carbonated",
}
EN_BLOCK = {
    "soul_jack_o_lantern": "Soul Jack o'Lantern", "glowberry_fermentation_barrel": "Glowberry Fermentation Barrel",
    "piglin_throne_2": "Piglin Throne", "piglin_throne_1": "Piglin Throne",
}
EN_ITEM = {
    "shielding_ring_spawn_egg": "Shielding Ring Spawn Egg", "scarecrow_spawn_egg": "Scarecrow Spawn Egg",
    "neutralizing_water": "Neutralizing Water", "debugging_item": "Debug Item",
    "netherite_piglin_armor_kit": "Netherite Piglin Armor Kit", "piglin_royal_talisman": "Piglin Royal Talisman",
    "bejeweled_upgrade_kit": "Bejeweled Upgrade Kit", "rabbit_staff_gold": "Rabbit Staff",
    "piglin_might_talisman": "Piglin Might Talisman", "golden_piglin_armor_kit": "Golden Piglin Armor Kit",
    "pred_guidebook_item": "Predator Guidebook", "peculiar_mirror": "Peculiar Mirror",
    "fermented_glowberry_juice_bottle": "Fermented Glowberry Juice Bottle",
    "piglin_royal_knight_spawn_egg": "Piglin Royal Knight Spawn Egg", "rabbit_staff": "Rabbit Staff",
    "rabbit_wizard_spawn_egg": "Rabbit Wizard Spawn Egg", "silverfish_plating_boots": "Silverfish Maiden Plating Boots",
    "hyperdense_porkchop": "Hyperdense Porkchop", "glowberry_juice_bottle": "Glowberry Juice Bottle",
    "gilded_shield": "Gilded Shield", "cupids_arrow": "Cupid's Arrow", "binding_ring_spawn_egg": "Binding Ring Spawn Egg",
    "silverfish_plate": "Silverfish Maiden Plate", "sugar_neutralizing_water": "Sugar Neutralizing Water",
    "carbonated_water_bottle": "Carbonated Water Bottle", "piglin_royal_spawn_egg": "Piglin Royal Spawn Egg",
    "silverfish_plating_helmet": "Silverfish Maiden Plating Helmet", "vibrant_elixir": "Vibrant Elixir",
    "gilded_basaltmite_spawn_egg": "Gilded Basaltmite Spawn Egg", "silverfish_plating_leggings": "Silverfish Maiden Plating Leggings",
    "basaltmite_plated_soles": "Basaltmite Plated Soles", "zombie_spawn_egg": "Starved Spawn Egg",
    "gilded_basaltmite_scale": "Gilded Basaltmite Scale", "vinemaiden_seedling_spawn_egg": "Vinemaiden Seedling Spawn Egg",
    "golden_bone_meal": "Golden Bone Meal", "basaltmite_spawn_egg": "Basaltmite Spawn Egg",
    "silverfish_spawn_egg": "Silverfish Maiden Spawn Egg", "basaltmite_scale": "Basaltmite Scale",
    "sugar_glass_bottle": "Sugar Glass Bottle", "vinemaiden_spawn_egg": "Vinemaiden Spawn Egg",
    "attuned_binding_ring": "Attuned Binding Ring", "silverfish_plating_chestplate": "Silverfish Maiden Plating Chestplate",
    "rabbit_staff_bloodlust": "Rabbit Staff",
}
EN_DEATH = {
    "death.attack.digestion.item": "%1 was digested by %2's writhing stomach walls while holding %3",
    "death.attack.digestion.player": "%1 couldn't escape %2's slick, wet, soft stomach",
    "death.attack.digestion": "%1 sank into %2's soft stomach...",
}
EN_SUBTITLE = {
    "subtitles.burp": "Burp",
    "subtitles.gurgle": "Stomach Gurgle",
    "subtitles.large_gurgle": "Large Stomach Gurgle",
    "subtitles.large_squelch": "Large Stomach Squelch",
    "subtitles.slosh": "Stomach Slosh",
    "subtitles.swallow": "Swallow",
}


# The localised source occasionally carries a stray trailing quote; the zombie
# and silverfish were renamed in-game (饿殍 / 蠹虫娘), so normalise those too.
def lang_value(v) -> str:
    s = str(v).strip()
    s = re.sub(r"['\"]+$", "", s).strip()
    s = re.sub(r"吞食蠹虫|蠹虫", "蠹虫娘", s)
    s = re.sub(r"吞食僵尸|僵尸", "饿殍", s)
    return s


def gen_lang() -> None:
    en = read_json(SRC_ASSETS / "lang" / "en_us.json")
    bp_en = []
    bp_zh = []
    rp_en = []
    rp_zh = []

    def emit(lines, k, v):
        lines.append(f"{k}={v}")

    for k, v in en.items():
        cv = lang_value(v)
        if k.startswith("item.pcraftrevorn."):
            n = k[len("item.pcraftrevorn."):]
            ev = EN_ITEM.get(n) or cv
            emit(bp_en, f"item.pcraftrevorn:{n}", ev)
            emit(bp_zh, f"item.pcraftrevorn:{n}", cv)
            emit(bp_en, f"item.pcraftrevorn:{n}.name", ev)
            emit(bp_zh, f"item.pcraftrevorn:{n}.name", cv)
            if n.endswith("_spawn_egg"):
                sk = f"item.spawn_egg.entity.pcraftrevorn:{n[:-len('_spawn_egg')]}.name"
                emit(bp_en, sk, ev)
                emit(bp_zh, sk, cv)
        elif k.startswith("entity.pcraftrevorn."):
            n = k[len("entity.pcraftrevorn."):]
            emit(bp_en, f"entity.pcraftrevorn:{n}.name", EN_ENTITY.get(n) or cv)
            emit(bp_zh, f"entity.pcraftrevorn:{n}.name", cv)
        elif k.startswith("block.pcraftrevorn."):
            n = k[len("block.pcraftrevorn."):]
            ev = EN_BLOCK.get(n) or cv
            emit(bp_en, f"tile.pcraftrevorn:{n}.name", ev)
            emit(bp_zh, f"tile.pcraftrevorn:{n}.name", cv)
            emit(bp_en, f"tile.pcraftrevorn:{n}", ev)
            emit(bp_zh, f"tile.pcraftrevorn:{n}", cv)
        elif k.startswith("subtitles."):
            emit(rp_en, k, EN_SUBTITLE.get(k) or cv)
            emit(rp_zh, k, cv)
        elif k.startswith("death.attack."):
            dv = cv.replace("%1$s", "%1").replace("%2$s", "%2").replace("%3$s", "%3")
            emit(bp_en, k, EN_DEATH.get(k) or dv)
            emit(bp_zh, k, dv)
        elif k.startswith("effect.pcraftrevorn."):
            n = k[len("effect.pcraftrevorn."):]
            emit(bp_en, k, EN_EFFECT.get(n) or cv)
            emit(bp_zh, k, cv)  # consumed by scripts later
    header = "# Generated from PCraftRevorn 3.1.1 (author: MysticSummoner)\n"
    write_text(BP / "texts" / "en_US.lang", header + "\n".join(sorted(bp_en)) + "\n")
    write_text(BP / "texts" / "zh_CN.lang", header + "\n".join(sorted(bp_zh)) + "\n")
    write_text(RP / "texts" / "en_US.lang", header + "\n".join(sorted(rp_en)) + "\n")
    write_text(RP / "texts" / "zh_CN.lang", header + "\n".join(sorted(rp_zh)) + "\n")
    # register the locales the pack ships
    langs = json.dumps(["en_US", "zh_CN"], separators=(",", ":"))
    write_text(RP / "texts" / "languages.json", langs)
    write_text(BP / "texts" / "languages.json", langs)


# ---------------------------------------------------------------- assets
def gen_assets() -> None:
    # item textures
    for row in ITEMS:
        name = row[0]
        tex = row[1]
        vanilla_tex = row[5] if len(row) > 5 else None
        if vanilla_tex:
            continue
        src = SRC_ASSETS / "textures" / "item" / (tex + ".png")
        if exists(src):
            copy(src, RP / "textures" / "items" / "pcraftrevorn" / (tex + ".png"))
    # block textures
    for file, relval in BLOCK_TEX.items():
        if not relval.startswith("blocks/pcraftrevorn/"):
            continue
        src = SRC_ASSETS / "textures" / "block" / (file + ".png")
        if exists(src):
            copy(src, RP / "textures" / "blocks" / "pcraftrevorn" / (file + ".png"))
    # pumpkin textures used by soul jack o lantern come from vanilla; also copy our soul front already done.
    # armor textures
    for t in ["silverfish_plating__layer_1", "silverfish_plating__layer_2"]:
        src = SRC_ASSETS / "textures" / "models" / "armor" / (t + ".png")
        if exists(src):
            copy(src, RP / "textures" / "models" / "armor" / (t.replace("__", "_") + ".png"))
    # sounds
    sound_defs = {"format_version": "1.14.0", "sound_definitions": {}}
    sound_dir = SRC_ASSETS / "sounds"
    if exists(sound_dir):
        for f in os.listdir(sound_dir):
            if not f.endswith(".ogg"):
                continue
            copy(sound_dir / f, RP / "sounds" / "pcraftrevorn" / f)
        src_sounds = read_json(SRC_ASSETS / "sounds.json")
        for name, defn in src_sounds.items():
            d = {"category": "neutral"}
            if "subtitle" in defn:
                d["subtitle"] = defn["subtitle"]
            d["sounds"] = [
                {"name": "sounds/pcraftrevorn/" + s["name"].split(":")[-1], "stream": bool(s.get("stream"))}
                for s in defn["sounds"]
            ]
            sound_defs["sound_definitions"]["pcraftrevorn." + name] = d
    # Replace the vanilla zombie sounds with the mod's (female) ones. A custom
    # sound_definitions.json overrides the vanilla events of the same name.
    z_dir = MOD / "assets" / "minecraft" / "sounds" / "mob" / "zombie"
    if exists(z_dir):
        for f in os.listdir(z_dir):
            if f.endswith(".ogg"):
                copy(z_dir / f, RP / "sounds" / "mob" / "zombie" / f)
        zmap = {
            "mob.zombie.say": ["say1", "say2", "say3"],
            "mob.zombie.hurt": ["hurt1", "hurt2"],
            "mob.zombie.death": ["death"],
        }
        for ev, files in zmap.items():
            sound_defs["sound_definitions"][ev] = {
                "category": "hostile",
                "sounds": [{"name": "sounds/mob/zombie/" + n} for n in files],
            }
    write_json(RP / "sounds" / "sound_definitions.json", sound_defs)


# ---------------------------------------------------------------- manifests
UUID = {
    "bpHeader": "b6f5c2a1-7d3e-4a91-9c2f-1a2b3c4d5e6f",
    "bpData": "c7e6d3b2-8e4f-4ba2-8d3e-2b3c4d5e6f70",
    "bpScript": "d8f7e4c3-9f50-4cb3-9e4f-3c4d5e6f7081",
    "rpHeader": "e9a8f5d4-a061-4dc4-af50-4d5e6f708192",
    "rpRes": "fab9a6e5-b172-4ed5-b061-5e6f70819203",
}
# Build version: date-based beta. Bedrock v2 manifests require an integer triple,
# so "261010-beta-1" is encoded as [261002, 0, 1] with the label kept in the name.
PACK_VERSION = [261010, 0, 1]


def gen_manifests() -> None:
    write_json(BP / "manifest.json", {
        "format_version": 2,
        "header": {"name": "PCraftRevorn §2砂墨§r §7· 261010-beta-1", "description": "荒野里多了一群把你当点心的新邻居。带上指南书，看清谁在盯着你——再决定是喂熟它，还是喂饱它。", "uuid": UUID["bpHeader"], "version": PACK_VERSION, "min_engine_version": [1, 21, 100]},
        "modules": [
            {"type": "data", "uuid": UUID["bpData"], "version": PACK_VERSION},
            {"type": "script", "language": "javascript", "uuid": UUID["bpScript"], "entry": "scripts/main.js", "version": PACK_VERSION},
        ],
        "dependencies": [
            {"uuid": UUID["rpHeader"], "version": PACK_VERSION},
            {"module_name": "@minecraft/server", "version": "2.0.0"},
            {"module_name": "@minecraft/server-ui", "version": "2.0.0"},
        ],
        "metadata": {"authors": ["砂墨SandMo", "Bilibili: 砂墨", "原创: MysticSummoner"], "license": "AFL-3.0"},
    })
    write_json(RP / "manifest.json", {
        "format_version": 2,
        "header": {"name": "PCraftRevorn 资源 §2砂墨§r §7· 261010-beta-1", "description": "荒野里多了一群把你当点心的新邻居。带上指南书，看清谁在盯着你——再决定是喂熟它，还是喂饱它。", "uuid": UUID["rpHeader"], "version": PACK_VERSION, "min_engine_version": [1, 21, 100]},
        "modules": [{"type": "resources", "uuid": UUID["rpRes"], "version": PACK_VERSION}],
        "metadata": {"authors": ["砂墨SandMo", "Bilibili: 砂墨", "原创: MysticSummoner"], "license": "AFL-3.0"},
    })
    # pack icons
    icon = SRC_ASSETS / "textures" / "item" / "pred_guidebook.png"
    if exists(icon):
        copy(icon, BP / "pack_icon.png")
        copy(icon, RP / "pack_icon.png")


# ---------------------------------------------------------------- main
def main() -> None:
    if not exists(MOD):
        print("Missing .work/mod. Extract the jar first (tools/extract.ps1).", file=sys.stderr)
        sys.exit(1)
    # clean owned output so stale files never linger (keep dist.json + version variants)
    owned = [
        BP / "blocks", BP / "items", BP / "recipes",
        BP / "loot_tables", BP / "texts",
        RP / "textures" / "items" / "pcraftrevorn",
        RP / "textures" / "blocks" / "pcraftrevorn",
        RP / "textures" / "models" / "armor",
        RP / "models" / "blocks",
        RP / "sounds", RP / "texts",
    ]
    stash = _preserve_dist(owned)
    for d in owned:
        rmrf(d)
    _restore_dist(stash)
    gen_items()
    gen_potions()
    gen_blocks()
    gen_recipes()
    gen_entity_loot()
    gen_lang()
    gen_assets()
    gen_manifests()
    print("Generated behavior_pack/ and resource_pack/.")


main()
