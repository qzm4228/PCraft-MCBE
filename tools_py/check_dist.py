#!/usr/bin/env python3
"""Conformance check: the Python and Node builders must produce identical output.

For each target it builds once with ``tools_py/build_config.py`` and once with
``tools/build.js`` and compares every archive entry name + content hash (entry
order and deflate bytes may differ between the two zip writers, so we compare the
logical contents).

Run:  python tools_py/check_dist.py [target ...]
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
TARGETS = ROOT / "config" / "targets.json"


def entries(zip_path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            out[name] = hashlib.sha256(z.read(name)).hexdigest()
    return out


def snapshot(target: str) -> dict[str, dict[str, str]]:
    snap: dict[str, dict[str, str]] = {}
    for p in sorted(DIST.glob(f"*_{target}.mcpack")):
        snap[p.name] = entries(p)
    for p in sorted(DIST.glob(f"PCraftRevorn_*_{target}.mcaddon")):
        snap[p.name] = entries(p)
    return snap


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        raise SystemExit(f"[check_dist] command failed: {' '.join(cmd)}")


def node_cmd() -> list[str]:
    exe = shutil.which("node")
    if exe:
        return [exe]
    for cand in (r"F:\tools\node\node.exe", r"F:\tools\node\node"):
        if Path(cand).exists():
            return [cand]
    raise SystemExit("[check_dist] node not found on PATH")


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    targets = argv or [t["id"] for t in __import__("json").loads(TARGETS.read_text(encoding="utf-8"))["targets"]]
    py = [sys.executable, str(ROOT / "tools_py" / "build_config.py")]
    js = node_cmd() + [str(ROOT / "tools" / "build.js")]

    ok = True
    for tid in targets:
        run([*py, "--target", tid])
        a = snapshot(tid)
        run([*js, "--target", tid])
        b = snapshot(tid)
        if set(a) != set(b):
            ok = False
            print(f"[{tid}] archive sets differ: py={sorted(set(a) - set(b))} js={sorted(set(b) - set(a))}")
            continue
        diffs = 0
        for name in a:
            ea, eb = a[name], b[name]
            if set(ea) != set(eb):
                ok = False
                print(f"[{tid}] {name}: entry sets differ")
                print("   only py:", sorted(set(ea) - set(eb))[:8])
                print("   only js:", sorted(set(eb) - set(ea))[:8])
                continue
            bad = [n for n in ea if ea[n] != eb[n]]
            if bad:
                ok = False
                diffs += len(bad)
                print(f"[{tid}] {name}: {len(bad)} entry contents differ, e.g. {bad[:5]}")
        if diffs == 0 and set(a) == set(b):
            print(f"[{tid}] OK  ({len(a)} archives)")
    print("CONFORMANT" if ok else "MISMATCH")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
