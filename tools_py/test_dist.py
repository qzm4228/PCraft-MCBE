#!/usr/bin/env python3
"""Unit test for the dist.json resolver (Python + Node must agree).

Builds a throwaway fixture, checks the Python resolver's picks and asserts the
Node resolver reports exactly the same selections.

Run:  python tools_py/test_dist.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import dist_resolver  # noqa: E402

FIXTURE = {
    "dist.json": json.dumps(
        {
            "menu.json": {"1.21.80.x": True, "<=1.21.100": "menu.old.json", "1.26.x": "menu.new.json"},
            "sub/thing.json": {"1.26.x": True},
        },
        indent=2,
    ),
    "menu.json": "base",
    "menu.json.1.21.80.x": "v-1.21.80",
    "menu.old.json": "v-old",
    "menu.new.json": "v-new",
    "plain.json": "plain",
    "sub/thing.json": "base-thing",
    "sub/thing.json.1.26.x": "v-thing-1.26",
}

EXPECTED = {
    # target: {outRel: sourceRel}
    "1.21.80": {"menu.json": "menu.json.1.21.80.x", "plain.json": "plain.json", "sub/thing.json": "sub/thing.json"},
    "1.21.100": {"menu.json": "menu.old.json", "plain.json": "plain.json", "sub/thing.json": "sub/thing.json"},
    "1.26.0": {"menu.json": "menu.new.json", "plain.json": "plain.json", "sub/thing.json": "sub/thing.json.1.26.x"},
    "1.26.50": {"menu.json": "menu.new.json", "plain.json": "plain.json", "sub/thing.json": "sub/thing.json.1.26.x"},
}


def node_cmd() -> list[str]:
    exe = shutil.which("node")
    if exe:
        return [exe]
    for cand in (r"F:\tools\node\node.exe", r"F:\tools\node\node"):
        if Path(cand).exists():
            return [cand]
    raise SystemExit("node not found")


def make_fixture(root: Path) -> None:
    for rel, text in FIXTURE.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


def main() -> int:
    root = Path(tempfile.mkdtemp(prefix="disttest_"))
    try:
        make_fixture(root)
        ok = True
        for target, expected in EXPECTED.items():
            got = {rel: str(src.relative_to(root)).replace("\\", "/") for rel, src in dist_resolver.resolve(root, target).items()}
            if got != expected:
                ok = False
                print(f"[{target}] python resolve MISMATCH")
                print("   expected:", expected)
                print("   got     :", got)

            py_report = subprocess.run(
                [sys.executable, str(HERE / "dist_resolver.py"), str(root), target],
                capture_output=True, text=True, encoding="utf-8",
            ).stdout.strip()
            js_report = subprocess.run(
                [*node_cmd(), str(ROOT / "tools" / "dist_resolver.js"), str(root), target],
                capture_output=True, text=True, encoding="utf-8",
            ).stdout.strip()
            if py_report != js_report:
                ok = False
                print(f"[{target}] python/node selection report differs")
                print("   py:", py_report)
                print("   js:", js_report)
            else:
                print(f"[{target}] OK")

        # range vs series priority sanity
        assert dist_resolver.key_matches("1.21.100.x", [1, 21, 100])
        assert not dist_resolver.key_matches("1.21.10.x", [1, 21, 100])
        assert dist_resolver.key_matches("1.21.x", [1, 21, 100])
        assert dist_resolver.key_matches("<=1.21.100", [1, 21, 100])
        assert not dist_resolver.key_matches("<=1.21.100", [1, 21, 110])
        print("key-matching assertions OK")
        print("PASS" if ok else "FAIL")
        return 0 if ok else 1
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
