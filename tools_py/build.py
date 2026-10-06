"""Builds dist/*.mcpack and dist/*.mcaddon.

Port of tools/build.ps1.

Bedrock requires zip entries to use forward slashes ("/"); entries are written
explicitly with normalized paths.

Usage: python tools_py/build.py [version]
"""
from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

from _common import ROOT, ensure_dir

DIST = ROOT / "dist"

# (archive folder name, source directory)
PACKS = [
    ("PCraftRevorn_BP", ROOT / "behavior_pack"),
    ("PCraftRevorn_RP", ROOT / "resource_pack"),
    ("FemaleGenderMod_BP", ROOT / "gender_pack" / "behavior_pack"),
    ("FemaleGenderMod_RP", ROOT / "gender_pack" / "resource_pack"),
    ("VCraft_BP", ROOT / "vcraft_pack" / "behavior_pack"),
    ("VCraft_RP", ROOT / "vcraft_pack" / "resource_pack"),
]


def _iter_files(base: Path):
    """All files under base, deterministically sorted by relative posix path."""
    files = [p for p in base.rglob("*") if p.is_file()]
    files.sort(key=lambda p: p.relative_to(base).as_posix())
    return files


def new_zip(out_file: Path, entries) -> None:
    out_file = Path(out_file)
    if out_file.exists():
        out_file.unlink()
    with zipfile.ZipFile(out_file, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, directory in entries:
            base = Path(directory)
            for f in _iter_files(base):
                rel_name = f.relative_to(base).as_posix()
                arcname = f"{name}/{rel_name}" if name else rel_name
                zf.write(f, arcname)


def main(argv) -> int:
    version = argv[1] if len(argv) > 1 else "261002-beta-2"
    ensure_dir(DIST)

    for name, directory in PACKS:
        new_zip(DIST / f"{name}.mcpack", [("", directory)])
    new_zip(DIST / "PCraftRevorn.mcaddon", PACKS)
    shutil.copyfile(DIST / "PCraftRevorn.mcaddon", DIST / f"PCraftRevorn_{version}.mcaddon")

    print(f"Built dist packages (version {version}).")
    for f in sorted(DIST.iterdir()):
        if f.is_file():
            kb = f.stat().st_size / 1024
            print(f"{kb:>10,.0f} KB  {f.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
