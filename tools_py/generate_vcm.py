"""VCM (Internalised) importer - merged into the PCraftRevorn pack pair.

Python port of ``tools/generate_vcm.js``. Reads the assets extracted from the
Forge jar (``tools/extract_vcm_assets.ps1`` -> ``.work/vcm/``) and emits the VCM
creatures, spawn eggs and registries into the PCraftRevorn packs.

The port *merges* rather than shipping a second addon:

* ids stay in the ``pcraftrevorn:`` namespace (``pcraftrevorn:bat_girl`` ...);
* the creatures ride the existing vore machinery - ``predator`` family, the
  ``pc:*`` dynamic-property state, ``assign.js`` skin/PRED_STATS lookups and the
  whole swallow/struggle/digest flow;
* the belly keeps the port-wide convention: VCM's ``<mob>texture`` (full belly)
  becomes ``<base>_belly`` and ``<mob>texturenobelly`` (empty) becomes
  ``<base>``, so ``assignSkin(pred, true)`` just works. VCM also ships separate
  ``*full`` animations for the bulge, and a client-synced
  ``pcraftrevorn:belly`` bool picks between them.

    python tools_py/generate_vcm.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    ROOT, NS, copy, exists, read_json, read_text, write_json, write_text,
)
from generate_community import (  # noqa: E402
    VALID_SEG, behavior, convert_anim_object, decode_png_rgba, egg_rgba,
    sanitize_bones, write_png,
)

BP = ROOT / "behavior_pack"
RP = ROOT / "resource_pack"
VCM = ROOT / ".work" / "vcm" / "assets" / "vcm"

# VCM's anatomy: every creature carries a Belly bone that the *full* animations
# scale, so belly state is (skin variant + _belly texture) AND (idlefull/walkfull).
# `skins` is the ordered list of (source texture stem, emitted texture stem);
# the order IS the pcraftrevorn:skin index, so never reorder an existing entry.
SKIN_IDLE = "(1.0 - math.min(1.0, query.modified_move_speed * 4.0))"
SKIN_MOVE = "math.min(1.0, query.modified_move_speed * 4.0)"
BELLY = "query.property('pcraftrevorn:belly')"
NO_BELLY = "(1.0 - query.property('pcraftrevorn:belly'))"
# VCM's slime girl keeps a numeric belly (0-3 filled belly slots) and swaps
# between idle/idle2/idle3/idle4 instead of using a *_belly texture.
BELLY_SIZE = "query.property('pcraftrevorn:belly_size')"

ANIM_BELLY = [
    ("idle", NO_BELLY + " * " + SKIN_IDLE),
    ("idlefull", BELLY + " * " + SKIN_IDLE),
    ("walk", NO_BELLY + " * " + SKIN_MOVE),
    ("walkfull", BELLY + " * " + SKIN_MOVE),
]

# VCM's own timings: 1200 tick (60 s) digestion from full acid to full, a +15
# escape score, and an attack trigger at HP <= 10. `acid` starts low and climbs
# by `acidIncr` up to `acidMax`, so 6.0/10.5/0.02 lands on ~1190 ticks to fill
# the 12000 point bar. wg 999 = never gains weight (VCM has no _wg textures).
STATS = {"swallow": 0.60, "struggles": 15, "difficulty": 0.30,
         "acid": 6.0, "acidMax": 10.5, "acidIncr": 0.02, "wg1": 999, "wg2": 999}

# VCM's girls are neutral: they hunt villagers/animals but only fight back when
# hit (the druid keeps hunting hostile monsters and ignores players entirely).
HUNT_PEACE = ["villager", "animal"]


def _stats(**over):
    s = dict(STATS)
    s.update(over)
    return s


CREATURES = [
    {
        "id": "bat_girl",
        # normal / white / black, each with VCM's *_tamed pair (swapped in by
        # assign.js from the client-synced pcraftrevorn:tamed flag)
        "src": "bat_girl", "name": "蝙蝠娘", "nameEn": "Bat Girl",
        "lore": "洞穴里的夜行小姐姐：翅膀软、心眼小，饿起来可不讲道理。",
        "egg": (-9610733, -10471161), "variants": [0, 1, 2],
        "tamedSkins": True,
        "skins": [
            ("batgirltexturenobelly", "bat_girl0"), ("batgirltexture", "bat_girl0_belly"),
            ("batgirltexturetamednobelly", "bat_girl0_tamed"), ("batgirltexturetamed", "bat_girl0_tamed_belly"),
            ("whitebatgirltexturenobelly", "bat_girl1"), ("whitebatgirltexture", "bat_girl1_belly"),
            ("whitebatgirltexturetamednobelly", "bat_girl1_tamed"), ("whitebatgirltexturetamed", "bat_girl1_tamed_belly"),
            ("blackbatgirltexturenobelly", "bat_girl2"), ("blackbatgirltexture", "bat_girl2_belly"),
            ("blackbatgirltexturetamednobelly", "bat_girl2_tamed"), ("blackbatgirltexturetamed", "bat_girl2_tamed_belly"),
        ],
        "animate": ANIM_BELLY,
        "behavior": {"hp": 20, "speed": 0.3, "dmg": 4, "follow": 32, "size": [0.35, 1.15],
                     "scale": 1.3, "loot": None, "tameable": True, "undead": False,
                     # neutral: hunts villagers/animals, only fights back when hit
                     "neutral": True, "targets": HUNT_PEACE,
                     # VCM: 20 % per interaction (feed it until it trusts you)
                     "tameProb": 0.2, "tameItems": ["pcraftrevorn:cupids_arrow"],
                     "tame": {"items": ["pcraftrevorn:cupids_arrow"], "chance": 0.2}},
        "stats": _stats(difficulty=0.30),
    },
    {
        "id": "bunny_girl", "src": "bunny", "name": "兔娘", "nameEn": "Bunny Girl",
        "lore": "精力过剩的兔子姑娘，跳得高也吃得多。别被无害的外表骗了。",
        "egg": (-1060, -1513240), "variants": [0],
        "skins": [
            ("bunnygirltexturenobelly", "bunny_girl0"), ("bunnygirltexture", "bunny_girl0_belly"),
        ],
        "animate": ANIM_BELLY,
        "behavior": {"hp": 20, "speed": 0.3, "dmg": 3, "follow": 16, "size": [0.4, 0.95],
                     "scale": 2.0, "loot": None, "tameable": False, "undead": False,
                     "neutral": True, "targets": HUNT_PEACE},
        "stats": _stats(difficulty=0.20),
    },
    {
        "id": "cat_girl", "src": "neko", "name": "猫娘", "nameEn": "Cat Girl",
        "lore": "慵懒又挑剔的猫娘：顺毛时是宝贝，炸毛时就是猎手。",
        "egg": (-2868, -12179712), "variants": [0],
        "skins": [
            ("nekotexture", "cat_girl0"), ("nekobellytexture", "cat_girl0_belly"),
        ],
        "animate": ANIM_BELLY,
        "behavior": {"hp": 20, "speed": 0.3, "dmg": 5, "follow": 16, "size": [0.4, 0.95],
                     "scale": 2.0, "loot": None, "tameable": False, "undead": False,
                     "neutral": True, "targets": HUNT_PEACE},
        "stats": _stats(difficulty=0.25),
    },
    {
        # 0 base green, 1 autumn, 2 spring, 3 winter (VCM's own order)
        "id": "druid", "src": "druid", "name": "德鲁伊", "nameEn": "Druid",
        "lore": "森林里的四季守望者。法杖一挥，叶子、花与雪都会替她说话。",
        "egg": (-131640, -16748265), "variants": [0, 1, 2, 3],
        "skins": [
            ("druidtexturenobelly", "druid0"), ("druidtexture", "druid0_belly"),
            ("autumndruidtexturenobelly", "druid1"), ("autumndruidtexture", "druid1_belly"),
            ("springdruidtexturenobelly", "druid2"), ("springdruidtexture", "druid2_belly"),
            ("winterdruidtexturenobelly", "druid3"), ("winterdruidtexture", "druid3_belly"),
        ],
        "animate": ANIM_BELLY,
        "behavior": {"hp": 20, "speed": 0.3, "dmg": 4, "follow": 16, "size": [0.4, 0.95],
                     "scale": 2.0, "loot": None, "tameable": False, "undead": False,
                     "neutral": True, "targets": ["monster"],
                     # VCM: fires on a 60 tick cooldown (3 s), 4..16 blocks out,
                     # and the projectile matches the seasonal variant
                     "shooter": ["druid_projectile", "autumn_druid_projectile",
                                 "spring_druid_projectile", "winter_druid_projectile"],
                     "shoot": {"interval": [3.0, 3.0], "radius": [4.0, 16.0]}},
        "stats": _stats(difficulty=0.35),
    },
    {
        # VCM's own lamia. The community import already owns pcraftrevorn:lamia
        # (a zombie-girl reskin), so this one keeps the _vcm suffix.
        "id": "lamia_vcm", "src": "lamia", "name": "拉米亚", "nameEn": "Lamia",
        "lore": "半人半蛇的沼泽居民。尾巴收得下你，也藏得住秘密。",
        "egg": (-13408768, -16365811), "variants": [0],
        "skins": [
            ("lamiatexturenobelly", "lamia_vcm0"), ("lamiatexture", "lamia_vcm0_belly"),
        ],
        "animate": ANIM_BELLY,
        "behavior": {"hp": 40, "speed": 0.3, "dmg": 8, "follow": 16, "size": [0.4, 0.95],
                     "scale": 2.5, "loot": None, "tameable": False, "undead": False,
                     "neutral": True, "targets": HUNT_PEACE},
        "stats": _stats(swallow=0.65, struggles=17, difficulty=0.45),
    },
    {
        # VCM's slime girl has no *_nobelly texture: her belly is numeric state
        # (DATA_BellySize + pehkui inflation) with its own idle2/3/4 animations.
        # Phase B wires the digesting idle; the numeric belly is phase D.
        "id": "slime_girl", "src": "vcmslime", "name": "史莱姆娘", "nameEn": "Slime Girl",
        "lore": "黏糊糊的史莱姆姑娘。肚子里装得下好多东西——包括你。",
        "egg": (-16724788, -16737895), "variants": [0, 1, 2, 3, 4, 5],
        "skins": [
            ("vcmslimetext", "slime_girl0"), ("vcmslimetextgreen", "slime_girl1"),
            ("vcmslime" + "textpink", "slime_girl2"), ("vcmslime" + "textpurple", "slime_girl3"),
            ("vcmslime" + "textred", "slime_girl4"), ("vcmslime" + "textyellow", "slime_girl5"),
        ],
        # no walk animation in the source (slimes slide), so the idle is not
        # movement-gated; VCM swaps idle2/3/4 in for 1/2/3 occupied belly slots
        # and pehkui-inflates, so the count comes from the client-synced
        # pcraftrevorn:belly_size property (set by assign.js).
        "bellySize": True,
        "animate": [("idle", BELLY_SIZE + " == 0 ? 1.0 : 0.0"),
                    ("idle2", BELLY_SIZE + " == 1 ? 1.0 : 0.0"),
                    ("idle3", BELLY_SIZE + " == 2 ? 1.0 : 0.0"),
                    ("idle4", BELLY_SIZE + " >= 3 ? 1.0 : 0.0")],
        "behavior": {"hp": 20, "speed": 0.3, "dmg": 6, "follow": 24, "size": [1.0, 2.0],
                     "scale": 2.0, "loot": "slime_girl", "tameable": True, "undead": False,
                     "neutral": True, "targets": HUNT_PEACE,
                     # VCM: 20 % per slime ball (the cupid arrow also works)
                     "tameProb": 0.2,
                     "tameItems": ["pcraftrevorn:cupids_arrow", "minecraft:slime_ball"],
                     "tame": {"items": ["pcraftrevorn:cupids_arrow", "minecraft:slime_ball"], "chance": 0.2}},
        "stats": _stats(difficulty=0.30),
    },
]


def _rgb(v: int) -> dict:
    """ForgeSpawnEggItem colour int -> {"r","g","b"} for egg_rgba()."""
    v &= 0xFFFFFF
    return {"r": (v >> 16) & 255, "g": (v >> 8) & 255, "b": v & 255}


def _client_entity(c: dict, skins, shorts) -> dict:
    textures, arr = {}, []
    for i, n in enumerate(skins):
        textures["skin" + str(i)] = f"textures/entity/pcraftrevorn/{n}"
        arr.append("Texture.skin" + str(i))
    anim_map = {s: f"animation.{c['id']}.{s}" for s in shorts}
    animate = [{s: m} for s, m in c["animate"] if s in anim_map]
    return {
        "format_version": "1.10.0",
        "minecraft:client_entity": {
            "description": {
                "identifier": f"{NS}:{c['id']}", "min_engine_version": "1.8.0",
                "materials": {"default": "entity_alphatest"},
                "textures": textures,
                "geometry": {"default": "geometry." + c["id"]},
                "animations": anim_map,
                "scripts": {"animate": animate},
                "render_controllers": [f"controller.render.{NS}.{c['id']}"],
                "spawn_egg": {"texture": f"{NS}_{c['id']}_spawn_egg"},
            },
        },
    }


# ---- items --------------------------------------------------------------- #
# VCM's held items: the four seasonal druid staffs share one model, the dagger
# has its own. Body damage/durability come straight off the Java items.
HELD = {
    "druidstaff": {"out": "druidstaff", "bone": "Staff"},
    "vampiricdagger": {"out": "vampiricdagger", "bone": "Knife"},
}

ITEMS = [
    {"id": "druid_staff", "src": "druidstafftexture", "name": "德鲁伊法杖", "nameEn": "Druid Staff",
     "category": "equipment", "damage": 2, "durability": 300, "cooldown": 3.0, "held": "druidstaff"},
    {"id": "autumn_druid_staff", "src": "autumndruidstafftexture", "name": "秋日德鲁伊法杖",
     "nameEn": "Autumn Druid Staff", "category": "equipment", "damage": 2, "durability": 300,
     "cooldown": 3.0, "held": "druidstaff"},
    {"id": "spring_druid_staff", "src": "springdruidstafftexture", "name": "春日德鲁伊法杖",
     "nameEn": "Spring Druid Staff", "category": "equipment", "damage": 2, "durability": 300,
     "cooldown": 3.0, "held": "druidstaff"},
    {"id": "winter_druid_staff", "src": "winterdruidstafftexture", "name": "冬日德鲁伊法杖",
     "nameEn": "Winter Druid Staff", "category": "equipment", "damage": 2, "durability": 300,
     "cooldown": 3.0, "held": "druidstaff"},
    {"id": "vampiric_dagger", "src": "vampiricdaggertexture", "name": "吸血匕首", "nameEn": "Vampiric Dagger",
     "category": "equipment", "damage": 3, "durability": 300, "cooldown": None, "held": "vampiricdagger"},
    {"id": "blood_shard", "src": "bloodshardtext", "name": "血碎片", "nameEn": "Blood Shard",
     "category": "items", "damage": None, "durability": None, "cooldown": None, "held": None},
    {"id": "slime_pearl", "src": "slimepearl", "name": "史莱姆珍珠", "nameEn": "Slime Pearl",
     "category": "items", "damage": None, "durability": None, "cooldown": None, "held": None},
]


def _gen_held_models() -> dict:
    """Convert the held-item geos/animations and emit the wield poses.

    The source geos declare a 16x16 (staff) / 32x32 (dagger) UV space while the
    art is painted at 64x64, because GeckoLib normalises UV by the declared size.
    Bedrock reads box UVs as pixels of the declared space, so the *art* is
    resampled down to the declared size rather than touching the geometry - the
    inventory icon keeps the full-resolution art.
    """
    out = {}
    for src, spec in HELD.items():
        geo = read_json(VCM / "geo" / (src + ".geo.json"))
        g = geo["minecraft:geometry"][0]
        g["description"]["identifier"] = "geometry." + spec["out"]
        write_json(RP / "models" / "entity" / (spec["out"] + ".geo.json"), geo)
        out[src] = {"out": spec["out"], "size": int(g["description"]["texture_width"])}

        anim = convert_anim_object(read_json(VCM / "animations" / (src + ".animation.json")))
        renamed = {}
        for k, v in (anim.get("animations") or {}).items():
            short = k.split(".")[-1]
            if VALID_SEG.match(short):
                renamed[f"animation.{NS}.{spec['out']}.{short}"] = v
        anim["animations"] = renamed
        write_json(RP / "animations" / (spec["out"] + ".animation.json"), anim)

    # hand poses - the staff reuses the port's existing wield values, the dagger
    # gets the same transform on its own bone
    pose = {"rotation": ["query.is_first_person ? 7 : 0", "query.is_first_person ? -29 : 0", 0],
            "position": [0, "query.is_first_person ? -2.75 : -6", "query.is_first_person ? -0.75 : 0"]}
    write_json(RP / "animations" / "vcm_held.animation.json", {
        "format_version": "1.8.0",
        "animations": {
            f"animation.{NS}.held.{spec['out']}": {"loop": True, "bones": {spec["bone"]: pose}}
            for spec in HELD.values()
        },
    })
    return out


def _resample_png(src: Path, dst: Path, size: int) -> None:
    """Box-average `src` down to `size`x`size` (nearest copy when already small)."""
    img = decode_png_rgba(src.read_bytes())
    f = (img["w"] // size) if img else 1
    if not img or f <= 1:
        copy(src, dst)
        return
    d = img["data"]
    out = bytearray(size * size * 4)
    n = f * f
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for dy in range(f):
                for dx in range(f):
                    i = ((y * f + dy) * img["w"] + (x * f + dx)) * 4
                    r += d[i]
                    g += d[i + 1]
                    b += d[i + 2]
                    a += d[i + 3]
            o = (y * size + x) * 4
            out[o] = r // n
            out[o + 1] = g // n
            out[o + 2] = b // n
            out[o + 3] = a // n
    write_png(dst, size, size, bytes(out))


def _gen_recipe() -> None:
    """VCM's dagger recipe: obsidian / 2 iron ingot / blood shard / stick."""
    write_json(BP / "recipes" / "vampiric_dagger.json", {
        "format_version": "1.20.10",
        "minecraft:recipe_shaped": {
            "description": {"identifier": f"{NS}:vampiric_dagger"},
            "tags": ["crafting_table"],
            "pattern": [" a ", "bcb", " d "],
            "key": {
                "a": {"item": "minecraft:obsidian"},
                "b": {"item": "minecraft:iron_ingot"},
                "c": {"item": f"{NS}:blood_shard"},
                "d": {"item": "minecraft:stick"},
            },
            "result": {"item": f"{NS}:vampiric_dagger", "count": 1},
            "unlock": {"context": "AlwaysUnlocked"},
        },
    })


