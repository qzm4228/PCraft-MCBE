#!/usr/bin/env python3
"""Community resource-pack importer (independent creatures).

Python port of ``tools/generate_community.js``.

Reads assets copied into .work/community/<pack>/assets/pcraftrevorn and emits
full Bedrock entities for the packs classified as "new creature" (not a rework):
  zarachnus's lamia , plantPACK , CathylFunni , eeveelution (x5)

Also writes behavior_pack/scripts/pcraftrevorn/data/community.js, which the
runtime scripts merge into their registries.

Run directly:
  python tools_py/generate_community.py
"""
from __future__ import annotations

import json
import math
import re
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
    read_text,
    exists,
    rmrf,  # noqa: F401
    copy,
    rel,  # noqa: F401
)

COMM = ROOT / ".work" / "community"
BP = ROOT / "behavior_pack"
RP = ROOT / "resource_pack"

LOOP_ANIMS = {"idle", "walk", "sprint", "hidden"}

VALID_BONE = re.compile(r"^[A-Za-z][A-Za-z0-9_.]*$")
VALID_SEG = re.compile(r"^[A-Za-z][A-Za-z0-9_.]*$")
BONE_ILLEGAL = re.compile(r"[^A-Za-z0-9_.]")
BONE_START = re.compile(r"^[A-Za-z_]")


def _round(x: float) -> int:
    """Match JavaScript Math.round for the non-negative values used here."""
    return int(math.floor(x + 0.5))


# ---- PNG writer (Poké Ball spawn-egg icon) ----
def _build_crc_table():
    table = []
    for n in range(256):
        c = n
        for _ in range(8):
            c = (0xEDB88320 ^ (c >> 1)) if (c & 1) else (c >> 1)
        table.append(c & 0xFFFFFFFF)
    return table


CRC_TABLE = _build_crc_table()


def crc32(buf: bytes) -> int:
    c = 0xFFFFFFFF
    for byte in buf:
        c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >> 8)
    return (c ^ 0xFFFFFFFF) & 0xFFFFFFFF


def _png_chunk(chunk_type: str, data: bytes) -> bytes:
    length = len(data).to_bytes(4, "big")
    body = chunk_type.encode("ascii") + data
    crc = crc32(body).to_bytes(4, "big")
    return length + body + crc


def write_png(file, w: int, h: int, rgba: bytes) -> None:
    sig = bytes([137, 80, 78, 71, 13, 10, 26, 10])
    ihdr = bytearray(13)
    ihdr[0:4] = w.to_bytes(4, "big")
    ihdr[4:8] = h.to_bytes(4, "big")
    ihdr[8] = 8
    ihdr[9] = 6
    stride = w * 4
    raw = bytearray((stride + 1) * h)
    for y in range(h):
        raw[y * (stride + 1)] = 0
        raw[y * (stride + 1) + 1:y * (stride + 1) + 1 + stride] = rgba[y * stride:y * stride + stride]
    ensure_dir(Path(file).parent)
    out = (
        sig
        + _png_chunk("IHDR", bytes(ihdr))
        + _png_chunk("IDAT", zlib.compress(bytes(raw)))
        + _png_chunk("IEND", b"")
    )
    Path(file).write_bytes(out)


# ---- vanilla spawn-egg art (Java spawn_egg.png + overlay, tinted) ----
def decode_png_rgba(buf: bytes):
    if len(buf) < 8 or int.from_bytes(buf[0:4], "big") != 0x89504E47:
        return None
    off = 8
    w = h = bit = color = interlace = 0
    idat = []
    while off < len(buf):
        length = int.from_bytes(buf[off:off + 4], "big")
        typ = buf[off + 4:off + 8].decode("ascii")
        d = buf[off + 8:off + 8 + length]
        if typ == "IHDR":
            w = int.from_bytes(d[0:4], "big")
            h = int.from_bytes(d[4:8], "big")
            bit = d[8]
            color = d[9]
            interlace = d[12]
        elif typ == "IDAT":
            idat.append(d)
        elif typ == "IEND":
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
                predictor = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                v = (v + predictor) & 255
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
    return {"w": w, "h": h, "data": bytes(out)}


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


