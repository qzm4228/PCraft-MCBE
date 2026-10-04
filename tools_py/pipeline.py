"""PCraftRevorn — Python production pipeline.

Usage:
    python tools_py/pipeline.py [label] [major minor patch]
    python tools_py/pipeline.py                      # uses 261004-beta-2
    python tools_py/pipeline.py 261005-beta-1        # derive [261005, 0, 1]
    python tools_py/pipeline.py 261005-beta-1 261005 0 1

Steps: set version -> generate -> generate_entities -> nbt_to_data -> build
The Node tools under ``tools/`` are kept as the reference implementation and are
not deleted; this pipeline is a stdlib-only Python equivalent.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# generators that embed the version (JS reference + Python port kept in sync)
GENERATORS = [ROOT / "tools" / "generate.js", HERE / "generate.py"]
EXTRA_MANIFESTS = [
    ROOT / "gender_pack" / "behavior_pack" / "manifest.json",
    ROOT / "gender_pack" / "resource_pack" / "manifest.json",
    ROOT / "vcraft_pack" / "behavior_pack" / "manifest.json",
    ROOT / "vcraft_pack" / "resource_pack" / "manifest.json",
]
LABEL_RE = r"26100\d-beta-\d+"


def set_version(label: str, triple: tuple[int, int, int]) -> None:
    for g in GENERATORS:
        if not g.exists():
            continue
        s = g.read_text(encoding="utf-8")
        s = re.sub(r"PACK_VERSION = \[[^\]]*\]", "PACK_VERSION = [%d, %d, %d]" % triple, s)
        s = re.sub(LABEL_RE, label, s)
        g.write_text(s, encoding="utf-8")
    for m in EXTRA_MANIFESTS:
        if not m.exists():
            continue
        j = json.loads(m.read_text(encoding="utf-8"))
        j["header"]["version"] = list(triple)
        if isinstance(j["header"].get("name"), str):
            j["header"]["name"] = re.sub(LABEL_RE, label, j["header"]["name"])
        for mod in j.get("modules", []):
            mod["version"] = list(triple)
        for dep in j.get("dependencies", []):
            if isinstance(dep.get("version"), list):
                dep["version"] = list(triple)
        m.write_text(json.dumps(j, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[pipeline] version -> {label} {triple}")


def run(script: str, *args: str) -> None:
    print(f"[pipeline] >>> {script} {' '.join(args)}".rstrip())
    r = subprocess.run([sys.executable, str(HERE / script), *args])
    if r.returncode != 0:
        sys.exit(r.returncode)


def main() -> None:
    args = sys.argv[1:]
    label = args[0] if args else "261004-beta-2"
    if len(args) >= 4:
        triple = (int(args[1]), int(args[2]), int(args[3]))
    else:
        m = re.match(r"(\d{6})-beta-(\d+)", label)
        triple = (int(m.group(1)), 0, int(m.group(2))) if m else (261004, 0, 2)

    set_version(label, triple)
    run("generate.py")
    run("generate_entities.py")
    run("nbt_to_data.py")
    run("build.py", label)


if __name__ == "__main__":
    main()
