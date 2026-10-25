"""Split the single generated PCraft tree into content packs at package time.

The generators (generate.py / generate_entities.py) still produce one
``behavior_pack`` + ``resource_pack`` tree; this module decides which pack each
file ships in:

    base          everything not claimed by a content group (scripts, blocks,
                  recipes, shared assets, UI, texts...)
    community     多外观 + 社区萌物
    pokemon       eevee family
    internalised  VCM (Internalised) creatures, druids, seasonal particles

The content packs depend on the base pack (see config/packs.json), which owns
the vore system, the guide and the shared atlases.

If a file is claimed by a group it leaves the base pack; everything else stays
in the base. ``pack_icon.png`` is copied into every pack.
"""

from __future__ import annotations

GROUPS: dict[str, dict] = {
    "community": {
        "species": [
            "cathyl_rabbit", "plant_maiden", "lamia", "predatopia_v2", "predatopia",
            "piglin_dragon",
        ],
        "items": [
            "cathyl_rabbit_spawn_egg", "plant_maiden_spawn_egg", "lamia_spawn_egg",
            "predatopia_spawn_egg", "predatopia_v2_spawn_egg", "piglin_dragon_spawn_egg",
        ],
        "particles": [],
    },
    "pokemon": {
        "species": [
            "eevee_rabbit", "eevee_scarecrow", "eevee_silverfish", "eevee_vinemaiden",
            "eevee_zombie",
        ],
        "items": [
            "eevee_rabbit_spawn_egg", "eevee_scarecrow_spawn_egg", "eevee_silverfish_spawn_egg",
            "eevee_vinemaiden_spawn_egg", "eevee_zombie_spawn_egg",
        ],
        "particles": [],
    },
    "internalised": {
        "species": [
            "bat_girl", "bunny_girl", "cat_girl", "lamia_vcm", "slime_girl", "druid",
            "druid_projectile", "autumn_druid_projectile", "spring_druid_projectile",
            "winter_druid_projectile",
        ],
        "items": [
            "bat_girl_spawn_egg", "bunny_girl_spawn_egg", "cat_girl_spawn_egg",
            "druid_spawn_egg", "lamia_vcm_spawn_egg", "slime_girl_spawn_egg",
            "druid_staff", "autumn_druid_staff", "spring_druid_staff", "winter_druid_staff",
        ],
        "particles": [
            "autumn_leaves", "autumn_leaves_burst", "leaves", "leaves_burst",
            "siphon", "siphon_burst", "spring_blossom", "spring_blossom_burst",
            "winter_snowflake", "winter_snowflake_burst",
        ],
    },
}

# longest identifier first so `eevee_zombie` wins over `zombie`,
# `lamia_vcm` over `lamia`, etc.
_ALL = sorted(
    ((ident, group) for group, g in GROUPS.items() for ident in g["species"]),
    key=lambda x: -len(x[0]),
)

_BY_ITEM = {item: group for group, g in GROUPS.items() for item in g["items"]}
_BY_PARTICLE = {p: group for group, g in GROUPS.items() for p in g["particles"]}

ENTITY_DIRS = ("entities/", "entity/")
SPAWN_DIR = "spawn_rules/"
LOOT_DIR = "loot_tables/entities/"
MODEL_DIR = "models/entity/"
ANIM_DIR = "animations/"
RC_DIR = "render_controllers/"
ATTACH_DIR = "attachables/"
TEX_DIR = "textures/entity/pcraftrevorn/"
PARTICLE_TEX_DIR = "textures/particle/pcraftrevorn/"


def _species_of(stem: str) -> str | None:
    for ident, group in _ALL:
        if stem.startswith(ident):
            return group
    return None


def claimed_group(rel: str) -> str | None:
    """Which content group owns this pack-relative path (None = base)."""
    if rel.startswith(ENTITY_DIRS) and rel.endswith(".json"):
        return _species_of(rel.split("/")[-1][:-5])
    if rel.startswith("items/") and rel.endswith(".json"):
        return _BY_ITEM.get(rel[len("items/"):-5])
    if rel.startswith(SPAWN_DIR) and rel.endswith(".json"):
        return _species_of(rel[len(SPAWN_DIR):-5])
    if rel.startswith(LOOT_DIR) and rel.endswith(".json"):
        return _species_of(rel[len(LOOT_DIR):-5])
    if rel.startswith(MODEL_DIR) and rel.endswith(".geo.json"):
        return _species_of(rel[len(MODEL_DIR):-len(".geo.json")])
    if rel.startswith(ANIM_DIR) and rel.endswith(".json"):
        return _species_of(rel[len(ANIM_DIR):-5])
    if rel.startswith(RC_DIR) and rel.endswith(".json"):
        return _species_of(rel[len(RC_DIR):-5])
    if rel.startswith(ATTACH_DIR) and rel.endswith(".json"):
        return _BY_ITEM.get(rel[len(ATTACH_DIR):-5])
    if rel.startswith(TEX_DIR) and rel.endswith(".png"):
        return _species_of(rel[len(TEX_DIR):-4])
    if rel.startswith("particles/") and rel.endswith(".particle.json"):
        return _BY_PARTICLE.get(rel[len("particles/"):-len(".particle.json")])
    if rel.startswith(PARTICLE_TEX_DIR) and rel.endswith(".png"):
        # every particle texture we ship belongs to the druid family
        return "internalised"
    return None


def keep(group: str, rel: str) -> bool:
    """Should ``rel`` be included in the pack for ``group``?"""
    if rel == "manifest.json":
        return True
    if group == "base":
        return claimed_group(rel) is None
    if rel == "pack_icon.png":
        return True
    return claimed_group(rel) == group


def counts() -> dict[str, int]:
    return {g: len(v["species"]) for g, v in GROUPS.items()}