def egg_rgba(base, overlay):
    src = EGG_ART["base"]
    w, h, data = src["w"], src["h"], src["data"]
    od = EGG_ART["overlay"]["data"]
    out = bytearray(w * h * 4)
    for i in range(0, w * h * 4, 4):
        r = data[i] * base["r"] / 255
        g = data[i + 1] * base["g"] / 255
        bl = data[i + 2] * base["b"] / 255
        a = data[i + 3]
        if od[i + 3] > 0:
            oa = od[i + 3] / 255
            r = od[i] * overlay["r"] / 255 * oa + r * (1 - oa)
            g = od[i + 1] * overlay["g"] / 255 * oa + g * (1 - oa)
            bl = od[i + 2] * overlay["b"] / 255 * oa + bl * (1 - oa)
            a = max(a, od[i + 3])
        out[i] = _round(r)
        out[i + 1] = _round(g)
        out[i + 2] = _round(bl)
        out[i + 3] = a
    return {"w": w, "h": h, "data": bytes(out)}


# most frequent opaque colours of a texture (4-bit buckets), most common first
def main_colours(img):
    buckets = {}
    data = img["data"]
    for i in range(0, len(data), 4):
        if data[i + 3] < 128:
            continue
        r = data[i]
        g = data[i + 1]
        b = data[i + 2]
        key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
        e = buckets.get(key)
        if e is None:
            e = {"n": 0, "r": 0, "g": 0, "b": 0}
            buckets[key] = e
        e["n"] += 1
        e["r"] += r
        e["g"] += g
        e["b"] += b
    items = sorted(buckets.values(), key=lambda e: e["n"], reverse=True)
    return [
        {"r": _round(e["r"] / e["n"]), "g": _round(e["g"] / e["n"]), "b": _round(e["b"] / e["n"])}
        for e in items
    ]


# build a vanilla-style egg tinted with the creature texture's dominant + accent colours
def make_texture_egg(file, tex_file) -> bool:
    cols = None
    try:
        cols = main_colours(decode_png_rgba(Path(tex_file).read_bytes()))
    except Exception:
        pass
    if not EGG_ART or not cols or len(cols) == 0:
        return False
    base = cols[0]
    over = None
    for c in cols:
        if (c["r"] - base["r"]) ** 2 + (c["g"] - base["g"]) ** 2 + (c["b"] - base["b"]) ** 2 > 6000:
            over = c
            break
    if over is None:
        over = {
            "r": _round(base["r"] * 0.45),
            "g": _round(base["g"] * 0.45),
            "b": _round(base["b"] * 0.45),
        }
    res = egg_rgba(base, over)
    write_png(file, res["w"], res["h"], res["data"])
    return True


# Tracked Poké Ball sprites (from Cobblemon). Each creature can name its ball.
BALL_DIR = ROOT / "tools" / "assets" / "balls"
BALL_SRC = next(
    (
        p
        for p in (ROOT / "tools" / "assets" / "pokeball.png", ROOT / ".work" / "pokeball.png")
        if exists(p)
    ),
    None,
)


def ball_png(file, ball, size: int = 16) -> None:
    themed = None
    if ball and ball is not True and exists(BALL_DIR / (str(ball) + ".png")):
        themed = BALL_DIR / (str(ball) + ".png")
    src = themed or BALL_SRC
    if src:
        copy(src, file)
        return
    rgba = bytearray(size * size * 4)
    c = (size - 1) / 2
    R = size / 2 - 0.6
    btn_r = size * 0.21
    for y in range(size):
        for x in range(size):
            dx = x - c
            dy = y - c
            d = math.sqrt(dx * dx + dy * dy)
            o = (y * size + x) * 4
            if d > R:
                continue
            if d > R - 1.0:
                col = (20, 20, 20)                     # outline
            elif d < btn_r:
                col = (242, 242, 242)                  # button
            elif d < btn_r + 1.0:
                col = (20, 20, 20)                     # button ring
            elif abs(dy) < size * 0.10:
                col = (20, 20, 20)                     # band
            elif dy < 0:
                col = (216, 44, 44)                    # top: red
            else:
                col = (242, 242, 242)                  # bottom: white
            rgba[o] = col[0]
            rgba[o + 1] = col[1]
            rgba[o + 2] = col[2]
            rgba[o + 3] = 255
    write_png(file, size, size, bytes(rgba))