def _gen_loot() -> None:
    """data/vcm/loot_tables/entities/slime_girl.json, translated to Bedrock."""
    write_json(BP / "loot_tables" / "entities" / "slime_girl.json", {
        "pools": [
            {"rolls": 1, "entries": [
                {"type": "item", "name": f"{NS}:slime_pearl", "weight": 1,
                 "functions": [{"function": "set_count", "count": {"min": 0, "max": 1}}]},
                # the Java table's "nothing" entry is weighted minecraft:air
                {"type": "item", "name": "minecraft:air", "weight": 5,
                 "functions": [{"function": "set_count", "count": {"min": 0, "max": 0}}]},
            ]},
            {"rolls": {"min": 1, "max": 2}, "entries": [
                {"type": "item", "name": "minecraft:slime_ball", "weight": 1,
                 "functions": [{"function": "set_count", "count": {"min": 1, "max": 2}}]},
            ]},
        ],
    })


# ---- particles ------------------------------------------------------------ #
# VCM's five particles are plain 8x8 sprites with no gravity: leaves / blossom /
# snowflake live 20+-7 ticks and roll at 0.2 rad/tick, `siphon` (the dagger's
# lifesteal swirl) only 5+-2. Java spawns them with a random direction scaled by
# `speed` (0.08 while flying, 0.3 on impact), so each particle ships twice: a
# trail emitter (VCM's 2 particles, no spread) and a burst emitter (35 at +1
# block, 0.1 spread). Java's render type decompiles to CUSTOM/NO_RENDER, so all
# five are drawn as translucent billboards here.
TRAIL_COUNT = 2
BURST_COUNT = 35

