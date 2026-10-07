"""PCraftRevorn — Python production pipeline.

Usage:
    python tools_py/pipeline.py                 # build whatever config/packs.json says
    python tools_py/pipeline.py 261005-beta-1   # bump version everywhere, then build

Steps: (bump version) -> generate -> generate_entities -> nbt_to_data -> build
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
CONFIG = ROOT / "config" / "packs.json"

# generators that embed the version label (JS reference + Python port kept in sync)
GENERATORS = [ROOT / "tools" / "generate.js", HERE / "generate.py"]
LABEL_RE = r"26100\d-beta-\d+"


def parse_version(value) -> tuple[int, int, int]:
    s = str(value).strip()
    m = re.match(r"^(\d{6})-beta-(\d+)$", s)
    if m:
        return (int(m.group(1)), 0, int(m.group(2)))
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    raise SystemExit(f"[pipeline] bad version string: {s!r}")


def read_config() -> dict:
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def set_config_version(label: str) -> None:
    config = read_config()
    for pack in config.values():
        pack["version"] = label
    CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def set_generator_version(label: str, triple: tuple[int, int, int]) -> None:
    for g in GENERATORS:
        if not g.exists():
            continue
        s = g.read_text(encoding="utf-8")
        s = re.sub(r"PACK_VERSION = \[[^\]]*\]", "PACK_VERSION = [%d, %d, %d]" % triple, s)
        s = re.sub(LABEL_RE, label, s)
        g.write_text(s, encoding="utf-8")


def run(script: str, *args: str) -> None:
    print(f"[pipeline] >>> {script} {' '.join(args)}".rstrip())
    r = subprocess.run([sys.executable, str(HERE / script), *args])
    if r.returncode != 0:
        sys.exit(r.returncode)


def main() -> None:
    args = sys.argv[1:]
    if args:
        label = args[0]
        set_config_version(label)
    else:
        label = str(next(iter(read_config().values()))["version"])
    triple = parse_version(label)
    set_generator_version(label, triple)
    print(f"[pipeline] version = {label} {triple}")

    run("generate.py")
    run("generate_entities.py")
    run("nbt_to_data.py")
    run("build_config.py")


if __name__ == "__main__":
    main()