def convert_anim_object(j):
    def unwrap(v):
        if isinstance(v, dict):
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
        if isinstance(declared, bool) or declared == "hold_on_last_frame":
            anim["loop"] = declared
        else:
            anim["loop"] = name.split(".")[-1] in LOOP_ANIMS
        for bd in (anim.get("bones") or {}).values():
            for ch in ("rotation", "position", "scale"):
                if ch in bd:
                    bd[ch] = convert_channel(bd[ch])
    return j


# Bedrock bone names must be [A-Za-z_][A-Za-z0-9_.]*; community models use names
# with spaces / '&', which can make Bedrock ignore the animation. Rename the bad
# names identically in the geometry and the animation so they still match.
def sanitize_bones(geo, anim) -> int:
    g = geo["minecraft:geometry"][0]
    gb = g.get("bones") or []
    names = []
    seen = set()

    def add_name(n):
        if n not in seen:
            seen.add(n)
            names.append(n)

    for b in gb:
        add_name(b["name"])
    for a in ((anim or {}).get("animations") or {}).values():
        for k in (a.get("bones") or {}).keys():
            add_name(k)
    used = {n for n in names if VALID_BONE.match(n)}
    mapping = {}
    for n in names:
        if VALID_BONE.match(n):
            continue
        base = BONE_ILLEGAL.sub("_", str(n))
        if not BONE_START.match(base):
            base = "_" + base
        cand = base
        i = 1
        while cand in used and cand != n:
            cand = f"{base}_{i}"
            i += 1
        used.add(cand)
        mapping[n] = cand
    if not mapping:
        return 0
    for b in gb:
        if b.get("name") in mapping:
            b["name"] = mapping[b["name"]]
        if b.get("parent") and b["parent"] in mapping:
            b["parent"] = mapping[b["parent"]]
    for a in ((anim or {}).get("animations") or {}).values():
        nb = {}
        for k, v in (a.get("bones") or {}).items():
            nb[mapping.get(k, k)] = v
        a["bones"] = nb
    return len(mapping)


# base predator stats (mirrors skin/assign.js PRED_STATS)
BASE_STATS = {
    "rabbit_wizard": {"swallow": 0.15, "struggles": 11, "difficulty": 0.30, "acid": 3.2, "acidMax": 13, "acidIncr": 0.04, "wg1": 1, "wg2": 4},
    "vinemaiden": {"swallow": 0.32, "struggles": 7, "difficulty": 0.15, "acid": 3, "acidMax": 15, "acidIncr": 0.03, "wg1": 1, "wg2": 4},
    "zombie": {"swallow": 0.12, "struggles": 7, "difficulty": 0.15, "acid": 4, "acidMax": 12, "acidIncr": 0.04, "wg1": 1, "wg2": 4},
    "scarecrow": {"swallow": 0.34, "struggles": 15, "difficulty": 0.40, "acid": 2, "acidMax": 14, "acidIncr": 0.01, "wg1": 1, "wg2": 4},
    "silverfish": {"swallow": 0.30, "struggles": 7, "difficulty": 0.10, "acid": 2.2, "acidMax": 18.8, "acidIncr": 0.02, "wg1": 1, "wg2": 4},
    "piglin_royal": {"swallow": 0.30, "struggles": 13, "difficulty": 0.65, "acid": 5, "acidMax": 14.35, "acidIncr": 0.055, "wg1": 999, "wg2": 999},
}