PARTICLES = [
    {"id": "leaves", "src": "leaves_particle", "life": "math.random(0.65, 1.35)",
     "spin": 11.46, "speed": 0.08, "burst_speed": 0.3},
    {"id": "autumn_leaves", "src": "autumn_leaves_particle", "life": "math.random(0.65, 1.35)",
     "spin": 11.46, "speed": 0.08, "burst_speed": 0.3},
    {"id": "spring_blossom", "src": "spring_blossom_particle", "life": "math.random(0.65, 1.35)",
     "spin": 11.46, "speed": 0.08, "burst_speed": 0.3},
    {"id": "winter_snowflake", "src": "winter_snowflake_particle", "life": "math.random(0.65, 1.35)",
     "spin": 11.46, "speed": 0.08, "burst_speed": 0.3},
    {"id": "siphon", "src": "siphon_particle", "life": "math.random(0.15, 0.35)",
     "spin": 0.0, "speed": 0.1, "burst_speed": 0.25},
]

# ---- projectiles ---------------------------------------------------------- #
# VCM's druid projectile is an AbstractArrow clone: Modelmcv is a 3x3x3 core
# with two 5x1x5 leaf plates that spin around Y / Z every tick (the loop bones
# were the reason the Java renderer exists at all). Damage 1, no knockback,
# launched from the eye (-0.1) at 5 blocks/tick with the amethyst chime.
PROJECTILES = [
    {"id": "druid_projectile", "src": "druidprojectile", "particle": "leaves",
     "name": "德鲁伊弹射物", "nameEn": "Druid Projectile"},
    {"id": "autumn_druid_projectile", "src": "autumndruidprojectile", "particle": "autumn_leaves",
     "name": "秋日德鲁伊弹射物", "nameEn": "Autumn Druid Projectile"},
    {"id": "spring_druid_projectile", "src": "springdruidprojectile", "particle": "spring_blossom",
     "name": "春日德鲁伊弹射物", "nameEn": "Spring Druid Projectile"},
    {"id": "winter_druid_projectile", "src": "winterdruidprojectile", "particle": "winter_snowflake",
     "name": "冬日德鲁伊弹射物", "nameEn": "Winter Druid Projectile"},
]

