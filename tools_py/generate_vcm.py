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
    VALID_SEG, behavior, convert_anim_object, egg_rgba, sanitize_bones, write_png,
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
STATS = {"swallow": 0.28, "struggles": 15, "difficulty": 0.30,
         "acid": 6.0, "acidMax": 10.5, "acidIncr": 0.02, "wg1": 999, "wg2": 999}

HUNT_PLAYER = ["player", "villager", "animal"]


def _stats(**over):
    s = dict(STATS)
    s.update(over)
    return s


CREATURES = [
    {
        "id": "bat_girl",
        # normal / white / black (the *_tamed skins wait for a tame-state texture
        # swap, see docs/vcm-integration.md phase D)
        "src": "bat_girl", "name": "蝙蝠娘", "nameEn": "Bat Girl",
        "lore": "洞穴里的夜行小姐姐：翅膀软、心眼小，饿起来可不讲道理。",
        "egg": (-9610733, -10471161), "variants": [0, 1, 2],
        "skins": [
            ("batgirltexturenobelly", "bat_girl0"), ("batgirltexture", "bat_girl0_belly"),
            ("whitebatgirltexturenobelly", "bat_girl1"), ("whitebatgirltexture", "bat_girl1_belly"),
            ("blackbatgirltexturenobelly", "bat_girl2"), ("blackbatgirltexture", "bat_girl2_belly"),
        ],
        "animate": ANIM_BELLY,
        "behavior": {"hp": 20, "speed": 0.3, "dmg": 4, "follow": 32, "size": [0.35, 1.15],
                     "scale": 1.3, "loot": None, "tameable": True, "undead": False,
                     "targets": HUNT_PLAYER},
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
                     "scale": 2.0, "loot": None, "tameable": True, "undead": False,
                     "targets": HUNT_PLAYER},
        "stats": _stats(swallow=0.26, difficulty=0.20),
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
                     "scale": 2.0, "loot": None, "tameable": True, "undead": False,
                     "targets": HUNT_PLAYER},
        "stats": _stats(swallow=0.26, difficulty=0.25),
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
                     "scale": 2.0, "loot": None, "tameable": True, "undead": False,
                     "targets": ["monster"]},
        "stats": _stats(swallow=0.25, difficulty=0.35),
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
                     "targets": ["player", "villager", "iron_golem", "animal"]},
        "stats": _stats(swallow=0.35, struggles=17, difficulty=0.45),
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
        # movement-gated; idle2 is the digesting pose
        "animate": [("idle", NO_BELLY), ("idle2", BELLY)],
        "behavior": {"hp": 20, "speed": 0.3, "dmg": 6, "follow": 24, "size": [1.0, 2.0],
                     "scale": 2.0, "loot": None, "tameable": True, "undead": False,
                     "targets": HUNT_PLAYER},
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


def generate_vcm() -> None:
    reg = {"texBase": {}, "gendered": [], "variants": {}, "endKind": {}, "animPrefix": {},
           "counterMax": {}, "stats": {}, "names": {}, "lore": {}, "predatorIds": [],
           "skins": {}, "texMax": {}}
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
        if c["behavior"].get("scale"):
            ent["minecraft:entity"]["components"]["minecraft:scale"] = {"value": c["behavior"]["scale"]}
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

    write_text(bp_texts[0], read_text(bp_texts[0]).rstrip() + "\n" + "\n".join(extra_en) + "\n")
    write_text(bp_texts[1], read_text(bp_texts[1]).rstrip() + "\n" + "\n".join(extra_zh) + "\n")
    write_json(RP / "textures" / "item_texture.json", atlas)

    js = (
        "// AUTO-GENERATED by tools/generate_vcm.js. VCM (Internalised) creature registries.\n"
        "// Merged into the PCraftRevorn packs; see docs/vcm-integration.md.\n"
        "export const VCM = "
        + json.dumps(reg, indent=2, ensure_ascii=False)
        + ";\n"
    )
    write_text(BP / "scripts" / "pcraftrevorn" / "data" / "vcm.js", js)
    print(f"VCM creatures generated: {len(reg['predatorIds'])} ({', '.join(reg['predatorIds'])})")


if __name__ == "__main__":
    generate_vcm()