# target families per source creature (mirrors generate_entities.TARGETS); imports
# whose base has no source data keep the port default (players + villagers)
TARGETS_BY_BASE = {
    "rabbit_wizard": ["monster", "player"],
    "vinemaiden": ["cow", "sheep", "pig", "goat", "wolf", "zombie", "pillager", "vindicator", "player"],
    "zombie": ["villager", "player"],
    "silverfish": ["player", "villager", "pillager", "vindicator", "witch"],
    "scarecrow": ["monster"],
    "piglin_royal_knight": ["monster", "player"],
}
DEFAULT_TARGETS = ["player", "villager"]

# creature specs
SKIP_BURIED = re.compile(r"_buried")
SKIP_SEEDLING = re.compile(r"_seedling")

CREATURES = [
    {"id": "cathyl_rabbit", "pack": "CathylFunni", "srcMob": "rabbit", "texBase": "cathyl_rabbit",
     "variants": [0, 1, 2], "gendered": False, "endKind": None, "counterMax": 1, "egg": "rabbit_wizard",
     "name": "哞妮", "lore": "沉稳从容的牧场大姐姐，轻声细语、气场十足。对她客气点——她可是会把你请进肚子里“做客”的。",
     "behavior": {"hp": 24, "speed": 0.25, "dmg": 3, "follow": 16, "size": [0.6, 1.8], "loot": None, "tameable": True, "baseStats": "rabbit_wizard", "undead": False}},
    {"id": "plant_maiden", "pack": "plantPACK", "srcMob": "vinemaiden", "texBase": "plant_maiden",
     "variants": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 31, 99], "gendered": False, "endKind": None, "counterMax": 1, "egg": "vinemaiden",
     "name": "猪笼草", "lore": "一株会呼吸、会埋伏的食人植物。靠近它的人，最后都成了养分。",
     "behavior": {"hp": 30, "speed": 0.3, "dmg": 5, "follow": 12, "size": [0.7, 1.9], "loot": None, "tameable": True, "baseStats": "vinemaiden", "undead": False},
     "skip": [SKIP_BURIED, SKIP_SEEDLING]},
    {"id": "lamia", "pack": "lamia", "srcMob": "zombie", "texBase": "lamia",
     "variants": [0, 1, 2, 13], "gendered": True, "endKind": "decor", "counterMax": 5, "egg": "zombie",
     "name": "拉米亚", "lore": "半人半蛇的埋伏者，最爱装饰自己的尾巴。别盯着她的花纹看太久。",
     "behavior": {"hp": 20, "speed": 0.23, "dmg": 3, "follow": 35, "size": [0.6, 1.8], "loot": "zombie", "tameable": False, "baseStats": "zombie", "undead": True}},
    {"id": "predatopia_v2", "pack": "v_predatopiaV2", "srcMob": "zombie", "texBase": "predatopia_v2",
     "variants": [0, 1, 2, 13], "gendered": True, "endKind": "decor", "counterMax": 5, "egg": "zombie",
     "name": "人鱼", "lore": "游荡在水边的人鱼掠食者。歌声很好听，下场可不太好。",
     "behavior": {"hp": 20, "speed": 0.23, "dmg": 3, "follow": 35, "size": [0.6, 1.8], "loot": "zombie", "tameable": False, "baseStats": "zombie", "undead": True}},
    {"id": "predatopia", "pack": "v_predatopiazombie", "srcMob": "zombie", "texBase": "predatopia",
     "variants": [0, 1, 2, 13], "gendered": True, "endKind": "decor", "counterMax": 5, "egg": "zombie",
     "name": "喵呜", "lore": "一只傲娇又挑食的猫系掠食者，胃口却不小。",
     "behavior": {"hp": 20, "speed": 0.23, "dmg": 3, "follow": 35, "size": [0.6, 1.8], "loot": "zombie", "tameable": False, "baseStats": "zombie", "undead": True}},
    {"id": "piglin_dragon", "pack": "piglin_dragon", "srcMob": "piglin_royal", "texBase": "piglin_dragon",
     "variants": [0], "gendered": True, "endKind": None, "counterMax": 1, "egg": "piglin_royal",
     "name": "熄", "lore": "一头脾气火爆的龙娘。谁惹她，谁就进她肚子。",
     "behavior": {"hp": 150, "speed": 0.3, "dmg": 3, "follow": 16, "size": [1.5, 3.4], "loot": "piglin_royal", "tameable": False, "baseStats": "piglin_royal", "undead": False}},
    {"id": "eevee_rabbit", "pack": "eeveelution", "srcMob": "rabbit", "texBase": "eevee_rabbit",
     "variants": [0, 1, 2], "gendered": False, "endKind": None, "counterMax": 1, "egg": "rabbit_wizard", "ball": "dream_ball",
     "name": "太阳伊布", "lore": "紫色阳光下的宝石猎人。温柔是伪装，獠牙是真的。", "behavior": {"hp": 24, "speed": 0.25, "dmg": 3, "follow": 16, "size": [0.6, 1.8], "loot": None, "tameable": True, "baseStats": "rabbit_wizard", "undead": False}},
    {"id": "eevee_scarecrow", "pack": "eeveelution", "srcMob": "scarecrow", "texBase": "eevee_scarecrow",
     "variants": [0], "gendered": True, "endKind": "health", "counterMax": 3, "egg": "scarecrow", "ball": "dive_ball",
     "name": "水伊布", "lore": "青蓝色的水畔精灵，看着无害，靠近才知道什么叫做“水很深”。", "behavior": {"hp": 50, "speed": 0.3, "dmg": 3, "follow": 64, "size": [0.8, 2.4], "loot": None, "tameable": True, "baseStats": "scarecrow", "undead": False}},
    {"id": "eevee_silverfish", "pack": "eeveelution", "srcMob": "silverfish", "texBase": "eevee_silverfish",
     "variants": [0], "gendered": True, "endKind": None, "counterMax": 1, "egg": "silverfish", "ball": "moon_ball",
     "name": "月亮伊布", "lore": "月下的黑猫精灵，安静、敏锐，专挑落单的你下手。", "behavior": {"hp": 12, "speed": 0.3, "dmg": 4, "follow": 16, "size": [0.6, 1.8], "loot": None, "tameable": False, "baseStats": "silverfish", "undead": False}},
    {"id": "eevee_vinemaiden", "pack": "eeveelution", "srcMob": "vinemaiden", "texBase": "eevee_vinemaiden",
     "variants": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 31, 99], "gendered": False, "endKind": None, "counterMax": 1, "egg": "vinemaiden", "ball": "quick_ball",
     "name": "雷伊布", "lore": "黄色电光精灵，脾气比雷还快。别惹它。", "behavior": {"hp": 30, "speed": 0.3, "dmg": 5, "follow": 12, "size": [0.7, 1.9], "loot": None, "tameable": True, "baseStats": "vinemaiden", "undead": False},
     "skip": [SKIP_BURIED, SKIP_SEEDLING]},
    {"id": "eevee_zombie", "pack": "eeveelution", "srcMob": "zombie", "texBase": "eevee_zombie",
     "variants": [0, 1, 2, 13], "gendered": True, "endKind": "decor", "counterMax": 5, "egg": "zombie", "ball": "repeat_ball",
     "name": "火伊布", "lore": "橙红色的火精灵，浑身暖烘烘——直到它决定把你当晚饭。", "behavior": {"hp": 20, "speed": 0.23, "dmg": 3, "follow": 35, "size": [0.6, 1.8], "loot": "zombie", "tameable": False, "baseStats": "zombie", "undead": True}},
]