# staff item (local id) -> projectile id. VCM fires on release; Bedrock fires on
# use, which is the closest thing a hand item has.
STAFFS = {
    "druid_staff": "druid_projectile",
    "autumn_druid_staff": "autumn_druid_projectile",
    "spring_druid_staff": "spring_druid_projectile",
    "winter_druid_staff": "winter_druid_projectile",
}
STAFF_COOLDOWN = f"{NS}_druidstaff"
PROJECTILE_FAMILY = f"{NS}_druid_projectile"
# VCM's staff sound, also used by the druid's mob shots (minecraft:shooter.sound)
SHOT_SOUND = "block.amethyst_block.chime"
# 1 rad/tick in Bedrock's seconds-based animation time: 20 * (180 / pi)
SPIN_DEG = "query.anim_time * 1145.9"

# Modelmcv -> Bedrock. Java's y-down model space is flipped (Bedrock y = -java
# y) and the 22.5px "feet" offset is dropped so the leaf sits on the projectile
# origin instead of hanging below it; the per-cube 90 deg Z spin of the second
# plate is carried over (it is symmetric, so the sign does not matter).
PROJECTILE_GEO = {
    "format_version": "1.12.0",
    "minecraft:geometry": [{
        "description": {
            "identifier": f"geometry.{NS}.druidprojectile",
            "texture_width": 32, "texture_height": 32,
            "visible_bounds_width": 1, "visible_bounds_height": 1.5,
            "visible_bounds_offset": [0, 0.25, 0],
        },
        "bones": [
            {"name": "Projectile", "pivot": [0, 0, 0],
             "cubes": [{"origin": [-1.5, -1.5, -1.5], "size": [3, 3, 3], "uv": [0, 14]}]},
            {"name": "Loop1", "parent": "Projectile", "pivot": [0, 0, 0],
             "cubes": [{"origin": [-2.5, -0.5, -2.5], "size": [5, 1, 5], "uv": [0, 0]}]},
            {"name": "Loop2", "parent": "Projectile", "pivot": [0, 0, 0],
             "cubes": [{"origin": [-2.5, -0.5, -2.6], "size": [5, 1, 5], "uv": [0, 7],
                        "rotation": [0, 0, 90], "pivot": [0, 0, 0]}]},
        ],
    }],
}


