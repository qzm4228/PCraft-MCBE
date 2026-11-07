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
import pack_split  # noqa: E402
from _common import read_version  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "packs.json"
TARGETS = ROOT / "config" / "targets.json"
DIST = ROOT / "dist"
MOBILE_FORMS = ROOT / "config" / "ui_variants" / "pcraftrevorn_forms.mobile.json"

LANG_ORDER = ["en_US", "zh_CN", "zh_TW"]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
_PACK_CONFIG: dict | None = None


def _pack_config() -> dict:
    global _PACK_CONFIG
    if _PACK_CONFIG is None:
        _PACK_CONFIG = read_json(CONFIG) if CONFIG.exists() else {}
    return _PACK_CONFIG


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
    if pack.get("literal_name"):
        header["name"] = (pack.get("display_name") or {}).get("en_US", "pack.name")
        header["description"] = (pack.get("description") or {}).get("en_US", "pack.description")
    header["version"] = version
    if pack.get("uuid"):
        header["uuid"] = pack["uuid"]
    mev = pack.get("min_engine_version") if baseline else (target.get("min_engine_version") or pack.get("min_engine_version"))
    if mev:
        header["min_engine_version"] = list(mev)
    if pack.get("strip_script"):
        manifest["modules"] = [m for m in manifest.get("modules", []) if m.get("type") != "script"]
    for module in manifest.get("modules", []):
        module["version"] = version
    if pack.get("strip_script"):
        manifest["dependencies"] = [d for d in manifest.get("dependencies", []) if not d.get("module_name")]
    for dep in manifest.get("dependencies", []):
        if isinstance(dep.get("version"), list):
            dep["version"] = version
        name = dep.get("module_name")
        if name and target.get("modules", {}).get(name):
            dep["version"] = target["modules"][name]
    for key in pack.get("pack_dependencies", []):
        other = _pack_config().get(key)
        if other and other.get("uuid"):
            manifest.setdefault("dependencies", []).append(
                {"uuid": other["uuid"], "version": list(version)}
            )
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


def pack_entries(pack: dict, target: dict, prefix: str = "", platform: str | None = None) -> list[tuple[str, object]]:
    """Resolve the pack for this target -> [(arcname, src)]. Overrides manifest.json."""
    base = ROOT / pack["base_dir"]
    fmap = dist_resolver.resolve(base, target["id"])
    manifest = json_bytes(build_manifest(pack, target))
    entries: list[tuple[str, object]] = []
    if prefix:
        entries.append((f"{prefix}/manifest.json", manifest))
    else:
        entries.append(("manifest.json", manifest))
    group = pack.get("split")
    for rel, src in fmap.items():
        if rel == "manifest.json":
            continue  # replaced by the target-applied manifest above
        if group and not pack_split.keep(group, rel):
            continue
        if (
            platform == "Mobile"
            and pack.get("base_dir") == "resource_pack"
            and rel == "ui/pcraftrevorn_forms.json"
        ):
            src = MOBILE_FORMS
        if (
            platform == "Mobile"
            and pack.get("base_dir") == "gender_pack/behavior_pack"
            and rel == "scripts/gender.js"
        ):
            # HUD bar: Mobile only. Build-time switch, no runtime platform check.
            data = src.read_bytes()
            patched = data.replace(b"const HUD_ENABLED = false;", b"const HUD_ENABLED = true;")
            if patched == data:
                raise SystemExit("[build_config] HUD_ENABLED sentinel not found in gender.js")
            src = patched
        entries.append((f"{prefix}/{rel}" if prefix else rel, src))
    return entries


def build_target(config: dict, target: dict, platform: str | None = None) -> Path:
    tid = target["id"]
    label = str(next(iter(config.values()))["version"])
    suffix = f"_{platform}" if platform else ""
    print(f"[build_config] === target {tid} (min_engine {target.get('min_engine_version')})"
          f"{' [' + platform + ']' if platform else ''} ===")

    for key, pack in config.items():
        sel = dist_resolver.selections(ROOT / pack["base_dir"], tid)
        for row in sel:
            tag = "fallback" if row["fallback"] else row["key"]
            print(f"   {pack['output_name']:<22} {row['file']:<40} [{tag}]")
        warns = dist_resolver.validate(ROOT / pack["base_dir"])
        for w in warns:
            print(f"   WARN {pack['output_name']}: {w}")

    # Only the bundled .mcaddon is shipped: it already contains all twelve
    # packs, so the per-pack .mcpack intermediates are no longer written.
    entries: list[tuple[str, object]] = []
    for pack in config.values():
        entries.extend(pack_entries(pack, target, prefix=pack["folder_name"], platform=platform))
    bundle = DIST / f"PCraftRevorn_{label}_{tid}{suffix}.mcaddon"
    new_zip(bundle, entries)
    print(f"   {bundle.name}")
    return bundle


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    version_override = None
    only: list[str] = []
    do_list = False
    platform: str | None = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--list":
            do_list = True
        elif a == "--platform":
            i += 1
            platform = argv[i]
        elif a.startswith("--platform="):
            platform = a.split("=", 1)[1]
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
                for row in dist_resolver.selections(ROOT / pack["base_dir"], t["id"]):
                    tag = "fallback" if row["fallback"] else row["key"]
                    print(f"   {pack['output_name']:<22} {row['file']:<40} [{tag}]")
        return 0

    DIST.mkdir(parents=True, exist_ok=True)
    print("[build_config] applying baseline config to source manifests ...")
    seen_dirs: set[str] = set()
    for pack in config.values():
        key = str(pack["base_dir"])
        if key in seen_dirs:
            continue  # several packs share one generated source tree
        seen_dirs.add(key)
        write_source_manifest(pack)

    chosen = [t for t in targets if not only or t["id"] in only] if only else targets
    if only and not chosen:
        raise SystemExit(f"[build_config] unknown target(s): {only} (known: {[t['id'] for t in targets]})")

    if platform not in (None, "PC", "Mobile"):
        raise SystemExit(f"[build_config] bad --platform {platform!r} (PC or Mobile)")
    if platform == "Mobile" and not MOBILE_FORMS.exists():
        raise SystemExit(f"[build_config] missing mobile variant: {MOBILE_FORMS}")

    built = [build_target(config, t, platform) for t in chosen]

    print(f"\n[build_config] {len(config)} packs x {len(chosen)} target(s) built.")
    for f in sorted(built):
        print(f"{f.stat().st_size / 1024:>10,.0f} KB  {f.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