# English display names for the community creatures (mirrors generate.js EN_* maps).
EN_COMMUNITY = {
    "cathyl_rabbit": "Moony", "plant_maiden": "Nepenthes", "lamia": "Lamia",
    "predatopia": "Meow", "predatopia_v2": "Siren", "piglin_dragon": "Extinguish",
    "eevee_rabbit": "Espeon", "eevee_scarecrow": "Vaporeon", "eevee_silverfish": "Umbreon",
    "eevee_vinemaiden": "Jolteon", "eevee_zombie": "Flareon",
}


def behavior(c, skin_max: int):
    b = c["behavior"]
    fam = [c["id"], "predator"]
    if b["undead"]:
        fam.append("undead")
    fam.append("monster")
    components = {
        "minecraft:type_family": {"family": fam},
        "minecraft:health": {"value": b["hp"], "max": b["hp"]},
        "minecraft:movement": {"value": b["speed"]},
        "minecraft:navigation.walk": {"can_path_over_water": True, "avoid_water": True},
        "minecraft:movement.basic": {}, "minecraft:jump.static": {}, "minecraft:physics": {},
        "minecraft:collision_box": {"width": b["size"][0], "height": b["size"][1]},
        "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
        "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0},
        "minecraft:nameable": {},
        "minecraft:damage_sensor": {"triggers": [{"cause": "fall", "deals_damage": False}]},
        "minecraft:attack": {"damage": b["dmg"]},
        "minecraft:follow_range": {"value": b["follow"], "max": b["follow"]},
        "minecraft:behavior.float": {"priority": 0},
        "minecraft:behavior.random_stroll": {"priority": 4, "speed_multiplier": 1},
        "minecraft:behavior.random_look_around": {"priority": 5},
    }
    if b["loot"]:
        components["minecraft:loot"] = {"table": f"loot_tables/entities/{b['loot']}.json"}
    targets = TARGETS_BY_BASE.get(b["baseStats"], DEFAULT_TARGETS)
    groups = {
        "pcraftrevorn:aggressive": {
            "minecraft:behavior.melee_attack": {"priority": 1, "speed_multiplier": 1.2},
            "minecraft:behavior.hurt_by_target": {"priority": 2},
            "minecraft:behavior.nearest_attackable_target": {
                "priority": 3, "must_see": True, "reselect_targets": True, "within_radius": b["follow"],
                "entity_types": [
                    {"filters": {"test": "is_family", "subject": "other", "value": t}, "max_dist": b["follow"]}
                    for t in targets
                ],
            },
        },
        "pcraftrevorn:prey_holder": {"minecraft:rideable": {"seat_count": 1, "family_types": ["player"], "seats": [{"position": [0, 0, 0]}]}},
    }
    events = {
        "minecraft:entity_spawned": {"add": {"component_groups": ["pcraftrevorn:aggressive"]}},
        "pcraftrevorn:on_swallow": {"remove": {"component_groups": ["pcraftrevorn:aggressive"]}, "add": {"component_groups": ["pcraftrevorn:prey_holder"]}},
        "pcraftrevorn:on_release": {"add": {"component_groups": ["pcraftrevorn:aggressive"]}, "remove": {"component_groups": ["pcraftrevorn:prey_holder"]}},
    }
    if b["tameable"]:
        components["minecraft:tameable"] = {"probability": 1, "tame_items": ["pcraftrevorn:cupids_arrow"], "tame_event": {"event": "pcraftrevorn:on_tame", "target": "self"}}
        groups["pcraftrevorn:tamed"] = {"minecraft:is_tamed": {}, "minecraft:behavior.follow_owner": {"priority": 6, "speed_multiplier": 1, "start_distance": 10, "stop_distance": 2}}
        events["pcraftrevorn:on_tame"] = {"add": {"component_groups": ["pcraftrevorn:tamed"]}}
    return {
        "format_version": "1.21.0",
        "minecraft:entity": {
            "description": {"identifier": f"{NS}:{c['id']}", "is_spawnable": True, "is_summonable": True, "properties": {f"{NS}:skin": {"type": "int", "range": [0, skin_max], "default": 0, "client_sync": True}}},
            "component_groups": groups, "components": components, "events": events,
        },
    }