# ---- natural spawns (VCM's data/vcm/forge/biome_modifier) ----------------- #
# Five biome modifiers: bat_girl in the dripstone/lush caves (VCM also lists the
# dark forest, kept as a dark surface condition), bunny/cat/lamia anywhere in
# the overworld, slime_girl in swamps 1-4 at a time. VCM's MONSTER-category ones
# keep the vanilla dark requirement; its CREATURE ones may spawn in daylight.
# The druid has no biome modifier in VCM and stays spawn-egg only.
SPAWNS = [
    {"id": "bat_girl", "weight": 10, "min": 1, "max": 1, "pop": "ambient",
     "conds": [{"underground": True, "maxLight": 7}, {"surface": True, "maxLight": 7}]},
    {"id": "bunny_girl", "weight": 5, "min": 1, "max": 1, "pop": "monster",
     "conds": [{"surface": True, "maxLight": 7}]},
    {"id": "cat_girl", "weight": 10, "min": 1, "max": 1, "pop": "monster",
     "conds": [{"surface": True, "maxLight": 15}]},
    {"id": "lamia_vcm", "weight": 20, "min": 1, "max": 1, "pop": "monster",
     "conds": [{"surface": True, "maxLight": 7}]},
    {"id": "slime_girl", "weight": 20, "min": 1, "max": 4, "pop": "monster",
     "conds": [{"surface": True, "maxLight": 15, "tags": ["swamp", "mangrove_swamp"]}]},
]


def _gen_spawn_rules() -> None:
    """VCM's biome modifiers as Bedrock spawn rules (see SPAWNS)."""
    for r in SPAWNS:
        conds = []
        for c in r["conds"]:
            cond = {
                "minecraft:difficulty_filter": {"min": "easy", "max": "hard"},
                "minecraft:brightness_filter": {"min": 0, "max": c["maxLight"],
                                                "adjust_for_weather": False},
                "minecraft:weight": {"default": r["weight"]},
                "minecraft:herd": {"min_size": r["min"], "max_size": r["max"]},
            }
            if c.get("underground"):
                cond["minecraft:spawns_underground"] = {}
            else:
                cond["minecraft:spawns_on_surface"] = {}
            if c.get("tags"):
                cond["minecraft:biome_filter"] = {"any_of": [
                    {"test": "has_biome_tag", "operator": "==", "value": t}
                    for t in c["tags"]]}
            else:
                cond["minecraft:biome_filter"] = {"test": "has_biome_tag",
                                                  "operator": "==", "value": "overworld"}
            conds.append(cond)
        write_json(BP / "spawn_rules" / (r["id"] + ".json"), {
            "format_version": "1.8.0",
            "minecraft:spawn_rules": {
                "description": {"identifier": f"{NS}:{r['id']}", "population_control": r["pop"]},
                "conditions": conds,
            },
        })


def _particle_effect(pid: str, texture: str, count: int, speed: float, life: str,
                     spin: float, spread: float) -> dict:
    """Build one Bedrock particle_effect (trail when spread==0, burst otherwise)."""
    shape = {"direction": ["math.random(-1, 1)", "math.random(-1, 1)", "math.random(-1, 1)"]}
    if spread:
        shape["offset"] = [f"math.random(-{spread}, {spread})"] * 3
    comps = {
        "minecraft:emitter_local_space": {"position": False, "rotation": False, "velocity": False},
        "minecraft:emitter_rate_instant": {"num_particles": count},
        "minecraft:emitter_lifetime_once": {"active_time": 0.0},
        "minecraft:emitter_shape_point": shape,
        "minecraft:particle_initial_speed": speed,
        "minecraft:particle_lifetime_expression": {"max_lifetime": life},
        "minecraft:particle_motion_dynamic": {"linear_acceleration": [0, 0, 0],
                                              "linear_drag_coefficient": 0.02},
        "minecraft:particle_motion_collision": {"coefficient_of_restitution": 0.0,
                                                "collision_drag": 1.0,
                                                "collision_radius": 0.1,
                                                "collisions_per_second": 20.0},
        "minecraft:particle_appearance_billboard": {
            "size": [0.2, 0.2], "facing_camera_mode": "lookat_xyz",
            "uv": {"texture_width": 8, "texture_height": 8, "uv": [0, 0], "uv_size": [8, 8]},
        },
        "minecraft:particle_appearance_lighting": {},
    }
    if spin:
        comps["minecraft:particle_initial_spin"] = {"rotation": "math.random(0, 360)",
                                                    "rotation_rate": spin}
    return {
        "format_version": "1.10.0",
        "particle_effect": {
            "description": {"identifier": f"{NS}:{pid}",
                            "basic_render_parameters": {"material": "particles_alpha",
                                                        "texture": texture}},
            "components": comps,
        },
    }


