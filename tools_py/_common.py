"""Shared helpers for the tools_py toolchain.

Mirrors the small helpers used across the Node tools so the Python ports can
produce byte-for-byte compatible output.
"""
from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path

# repo root (one level above tools_py/)
ROOT = Path(__file__).resolve().parent.parent

NS = "pcraftrevorn"


def ensure_dir(path) -> None:
    Path(path).mkdir(parents=True, exist_ok=True)


def read_text(path, encoding: str = "utf-8") -> str:
    return Path(path).read_text(encoding=encoding)


def write_text(path, text: str) -> None:
    """Write text, creating parent dirs. Matches fs.writeFileSync (utf-8)."""
    p = Path(path)
    ensure_dir(p.parent)
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def write_json(path, obj) -> None:
    """Mirror JSON.stringify(obj, null, 2) + '\\n'."""
    write_text(path, json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def read_json(path):
    return json.loads(read_text(path))


def exists(path) -> bool:
    return Path(path).exists()


def rmrf(path) -> None:
    p = Path(path)
    if p.exists():
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()


def copy(src, dst) -> None:
    dst = Path(dst)
    ensure_dir(dst.parent)
    shutil.copyfile(src, dst)


def rel(path) -> str:
    return os.path.relpath(path, ROOT)


# ---- product version ------------------------------------------------------
# Single source of truth: config/version.json ({ "version": "10.17.1" }).
# Everything (manifests, dist file names, the pack name label) reads it, so a
# release only edits that one line.
VERSION_FILE = ROOT / "config" / "version.json"


def read_version(default: str = "0.1.0") -> str:
    try:
        v = read_json(VERSION_FILE).get("version")
    except Exception:  # noqa: BLE001
        v = None
    return str(v or default).strip()


def version_parts(label: str) -> list[int]:
    """'10.17.1' -> [10, 17, 1]; legacy '261010-beta-1' -> [261010, 0, 1]."""
    s = str(label).strip()
    m = re.match(r"^(\d{6})-beta-(\d+)$", s)
    if m:
        return [int(m.group(1)), 0, int(m.group(2))]
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", s)
    if m:
        return [int(m.group(1)), int(m.group(2)), int(m.group(3))]
    raise SystemExit(f"bad version string: {s!r} (see config/version.json)")
