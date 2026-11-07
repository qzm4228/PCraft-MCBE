"""PCraftRevorn — Python production pipeline.

Usage:
    python tools_py/pipeline.py                 # build whatever config/version.json says
    python tools_py/pipeline.py 10.18.0         # set that version, then build

The version lives in exactly one place: ``config/version.json``. The generators
read it directly (``_common.read_version``) and the builder stamps it into every
manifest and into the dist file names, so a release edits one line -- or passes
the new label on the command line, which rewrites that one line for you.

Steps: generate -> generate_entities -> nbt_to_data -> build
``build`` is the config-driven builder (``tools_py/build_config.py``) which applies
``config/packs.json`` to every manifest before packing. The Node tools under
``tools/`` remain as the reference implementation.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
VERSION_FILE = ROOT / "config" / "version.json"


def parse_version(value) -> tuple[int, int, int]:
    s = str(value).strip()
    m = re.match(r"^(\d{6})-beta-(\d+)$", s)
    if m:
        return (int(m.group(1)), 0, int(m.group(2)))
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    raise SystemExit(f"[pipeline] bad version string: {s!r}")


def read_version() -> str:
    try:
        raw = json.loads(VERSION_FILE.read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError):
        raw = None
    return str(raw or "0.1.0").strip()


def write_version(label: str) -> None:
    parse_version(label)  # validate before touching the file
    VERSION_FILE.write_text(
        json.dumps({"version": label}, indent=2) + "\n", encoding="utf-8"
    )
    print(f"[pipeline] version.json -> {label}")


def run(script: str, *args: str) -> None:
    print(f"[pipeline] >>> {script} {' '.join(args)}".rstrip())
    r = subprocess.run([sys.executable, str(HERE / script), *args])
    if r.returncode != 0:
        sys.exit(r.returncode)


def main() -> None:
    args = [a for a in sys.argv[1:] if a.strip()]
    if args:
        write_version(args[0].strip())

    label = read_version()
    print(f"[pipeline] version = {label} {parse_version(label)} (config/version.json)")

    run("generate.py")
    run("generate_entities.py")
    run("crop_textures.py")
    run("gen_tame_data.py")
    run("clean_anim_bones.py")
    run("prune_textures.py")
    run("nbt_to_data.py")
    run("build_config.py")


if __name__ == "__main__":
    main()