def _gen_particles() -> dict:
    """Emit the five VCM particles: sprite, trail emitter and burst emitter."""
    out = {}
    dst = RP / "textures" / "particle" / "pcraftrevorn"
    for p in PARTICLES:
        pid = p["id"]
        copy(VCM / "textures" / "particle" / (p["src"] + ".png"), dst / (pid + ".png"))
        tex = f"textures/particle/pcraftrevorn/{pid}"
        write_json(RP / "particles" / (pid + ".particle.json"),
                   _particle_effect(pid, tex, TRAIL_COUNT, p["speed"], p["life"], p["spin"], 0.0))
        write_json(RP / "particles" / (pid + "_burst.particle.json"),
                   _particle_effect(pid + "_burst", tex, BURST_COUNT, p["burst_speed"],
                                    p["life"], p["spin"], 0.1))
        out[pid] = {"trail": f"{NS}:{pid}", "burst": f"{NS}:{pid}_burst",
                    "texture": tex, "count": TRAIL_COUNT, "burstCount": BURST_COUNT}
    return out


def _gen_projectiles(extra_en: list, extra_zh: list) -> dict:
    """Emit the four seasonal druid projectiles (geo, spin, client + server entity)."""
    write_json(RP / "models" / "entity" / "druidprojectile.geo.json", PROJECTILE_GEO)
    write_json(RP / "animations" / "druidprojectile.animation.json", {
        "format_version": "1.8.0",
        "animations": {f"animation.{NS}.druidprojectile.spin": {
            "loop": True,
            "bones": {"Projectile": {"rotation": [0, SPIN_DEG, 0]},
                      "Loop1": {"rotation": [0, SPIN_DEG, 0]},
                      "Loop2": {"rotation": [0, 0, SPIN_DEG]}},
        }},
    })
    write_json(RP / "render_controllers" / "vcm_projectiles.render_controllers.json", {
        "format_version": "1.10.0",
        "render_controllers": {f"controller.render.{NS}.druid_projectile": {
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
            "textures": ["Texture.default"]}},
    })

    out = {}
    for p in PROJECTILES:
        pid = p["id"]
        # the geo declares a 32x32 UV space, the art is painted at 64x64 (same
        # GeckoLib/Blockbench oversampling as the held items) -> resample
        _resample_png(VCM / "textures" / "entities" / (p["src"] + ".png"),
                      RP / "textures" / "entity" / "pcraftrevorn" / (pid + ".png"), 32)
        write_json(RP / "entity" / (pid + ".entity.json"), {
            "format_version": "1.10.0",
            "minecraft:client_entity": {
                "description": {
                    "identifier": f"{NS}:{pid}", "min_engine_version": "1.8.0",
                    "materials": {"default": "entity_alphatest"},
                    "textures": {"default": f"textures/entity/pcraftrevorn/{pid}"},
                    "geometry": {"default": f"geometry.{NS}.druidprojectile"},
                    "animations": {"spin": f"animation.{NS}.druidprojectile.spin"},
                    "scripts": {"animate": [{"spin": "1.0"}]},
                    "render_controllers": [f"controller.render.{NS}.druid_projectile"],
                },
            },
        })
        write_json(BP / "entities" / (pid + ".json"), {
            "format_version": "1.21.0",
            "minecraft:entity": {
                "description": {"identifier": f"{NS}:{pid}", "is_spawnable": False,
                                "is_summonable": True},
                "components": {
                    "minecraft:collision_box": {"width": 0.5, "height": 0.5},
                    "minecraft:type_family": {"family": [PROJECTILE_FAMILY]},
                    "minecraft:projectile": {
                        "on_hit": {
                            "impact_damage": {"damage": 1, "knockback": False,
                                              "destroy_on_hit": True},
                        },
                        "power": 5.0, "gravity": 0.05, "inertia": 0.99,
                        "liquid_inertia": 0.6, "anchor": 1, "offset": [0, -0.1, 0],
                        "uncertainty_base": 0, "uncertainty_multiplier": 0,
                        "shoot_target": True,
                    },
                    "minecraft:physics": {},
                    "minecraft:pushable": {"is_pushable": False, "is_pushable_by_piston": False},
                },
            },
        })
        extra_en.append(f"entity.{NS}:{pid}.name={p['nameEn']}")
        extra_zh.append(f"entity.{NS}:{pid}.name={p['name']}")
        out[pid] = {"particle": p["particle"], "texture": f"textures/entity/pcraftrevorn/{pid}"}
    return out