def egg_png(id, egg_kind) -> None:
    src = RP / "textures" / "items" / "pcraftrevorn" / (egg_kind + "_spawn_egg.png")
    if exists(src):
        copy(src, RP / "textures" / "items" / "pcraftrevorn" / (id + "_spawn_egg.png"))


def generate_community() -> None:
    reg = {"texBase": {}, "gendered": [], "variants": {}, "endKind": {}, "animPrefix": {}, "counterMax": {}, "stats": {}, "names": {}, "lore": {}, "predatorIds": [], "skins": {}, "texMax": {}}
    atlas = read_json(RP / "textures" / "item_texture.json")
    bp_texts = [BP / "texts" / "en_US.lang", BP / "texts" / "zh_CN.lang"]
    extra_en = []
    extra_zh = []

    for c in CREATURES:
        root = COMM / c["pack"] / "assets" / "pcraftrevorn"
        if not exists(root):
            print(f"skip {c['id']}: missing {root}", file=sys.stderr)
            continue

        # geometry + animation
        geo = read_json(root / "geo" / (c["srcMob"] + ".geo.json"))
        anim = convert_anim_object(read_json(root / "animations" / (c["srcMob"] + ".animation.json")))
        sanitize_bones(geo, anim)
        geo["minecraft:geometry"][0]["description"]["identifier"] = "geometry." + c["id"]
        write_json(RP / "models" / "entity" / (c["id"] + ".geo.json"), geo)

        # rename animation identifiers; drop names illegal in Bedrock
        renamed = {}
        shorts = []
        for k, v in (anim.get("animations") or {}).items():
            short = k.split(".")[-1]
            if not VALID_SEG.match(short):
                continue
            renamed[f"animation.{c['id']}.{short}"] = v
            shorts.append(short)
        anim["animations"] = renamed
        write_json(RP / "animations" / (c["id"] + ".animation.json"), anim)

        # textures
        tex_dir = root / "textures" / "entities"
        lst = []
        for entry in tex_dir.iterdir():
            f = entry.name
            if not f.endswith(".png"):
                continue
            base = f.replace(".png", "", 1)
            if not base.startswith(c["srcMob"]):
                continue  # shared folders: only this mob's textures
            if c.get("skip") and any(r.search(base) for r in c["skip"]):
                continue
            nn = re.sub("^" + re.escape(c["srcMob"]), c["texBase"], base, count=1)
            copy(tex_dir / f, RP / "textures" / "entity" / "pcraftrevorn" / (nn + ".png"))
            lst.append(nn)
        lst.sort()
        skin_max = max(0, len(lst) - 1)

        # client entity
        textures = {}
        arr = []
        for i, n in enumerate(lst):
            textures["skin" + str(i)] = f"textures/entity/pcraftrevorn/{n}"
            arr.append("Texture.skin" + str(i))
        anim_map = {}
        for s in shorts:
            anim_map[s] = f"animation.{c['id']}.{s}"
        animate = [{"idle": "1.0 - math.min(1.0, query.modified_move_speed * 4.0)"}]
        if "walk" in shorts:
            animate.append({"walk": "math.min(1.0, query.modified_move_speed * 4.0)"})
        write_json(RP / "entity" / (c["id"] + ".entity.json"), {
            "format_version": "1.10.0",
            "minecraft:client_entity": {
                "description": {
                    "identifier": f"{NS}:{c['id']}", "min_engine_version": "1.8.0",
                    "materials": {"default": "entity_alphatest"}, "textures": textures,
                    "geometry": {"default": "geometry." + c["id"]}, "animations": anim_map,
                    "scripts": {"animate": animate}, "render_controllers": [f"controller.render.{NS}.{c['id']}"],
                    "spawn_egg": {"texture": f"{NS}_{c['id']}_spawn_egg"},
                },
            },
        })
        write_json(RP / "render_controllers" / (c["id"] + ".render_controllers.json"), {
            "format_version": "1.10.0",
            "render_controllers": {
                f"controller.render.{NS}.{c['id']}": {
                    "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
                    "arrays": {"textures": {"Array.skins": arr}},
                    "textures": [f"Array.skins[q.property('{NS}:skin')]"],
                },
            },
        })

        # behavior entity
        write_json(BP / "entities" / (c["id"] + ".json"), behavior(c, skin_max))

        # spawn egg (Poké Ball for the eeveelution reskins)
        item_id = c["id"] + "_spawn_egg"
        if c.get("ball"):
            ball_png(RP / "textures" / "items" / "pcraftrevorn" / (item_id + ".png"), c["ball"], 16)
        else:
            skin = c["texBase"] if c["texBase"] in lst else (lst[0] if lst else None)
            ok = skin and make_texture_egg(
                RP / "textures" / "items" / "pcraftrevorn" / (item_id + ".png"),
                RP / "textures" / "entity" / "pcraftrevorn" / (skin + ".png"),
            )
            if not ok:
                egg_png(c["id"], c["egg"])
        write_json(BP / "items" / (item_id + ".json"), {
            "format_version": "1.21.0",
            "minecraft:item": {
                "description": {"identifier": f"{NS}:{item_id}", "menu_category": {"category": "nature"}},
                "components": {
                    "minecraft:icon": {"textures": {"default": f"{NS}_{item_id}"}},
                    "minecraft:max_stack_size": 64,
                    "minecraft:entity_placer": {"entity": f"{NS}:{c['id']}"},
                },
            },
        })
        atlas["texture_data"][f"{NS}_{item_id}"] = {"textures": f"textures/items/pcraftrevorn/{item_id}"}
        name_en = EN_COMMUNITY.get(c["id"], c["name"])
        # Poké-Ball items are named after the Pokémon; other creatures get a spawn-egg name.
        egg_en = name_en if c.get("ball") else name_en + " Spawn Egg"
        egg_zh = c["name"] if c.get("ball") else c["name"] + "生成蛋"
        extra_en.extend([
            f"entity.{NS}:{c['id']}.name={name_en}",
            f"item.{NS}:{item_id}.name={egg_en}",
            f"item.{NS}:{item_id}={egg_en}",
            f"item.spawn_egg.entity.{NS}:{c['id']}.name={egg_en}",
        ])
        extra_zh.extend([
            f"entity.{NS}:{c['id']}.name={c['name']}",
            f"item.{NS}:{item_id}.name={egg_zh}",
            f"item.{NS}:{item_id}={egg_zh}",
            f"item.spawn_egg.entity.{NS}:{c['id']}.name={egg_zh}",
        ])

        # registry
        st = BASE_STATS[c["behavior"]["baseStats"]]
        reg["texBase"][c["id"]] = c["texBase"]
        if c["gendered"]:
            reg["gendered"].append(c["id"])
        reg["variants"][c["id"]] = c["variants"]
        if c["endKind"]:
            reg["endKind"][c["id"]] = c["endKind"]
        reg["animPrefix"][c["id"]] = c["id"]
        reg["counterMax"][c["id"]] = c["counterMax"]
        reg["stats"][c["id"]] = dict(st)
        reg["names"][c["id"]] = c["name"]
        reg["lore"][c["id"]] = c["lore"]
        reg["predatorIds"].append(c["id"])
        reg["skins"][c["id"]] = {n: i for i, n in enumerate(lst)}
        reg["texMax"][c["id"]] = skin_max

    write_text(BP / "texts" / "en_US.lang", read_text(bp_texts[0]).rstrip() + "\n" + "\n".join(extra_en) + "\n")
    write_text(BP / "texts" / "zh_CN.lang", read_text(bp_texts[1]).rstrip() + "\n" + "\n".join(extra_zh) + "\n")
    write_json(RP / "textures" / "item_texture.json", atlas)

    js = (
        "// AUTO-GENERATED by tools/generate_community.js. Community creature registries.\n"
        + "export const COMMUNITY = " + json.dumps(reg, indent=2, ensure_ascii=False) + ";\n"
    )
    write_text(BP / "scripts" / "pcraftrevorn" / "data" / "community.js", js)
    print(f"Community creatures generated: {len(reg['predatorIds'])} ({', '.join(reg['predatorIds'])})")


if __name__ == "__main__":
    generate_community()
