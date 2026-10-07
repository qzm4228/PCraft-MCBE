#!/usr/bin/env python3
"""PCraftRevorn — config-driven build (single canonical builder).

Reads ``config/packs.json`` and, for every pack:

1. applies the config to the pack's ``manifest.json`` — localized pack name and
   description (via the ``pack.name`` / ``pack.description`` language keys), the
   version (``261004-beta-2`` -> ``[261004, 0, 2]``), header uuid and
   min_engine_version; and bumps the module / dependency versions to match;
2. writes the ``pack.name`` / ``pack.description`` entries into the pack's
   ``texts/<lang>.lang`` (and registers the languages in ``languages.json``);
3. packs each ``base_dir`` into ``dist/<output_name>.mcpack`` with the manifest
   at the archive root (the correct layout for a single ``.mcpack``);
4. folds every pack into ``dist/PCraftRevorn.mcaddon`` (one top-level folder per
   pack, named by ``folder_name``) and copies it to
   ``dist/PCraftRevorn_<version>.mcaddon``.

Run:  python tools_py/build_config.py
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "packs.json"
DIST = ROOT / "dist"

# language files written into each pack's texts/ (config keys)
LANG_ORDER = ["en_US", "zh_CN", "zh_TW"]


def parse_version(value) -> list[int]:
    """'261004-beta-2' -> [261004, 0, 2]; also accepts '1.2.3'."""
    s = str(value).strip()
    m = re.match(r"^(\d{6})-beta-(\d+)$", s)
    if m:
        return [int(m.group(1)), 0, int(m.group(2))]
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", s)
    if m:
        return [int(m.group(1)), int(m.group(2)), int(m.group(3))]
    raise SystemExit(f"[build_config] bad version string: {s!r}")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: Path, obj) -> None:
    write_text(Path(path), json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def update_lang(path: Path, entries: dict) -> None:
    """Replace/append ``key=value`` lines while keeping the rest of the file."""
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    keys = set(entries)
    kept = [l for l in lines if "=" not in l or l.split("=", 1)[0].strip() not in keys]
    kept.extend(f"{k}={v}" for k, v in entries.items())
    write_text(path, "\n".join(kept) + "\n")


def apply_pack(pack: dict) -> list[int]:
    """Write the config back into the pack's manifest + texts. Returns version triple."""
    version = parse_version(pack["version"])
    base = ROOT / pack["base_dir"]

    manifest_path = base / "manifest.json"
    manifest = read_json(manifest_path)
    header = manifest.setdefault("header", {})
    header["name"] = "pack.name"
    header["description"] = "pack.description"
    header["version"] = version
    if pack.get("uuid"):
        header["uuid"] = pack["uuid"]
    if pack.get("min_engine_version"):
        header["min_engine_version"] = pack["min_engine_version"]
    for module in manifest.get("modules", []):
        module["version"] = version
    for dep in manifest.get("dependencies", []):
        if isinstance(dep.get("version"), list):
            dep["version"] = version
    write_json(manifest_path, manifest)

    display = pack.get("display_name", {})
    desc = pack.get("description", {})
    langs = [l for l in LANG_ORDER if l in display or l in desc]
    langs += [l for l in sorted(set(display) | set(desc)) if l not in LANG_ORDER]

    texts = base / "texts"
    languages_path = texts / "languages.json"
    existing: list[str] = []
    if languages_path.exists():
        try:
            existing = json.loads(languages_path.read_text(encoding="utf-8"))
        except Exception:
            existing = []
    union = list(dict.fromkeys([*existing, *langs]))
    write_text(languages_path, json.dumps(union))

    for lang in langs:
        name = display.get(lang) or display.get("en_US", "")
        description = desc.get(lang) or desc.get("en_US", "")
        update_lang(texts / f"{lang}.lang", {"pack.name": name, "pack.description": description})

    return version


def new_zip(out_file: Path, base_dir: Path, prefix: str = "") -> None:
    """Zip base_dir, entry names relative to base_dir (optional prefix), '/' separators."""
    out_file = Path(out_file)
    if out_file.exists():
        out_file.unlink()
    base = Path(base_dir)
    files = sorted(p for p in base.rglob("*") if p.is_file())
    with zipfile.ZipFile(out_file, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for f in files:
            rel = f.relative_to(base).as_posix()
            zf.write(f, f"{prefix}{rel}" if prefix else rel)


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not CONFIG.exists():
        raise SystemExit(f"[build_config] missing config: {CONFIG}")
    config = read_json(CONFIG)
    if argv:
        # ephemeral version override, e.g. `python tools_py/build_config.py 261005-beta-1`
        for pack in config.values():
            pack["version"] = argv[0]
    DIST.mkdir(parents=True, exist_ok=True)
    print("[build_config] applying config to manifests ...")
    versions = {key: apply_pack(pack) for key, pack in config.items()}

    print("[build_config] building .mcpack ...")
    for key, pack in config.items():
        out = DIST / f"{pack['output_name']}.mcpack"
        new_zip(out, ROOT / pack["base_dir"])
        print(f"   {out.name}")

    print("[build_config] building .mcaddon ...")
    stage = DIST / "_stage"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    for pack in config.values():
        shutil.copytree(ROOT / pack["base_dir"], stage / pack["folder_name"])
    bundle = DIST / "PCraftRevorn.mcaddon"
    new_zip(bundle, stage)
    shutil.rmtree(stage)

    label = str(next(iter(config.values()))["version"])
    versioned = DIST / f"PCraftRevorn_{label}.mcaddon"
    shutil.copyfile(bundle, versioned)

    print(f"\n[build_config] {len(config)} packs built. version={label}")
    for f in sorted(DIST.iterdir()):
        if f.is_file():
            print(f"{f.stat().st_size / 1024:>10,.0f} KB  {f.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