def generate_vcm() -> None:
    reg = {"texBase": {}, "gendered": [], "variants": {}, "endKind": {}, "animPrefix": {},
           "counterMax": {}, "stats": {}, "names": {}, "lore": {}, "predatorIds": [],
           "skins": {}, "texMax": {}, "shooter": {}, "tamedSkins": [],
           "tame": {}, "neutral": []}
    atlas = read_json(RP / "textures" / "item_texture.json")
    bp_texts = [BP / "texts" / "en_US.lang", BP / "texts" / "zh_CN.lang"]
    extra_en, extra_zh = [], []
    out_dir = RP / "textures" / "entity" / "pcraftrevorn"

    for c in CREATURES:
        cid = c["id"]
        geo_path = VCM / "geo" / (c["src"] + ".geo.json")
        anim_path = VCM / "animations" / (c["src"] + ".animation.json")
        if not exists(geo_path) or not exists(anim_path):
            print(f"skip {cid}: run tools/extract_vcm_assets.ps1 first", file=sys.stderr)
            continue

        # geometry + animation (GeckoLib -> Bedrock, identifiers renamed)
        geo = read_json(geo_path)
        anim = convert_anim_object(read_json(anim_path))
        sanitize_bones(geo, anim)
        geo["minecraft:geometry"][0]["description"]["identifier"] = "geometry." + cid
        write_json(RP / "models" / "entity" / (cid + ".geo.json"), geo)
        renamed, shorts = {}, []
        for k, v in (anim.get("animations") or {}).items():
            short = k.split(".")[-1]
            if not VALID_SEG.match(short):
                continue
            renamed[f"animation.{cid}.{short}"] = v
            shorts.append(short)
        anim["animations"] = renamed
        write_json(RP / "animations" / (cid + ".animation.json"), anim)

        # textures: VCM stem -> emitted stem; the order fixes the skin index
        skins = []
        for src_stem, out_stem in c["skins"]:
            src_png = VCM / "textures" / "entities" / (src_stem + ".png")
            if not exists(src_png):
                print(f"warning: {cid}: missing texture {src_stem}.png", file=sys.stderr)
                continue
            copy(src_png, out_dir / (out_stem + ".png"))
            skins.append(out_stem)
        skin_max = max(0, len(skins) - 1)

        write_json(RP / "entity" / (cid + ".entity.json"), _client_entity(c, skins, shorts))
        write_json(RP / "render_controllers" / (cid + ".render_controllers.json"), {
            "format_version": "1.10.0",
            "render_controllers": {
                f"controller.render.{NS}.{cid}": {
                    "geometry": "Geometry.default",
                    "materials": [{"*": "Material.default"}],
                    "arrays": {"textures": {"Array.skins": ["Texture.skin" + str(i) for i in range(len(skins))]}},
                    "textures": [f"Array.skins[q.property('{NS}:skin')]"],
                },
            },
        })

        # behavior entity: the community predator plus a client-synced belly flag
        # (picks the *_full animations) and VCM's render scale.
        ent = behavior(c, skin_max)
        ent["minecraft:entity"]["description"]["properties"][f"{NS}:belly"] = {
            "type": "bool", "default": False, "client_sync": True,
        }
        # VCM's slime girl tracks 0-3 occupied belly slots and swaps idle2/3/4;
        # assign.js computes the count from the port's belly storage.
        if c.get("bellySize"):
            ent["minecraft:entity"]["description"]["properties"][f"{NS}:belly_size"] = {
                "type": "int", "range": [0, 3], "default": 0, "client_sync": True,
            }
        # *_tamed skins: the shared tameable event adds the tamed group, mirror
        # the state into a client-synced flag that assign.js reads for the skin.
        if c.get("tamedSkins"):
            body = ent["minecraft:entity"]
            body["description"]["properties"][f"{NS}:tamed"] = {
                "type": "bool", "default": False, "client_sync": True,
            }
            body["events"].setdefault(f"{NS}:on_tame", {})["set_property"] = {f"{NS}:tamed": True}
            reg["tamedSkins"].append(cid)
        if c["behavior"].get("scale"):
            ent["minecraft:entity"]["components"]["minecraft:scale"] = {"value": c["behavior"]["scale"]}
        # VCM's druid is the only ranged creature: one shooter component group per
        # season, switched by assign.js from the skin index, plus a 60 tick
        # ranged_attack that only fires at 4..16 blocks (VCM's staff cooldown).
        if c["behavior"].get("shooter"):
            body = ent["minecraft:entity"]
            ids = c["behavior"]["shooter"]
            shoot = c["behavior"]["shoot"]
            for i, pid in enumerate(ids):
                body["component_groups"][f"{NS}:shooter{i}"] = {"components": {
                    "minecraft:shooter": {"def": f"{NS}:{pid}", "sound": SHOT_SOUND}}}
                body["events"][f"{NS}:shooter{i}"] = {
                    "add": {"component_groups": [f"{NS}:shooter{i}"]},
                    "remove": {"component_groups": [f"{NS}:shooter{j}"
                                                    for j in range(len(ids)) if j != i]},
                }
            body["components"]["minecraft:shooter"] = {"def": f"{NS}:{ids[0]}", "sound": SHOT_SOUND}
            body["components"]["minecraft:behavior.ranged_attack"] = {
                "priority": 2, "speed_multiplier": 1.0,
                "attack_interval_min": shoot["interval"][0],
                "attack_interval_max": shoot["interval"][1],
                "attack_radius": shoot["radius"][1],
                "attack_radius_min": shoot["radius"][0],
            }
            reg["shooter"][cid] = [f"{NS}:{p}" for p in ids]
        # guide data: who is neutral, who can be tamed and with what
        if c["behavior"].get("neutral"):
            reg["neutral"].append(cid)
        if c["behavior"].get("tame"):
            reg["tame"][cid] = dict(c["behavior"]["tame"])
        write_json(BP / "entities" / (cid + ".json"), ent)

        # spawn egg - tinted from the ForgeSpawnEggItem colours so it matches Java
        item_id = cid + "_spawn_egg"
        img = egg_rgba(_rgb(c["egg"][0]), _rgb(c["egg"][1]))
        write_png(RP / "textures" / "items" / "pcraftrevorn" / (item_id + ".png"),
                  img["w"], img["h"], img["data"])
        write_json(BP / "items" / (item_id + ".json"), {
            "format_version": "1.21.0",
            "minecraft:item": {
                "description": {"identifier": f"{NS}:{item_id}", "menu_category": {"category": "nature"}},
                "components": {
                    "minecraft:icon": {"textures": {"default": f"{NS}_{item_id}"}},
                    "minecraft:max_stack_size": 64,
                    "minecraft:entity_placer": {"entity": f"{NS}:{cid}"},
                },
            },
        })
        atlas["texture_data"][f"{NS}_{item_id}"] = {"textures": f"textures/items/pcraftrevorn/{item_id}"}
        extra_en.extend([
            f"entity.{NS}:{cid}.name={c['nameEn']}",
            f"item.{NS}:{item_id}.name={c['nameEn']} Spawn Egg",
            f"item.{NS}:{item_id}={c['nameEn']} Spawn Egg",
            f"item.spawn_egg.entity.{NS}:{cid}.name={c['nameEn']} Spawn Egg",
        ])
        extra_zh.extend([
            f"entity.{NS}:{cid}.name={c['name']}",
            f"item.{NS}:{item_id}.name={c['name']}生成蛋",
            f"item.{NS}:{item_id}={c['name']}生成蛋",
            f"item.spawn_egg.entity.{NS}:{cid}.name={c['name']}生成蛋",
        ])

        reg["texBase"][cid] = cid
        reg["variants"][cid] = c["variants"]
        reg["animPrefix"][cid] = cid
        reg["counterMax"][cid] = 1
        reg["stats"][cid] = dict(c["stats"])
        reg["names"][cid] = c["name"]
        reg["lore"][cid] = c["lore"]
        reg["predatorIds"].append(cid)
        reg["skins"][cid] = {n: i for i, n in enumerate(skins)}
        reg["texMax"][cid] = skin_max

    # ---- items, held models, recipe, loot ---- #
    held = _gen_held_models()
    _gen_recipe()
    _gen_loot()
    rc = {}
    for it in ITEMS:
        iid = it["id"]
        src_png = VCM / "textures" / "item" / (it["src"] + ".png")
        copy(src_png, RP / "textures" / "items" / "pcraftrevorn" / (iid + ".png"))
        tex = iid
        if it["held"]:
            # The geo's UV space is 1/4 (staff) or 1/2 (dagger) of the painted
            # art, so the model texture is resampled to the declared size while
            # the inventory icon keeps the full-resolution original.
            tex = iid + "_model"
            _resample_png(src_png, RP / "textures" / "items" / "pcraftrevorn" / (tex + ".png"),
                          held[it["held"]]["size"])
        components = {
            "minecraft:icon": {"textures": {"default": f"{NS}_{iid}"}},
            "minecraft:max_stack_size": 1 if it["held"] else 64,
        }
        if it["held"]:
            components["minecraft:hand_equipped"] = True
        if it["damage"]:
            components["minecraft:damage"] = it["damage"]
        if it["durability"]:
            components["minecraft:durability"] = {"max_durability": it["durability"]}
        if it["cooldown"]:
            components["minecraft:cooldown"] = {
                "category": f"{NS}_{it['held']}", "duration": it["cooldown"]}
        write_json(BP / "items" / (iid + ".json"), {
            "format_version": "1.21.0",
            "minecraft:item": {
                "description": {"identifier": f"{NS}:{iid}",
                                "menu_category": {"category": it["category"]}},
                "components": components,
            },
        })
        atlas["texture_data"][f"{NS}_{iid}"] = {"textures": f"textures/items/pcraftrevorn/{iid}"}
        extra_en.extend([f"item.{NS}:{iid}.name={it['nameEn']}", f"item.{NS}:{iid}={it['nameEn']}"])
        extra_zh.extend([f"item.{NS}:{iid}.name={it['name']}", f"item.{NS}:{iid}={it['name']}"])

        if not it["held"]:
            continue
        out = held[it["held"]]["out"]
        rc[f"controller.render.{NS}.{iid}"] = {
            "geometry": "Geometry.default", "materials": [{"*": "Material.default"}],
            "textures": ["Texture.default"]}
        write_json(RP / "attachables" / (iid + ".json"), {
            "format_version": "1.10.0",
            "minecraft:attachable": {
                "description": {
                    "identifier": f"{NS}:{iid}",
                    "materials": {"default": "entity_alphatest", "enchanted": "entity_alphatest_glint"},
                    "textures": {"default": f"textures/items/pcraftrevorn/{tex}",
                                 "enchanted": "textures/misc/enchanted_item_glint"},
                    "geometry": {"default": f"geometry.{out}"},
                    "animations": {"idle": f"animation.{NS}.{out}.loop",
                                   "wield": f"animation.{NS}.held.{out}"},
                    "scripts": {"animate": ["idle", "wield"]},
                    "render_controllers": [f"controller.render.{NS}.{iid}"],
                },
            },
        })
    write_json(RP / "render_controllers" / "vcm_items.render_controllers.json",
               {"format_version": "1.10.0", "render_controllers": rc})

    # ---- particles + projectiles ---- #
    reg["particles"] = _gen_particles()
    reg["projectiles"] = _gen_projectiles(extra_en, extra_zh)
    reg["projectileFamily"] = PROJECTILE_FAMILY
    reg["staffs"] = {f"{NS}:{sid}": {"projectile": f"{NS}:{pid}", "cooldown": STAFF_COOLDOWN}
                     for sid, pid in STAFFS.items()}
    _gen_spawn_rules()

    write_text(bp_texts[0], read_text(bp_texts[0]).rstrip() + "\n" + "\n".join(extra_en) + "\n")
    write_text(bp_texts[1], read_text(bp_texts[1]).rstrip() + "\n" + "\n".join(extra_zh) + "\n")
    write_json(RP / "textures" / "item_texture.json", atlas)

    js = (
        "// AUTO-GENERATED by tools_py/generate_vcm.py. VCM (Internalised) creature registries.\n"
        "// Merged into the PCraftRevorn packs; see docs/vcm-integration.md.\n"
        "export const VCM = "
        + json.dumps(reg, indent=2, ensure_ascii=False)
        + ";\n"
    )
    write_text(BP / "scripts" / "pcraftrevorn" / "data" / "vcm.js", js)
    print(f"VCM creatures generated: {len(reg['predatorIds'])} ({', '.join(reg['predatorIds'])})")


if __name__ == "__main__":
    generate_vcm()
