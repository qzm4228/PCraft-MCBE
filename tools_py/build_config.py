#!/usr/bin/env python3
"""PCraftRevorn — config-driven, multi-version build (single canonical builder).

Reads ``config/packs.json`` (pack metadata) and ``config/targets.json`` (game
version targets). For every target and every pack it:

1. applies the config + target to the pack's ``manifest.json`` — localized name
   and description (``pack.name`` / ``pack.description``), version, header uuid,
   ``min_engine_version`` and the ``@minecraft/server`` / ``@minecraft/server-ui``
   module + dependency versions;
2. writes ``pack.name`` / ``pack.description`` into the pack's ``texts/<lang>.lang``
   (and registers the languages in ``languages.json``);
3. resolves every ``dist.json`` under the pack (see ``dist_resolver.py``) to pick
   the per-version file variants and packs the result into
   ``dist/<output_name>_<target>.mcpack``;
4. folds every pack into ``dist/PCraftRevorn_<version>_<target>.mcaddon``.

Run:
    python tools_py/build_config.py                 # every target
    python tools_py/build_config.py --target 1.26.0 # one target (repeatable)
    python tools_py/build_config.py --list          # list targets + selections
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dist_resolver  # noqa: E402
from _common import read_version  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "packs.json"
TARGETS = ROOT / "config" / "targets.json"
DIST = ROOT / "dist"

LANG_ORDER = ["en_US", "zh_CN", "zh_TW"]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def parse_version(value) -> list[int]:
    s = str(value).strip()
    m = re.match(r"^(\d{6})-beta-(\d+)$", s)
    if m:
        return [int(m.group(1)), 0, int(m.group(2))]
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", s)
    if m:
        return [int(m.group(1)), int(m.group(2)), int(m.group(3))]
    raise SystemExit(f"[build_config] bad version string: {s!r}")


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def write_json(path: Path, obj) -> None:
    write_text(Path(path), json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def json_bytes(obj) -> bytes:
    return (json.dumps(obj, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def update_lang(path: Path, entries: dict) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    keys = set(entries)
    kept = [l for l in lines if "=" not in l or l.split("=", 1)[0].strip() not in keys]
    kept.extend(f"{k}={v}" for k, v in entries.items())
    write_text(path, "\n".join(kept) + "\n")


# --------------------------------------------------------------------------- #
# targets
# --------------------------------------------------------------------------- #
def load_targets() -> tuple[str, list[dict]]:
    if not TARGETS.exists():
        return "default", [{"id": "default", "min_engine_version": [1, 21, 100], "modules": {}}]
    data = read_json(TARGETS)
    targets = data.get("targets", [])
    if not targets:
        raise SystemExit("[build_config] config/targets.json has no targets")
    return data.get("default_target", targets[0]["id"]), targets


# --------------------------------------------------------------------------- #
# manifest / texts
# --------------------------------------------------------------------------- #
def build_manifest(pack: dict, target: dict, baseline: bool = False,
                   version_label: str | None = None) -> dict:
    """Return the pack manifest with config + target applied (in memory)."""
    base = ROOT / pack["base_dir"]
    manifest = read_json(base / "manifest.json")
    version = parse_version(version_label or pack["version"])
    header = manifest.setdefault("header", {})
    header["name"] = "pack.name"
    header["description"] = "pack.description"
    header["version"] = version
    if pack.get("uuid"):
        header["uuid"] = pack["uuid"]
    mev = pack.get("min_engine_version") if baseline else (target.get("min_engine_version") or pack.get("min_engine_version"))
    if mev:
        header["min_engine_version"] = list(mev)
    for module in manifest.get("modules", []):
        module["version"] = version
    for dep in manifest.get("dependencies", []):
        if isinstance(dep.get("version"), list):
            dep["version"] = version
        name = dep.get("module_name")
        if name and target.get("modules", {}).get(name):
            dep["version"] = target["modules"][name]
    return manifest


def write_source_manifest(pack: dict) -> None:
    """Apply the *baseline* manifest + localized texts to the source tree.

    The version always comes from config/version.json, never from a one-off
    ``--version`` build override, so the source tree stays clean.
    """
    base = ROOT / pack["base_dir"]
    write_json(base / "manifest.json",
               build_manifest(pack, {}, baseline=True,
                              version_label=read_version(str(pack["version"]))))

    display = pack.get("display_name", {})
    desc = pack.get("description", {})

    texts = base / "texts"
    languages_path = texts / "languages.json"
    existing: list[str] = []
    if languages_path.exists():
        try:
            existing = json.loads(languages_path.read_text(encoding="utf-8"))
        except Exception:
            existing = []
    # rewrite pack.name / pack.description for EVERY known language so a stale
    # translated name (e.g. an old zh_CN string) can never linger; languages with
    # no translation fall back to en_US.
    langs = list(dict.fromkeys([*LANG_ORDER, *existing, *display, *desc]))
    union = list(dict.fromkeys([*existing, *langs]))
    write_text(languages_path, json.dumps(union))

    for lang in langs:
        name = display.get(lang) or display.get("en_US", "")
        description = desc.get(lang) or desc.get("en_US", "")
        update_lang(texts / f"{lang}.lang", {"pack.name": name, "pack.description": description})


# --------------------------------------------------------------------------- #
# packing
# --------------------------------------------------------------------------- #
def new_zip(out_file: Path, entries: list[tuple[str, object]]) -> None:
    """entries: list of (arcname, abs path | bytes)."""
    out_file = Path(out_file)
    if out_file.exists():
        out_file.unlink()
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_file, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for arcname, src in entries:
            if isinstance(src, (bytes, bytearray)):
                zf.writestr(arcname, src)
            else:
                zf.write(src, arcname)


def pack_entries(pack: dict, target: dict, prefix: str = "") -> list[tuple[str, object]]:
    """Resolve the pack for this target -> [(arcname, src)]. Overrides manifest.json."""
    base = ROOT / pack["base_dir"]
    fmap = dist_resolver.resolve(base, target["id"])
    manifest = json_bytes(build_manifest(pack, target))
    entries: list[tuple[str, object]] = []
    if prefix:
        entries.append((f"{prefix}/manifest.json", manifest))
    else:
        entries.append(("manifest.json", manifest))
    for rel, src in fmap.items():
        if rel == "manifest.json":
            continue  # replaced by the target-applied manifest above
        entries.append((f"{prefix}/{rel}" if prefix else rel, src))
    return entries


# --------------------------------------------------------------------------- #
# merging (one BP + one RP)
# --------------------------------------------------------------------------- #
_TEXT_LANG = re.compile(r"^texts/[^/]+\.lang$")


def _read_lang(src: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        lines = Path(src).read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v
    return out


def build_merged_manifest(cfg: dict, target: dict, version_label: str) -> dict:
    version = parse_version(version_label)
    kind = cfg.get("kind", "bp")
    mev = list(target.get("min_engine_version") or cfg.get("min_engine_version") or [1, 21, 100])
    if kind == "bp":
        modules = [
            {"type": "data", "uuid": "c7e6d3b2-8e4f-4ba2-8d3e-2b3c4d5e6f70", "version": version},
            {"type": "script", "language": "javascript",
             "uuid": "d8f7e4c3-9f50-4cb3-9e4f-3c4d5e6f7081",
             "entry": "scripts/main.js", "version": version},
        ]
        mods = target.get("modules", {})
        deps = [
            {"module_name": "@minecraft/server", "version": mods.get("@minecraft/server", "2.0.0")},
            {"module_name": "@minecraft/server-ui", "version": mods.get("@minecraft/server-ui", "2.0.0")},
        ]
    else:
        modules = [{"type": "resources", "uuid": "fab9a6e5-b172-4ed5-b061-5e6f70819203", "version": version}]
        deps = []
    return {
        "format_version": 2,
        "header": {
            "name": "pack.name",
            "description": "pack.description",
            "uuid": cfg["uuid"],
            "version": version,
            "min_engine_version": mev,
        },
        "modules": modules,
        "dependencies": deps,
        "metadata": {
            "authors": ["砂墨SandMo", "Bilibili: 砂墨", "原创: MysticSummoner"],
            "license": "AFL-3.0",
        },
    }


def merge_entries(cfg: dict, target: dict, version_label: str) -> list[tuple[str, object]]:
    """Merge the configured source packs into a single set of pack entries."""
    merged: dict[str, Path] = {}
    langs: dict[str, dict[str, str]] = {}
    lang_order: list[str] = []
    ui_defs: list[str] = []
    ui_seen: set[str] = set()
    sounds: dict = {}
    items: dict = {}
    mains: list[Path] = []

    for base_rel in cfg["merge"]:
        base = ROOT / base_rel
        fmap = dist_resolver.resolve(base, target["id"])
        for rel, src in fmap.items():
            if rel == "manifest.json":
                continue
            if rel in ("README.txt", "pack_icon.png"):
                merged.setdefault(rel, src)
                continue
            if rel == "scripts/main.js":
                mains.append(src)
                continue
            if _TEXT_LANG.match(rel):
                lang = rel.split("/")[-1]
                if lang not in langs:
                    langs[lang] = {}
                    lang_order.append(lang)
                for k, v in _read_lang(src).items():
                    if k in ("pack.name", "pack.description"):
                        continue
                    langs[lang][k] = v
                continue
            if rel == "texts/languages.json":
                try:
                    arr = json.loads(Path(src).read_text(encoding="utf-8"))
                except Exception:
                    arr = []
                for x in arr:
                    if x not in lang_order:
                        lang_order.append(x)
                continue
            if rel == "ui/_ui_defs.json":
                try:
                    arr = json.loads(Path(src).read_text(encoding="utf-8")).get("ui_defs", [])
                except Exception:
                    arr = []
                for x in arr:
                    if x not in ui_seen:
                        ui_seen.add(x)
                        ui_defs.append(x)
                continue
            if rel == "sounds/sound_definitions.json":
                try:
                    d = json.loads(Path(src).read_text(encoding="utf-8")).get("sound_definitions", {})
                except Exception:
                    d = {}
                sounds.update(d)
                continue
            if rel == "textures/item_texture.json":
                try:
                    d = json.loads(Path(src).read_text(encoding="utf-8"))
                except Exception:
                    d = {}
                items.update(d.get("texture_data", {}))
                continue
            merged.setdefault(rel, src)

    entries: list[tuple[str, object]] = []
    entries.append(("manifest.json", json_bytes(build_merged_manifest(cfg, target, version_label))))

    names = ["main_pcraft.js", "main_gender.js", "main_vcraft.js"]
    entry_src = []
    for idx, src in enumerate(mains):
        name = names[idx] if idx < len(names) else f"main_{idx}.js"
        merged[f"scripts/{name}"] = src
        entry_src.append(f'import "./{name}";\n')
    entries.append(("scripts/main.js", "".join(entry_src).encode("utf-8")))

    for rel, src in merged.items():
        if rel == "texts/languages.json":
            continue
        entries.append((rel, src))

    if ui_defs:
        entries.append(("ui/_ui_defs.json", json_bytes({"ui_defs": ui_defs})))
    if sounds:
        entries.append(("sounds/sound_definitions.json",
                        json_bytes({"format_version": "1.14.0", "sound_definitions": sounds})))
    if items:
        entries.append(("textures/item_texture.json",
                        json_bytes({"resource_pack_name": "vanilla", "texture_name": "atlas.items",
                                    "texture_data": items})))

    display = cfg.get("display_name", {})
    desc = cfg.get("description", {})
    for lang in lang_order:
        kv = dict(langs.get(lang, {}))
        kv["pack.name"] = display.get(lang) or display.get("en_US", "")
        kv["pack.description"] = desc.get(lang) or desc.get("en_US", "")
        entries.append((f"texts/{lang}.lang",
                        ("\n".join(f"{k}={v}" for k, v in kv.items()) + "\n").encode("utf-8")))
    entries.append(("texts/languages.json", json_bytes(lang_order)))
    return entries


def build_target(config: dict, target: dict) -> Path:
    tid = target["id"]
    label = str(next(iter(config.values()))["version"])
    print(f"[build_config] === target {tid} (min_engine {target.get('min_engine_version')}) ===")

    source_packs = {k: v for k, v in config.items() if "base_dir" in v}
    merged_packs = {k: v for k, v in config.items() if "merge" in v}

    for key, pack in source_packs.items():
        sel = dist_resolver.selections(ROOT / pack["base_dir"], tid)
        for row in sel:
            tag = "fallback" if row["fallback"] else row["key"]
            print(f"   {pack['output_name']:<22} {row['file']:<40} [{tag}]")
        warns = dist_resolver.validate(ROOT / pack["base_dir"])
        for w in warns:
            print(f"   WARN {pack['output_name']}: {w}")

    # individual mcpacks (kept for reference)
    for key, pack in source_packs.items():
        out = DIST / f"{pack['output_name']}_{tid}.mcpack"
        new_zip(out, pack_entries(pack, target))
        print(f"   {out.name}")

    # merged packs -> the mcaddon contains exactly one BP + one RP
    entries: list[tuple[str, object]] = []
    for key, pack in merged_packs.items():
        ents = merge_entries(pack, target, label)
        out = DIST / f"{pack['output_name']}_{tid}.mcpack"
        new_zip(out, ents)
        print(f"   {out.name}  ({len(ents)} entries)")
        entries.extend((f"{pack['folder_name']}/{arc}", src) for arc, src in ents)
    bundle = DIST / f"PCraftRevorn_{label}_{tid}.mcaddon"
    new_zip(bundle, entries)
    print(f"   {bundle.name}  (1 BP + 1 RP)")
    return bundle


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    version_override = None
    only: list[str] = []
    do_list = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--list":
            do_list = True
        elif a == "--target":
            i += 1
            only.append(argv[i])
        elif a.startswith("--target="):
            only.append(a.split("=", 1)[1])
        else:
            version_override = a
        i += 1

    if not CONFIG.exists():
        raise SystemExit(f"[build_config] missing config: {CONFIG}")
    config = read_json(CONFIG)
    # config/version.json wins over the per-pack entries, so a release edits one line
    global_version = read_version(str(next(iter(config.values())).get("version", "0.1.0")))
    for pack in config.values():
        pack["version"] = global_version
    print(f"[build_config] version {global_version} (config/version.json)")
    if version_override:
        for pack in config.values():
            pack["version"] = version_override

    default_id, targets = load_targets()
    if do_list:
        for t in targets:
            print(t["id"], "min_engine", t.get("min_engine_version"), "modules", t.get("modules"))
            for key, pack in config.items():
                if "base_dir" not in pack:
                    continue
                for row in dist_resolver.selections(ROOT / pack["base_dir"], t["id"]):
                    tag = "fallback" if row["fallback"] else row["key"]
                    print(f"   {pack['output_name']:<22} {row['file']:<40} [{tag}]")
            for key, pack in config.items():
                if "merge" in pack:
                    print(f"   {pack['output_name']:<22} <- merge {pack['merge']}")
        return 0

    DIST.mkdir(parents=True, exist_ok=True)
    print("[build_config] applying baseline config to source manifests ...")
    for pack in config.values():
        if "base_dir" in pack:
            write_source_manifest(pack)

    chosen = [t for t in targets if not only or t["id"] in only] if only else targets
    if only and not chosen:
        raise SystemExit(f"[build_config] unknown target(s): {only} (known: {[t['id'] for t in targets]})")

    built = [build_target(config, t) for t in chosen]

    print(f"\n[build_config] {len([p for p in config.values() if 'base_dir' in p])} source packs + "
          f"{len([p for p in config.values() if 'merge' in p])} merged packs x {len(chosen)} target(s) built.")
    for f in sorted(built):
        print(f"{f.stat().st_size / 1024:>10,.0f} KB  {f.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
