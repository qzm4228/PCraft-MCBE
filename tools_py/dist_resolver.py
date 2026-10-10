#!/usr/bin/env python3
"""``dist.json`` resolver — per-version file selection for Bedrock packs.

Every directory of a pack may contain a ``dist.json`` mapping an **output file**
to a set of **version keys** -> **variant source files** (relative to the
``dist.json``)::

    {
      "menu.json": {
        "1.21.0.x": true,                       // -> menu.json.1.21.0.x (value omitted)
        "1.21.100.x": "menu.json.1.21.100",      // explicit source
        "<=1.26.0": "menu.json.26"               // range key
      }
    }

Rules
-----
* A file that is not named in any ``dist.json`` (a *rule*) is emitted as-is.
* A rule with no matching key for the target falls back to the output file
  itself (the "universal" version), which must exist.
* Any file that appears as a **variant source** is never emitted on its own.
* ``dist.json`` is never packed.
* The output file is always written under its own name (``menu.json``), only its
  *content* comes from the selected variant.

Version keys
------------
* series / wildcard: ``1.21.100.x``, ``1.21.x`` — dotted, ``x`` (case
  insensitive) matches any component. Trailing ``x`` components may be absent
  from the target. Longer literal prefixes are more specific.
* range: ``<=1.21.100``, ``>=1.21.60``, ``<1.26.0``, ``>1.21.80``.

When several keys match, the most specific wins: series rules (by literal
component count) beat range rules; ties are broken by the highest numeric value.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

DIST_FILE = "dist.json"
WILDCARD = "x"
_RANGE_RE = re.compile(r"^\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)*)\s*$")
_NUM_RE = re.compile(r"^\d+$")


# --------------------------------------------------------------------------- #
# version keys
# --------------------------------------------------------------------------- #
def parse_version(value) -> list[int]:
    s = str(value).strip()
    if isinstance(value, (list, tuple)):
        return [int(x) for x in value]
    m = re.match(r"^(\d+(?:\.\d+)*)", s)
    if not m:
        raise ValueError(f"bad version: {value!r}")
    return [int(x) for x in m.group(1).split(".")]


def compare_versions(a: list[int], b: list[int]) -> int:
    n = max(len(a), len(b))
    for i in range(n):
        x = a[i] if i < len(a) else 0
        y = b[i] if i < len(b) else 0
        if x != y:
            return -1 if x < y else 1
    return 0


def is_range_key(key: str) -> bool:
    return bool(_RANGE_RE.match(key))


def key_matches(key: str, target: list[int]) -> bool:
    key = key.strip()
    m = _RANGE_RE.match(key)
    if m:
        op, ver = m.group(1), [int(x) for x in m.group(2).split(".")]
        c = compare_versions(target, ver)
        return {"<=": c <= 0, ">=": c >= 0, "<": c < 0, ">": c > 0}[op]
    core = key.split(".")
    while core and core[-1].lower() == WILDCARD:
        core.pop()
    if len(core) > len(target):
        return False
    for i, c in enumerate(core):
        if c.lower() == WILDCARD:
            continue
        if not _NUM_RE.match(c) or int(c) != target[i]:
            return False
    return True


def key_specificity(key: str) -> tuple[int, int]:
    key = key.strip()
    m = _RANGE_RE.match(key)
    if m:
        return (1, len(m.group(2).split(".")))
    parts = key.split(".")
    literals = sum(1 for p in parts if p.lower() != WILDCARD and _NUM_RE.match(p))
    return (2, literals)


def key_value(key: str) -> list[int]:
    key = key.strip()
    m = _RANGE_RE.match(key)
    s = m.group(2) if m else key
    return [int(p) for p in s.split(".") if _NUM_RE.match(p)]


def pick_variant(variants: dict[str, str], target: list[int]):
    """variants: {key: sourceRel}. Return (key, sourceRel) or None."""
    cands = [(k, v) for k, v in variants.items() if key_matches(k, target)]
    if not cands:
        return None
    cands.sort(key=lambda kv: (key_specificity(kv[0]), key_value(kv[0]), kv[0]), reverse=True)
    return cands[0]


# --------------------------------------------------------------------------- #
# rules
# --------------------------------------------------------------------------- #
def _norm(path: Path) -> str:
    return path.as_posix()


def load_spec(path: Path) -> dict[str, dict[str, str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path}: top level must be an object")
    out: dict[str, dict[str, str]] = {}
    for out_name, variants in data.items():
        if out_name.startswith("_") or out_name.startswith("//"):
            continue  # comment
        if not isinstance(variants, dict):
            raise ValueError(f"{path}: '{out_name}' must map version keys to a source")
        v: dict[str, str] = {}
        for key, src in variants.items():
            if key.startswith("_") or key.startswith("//"):
                continue
            if src is True or src is None:
                v[key] = f"{out_name}.{key}"  # default source name
            elif isinstance(src, str):
                v[key] = src
            else:
                raise ValueError(f"{path}: '{out_name}.{key}' value must be a string or true")
        out[out_name] = v
    return out


def collect_rules(pack_root: Path):
    """Return (rules, sources).

    rules:   { outRel(from pack_root): { key: sourceRel(from pack_root) } }
    sources: set of sourceRel that must never be emitted directly
    """
    pack_root = Path(pack_root)
    rules: dict[str, dict[str, str]] = {}
    sources: set[str] = set()
    for dist in sorted(pack_root.rglob(DIST_FILE)):
        d = dist.parent
        spec = load_spec(dist)
        for out_name, variants in spec.items():
            out_rel = _norm((d / out_name).resolve().relative_to(pack_root.resolve()))
            m: dict[str, str] = {}
            for key, src in variants.items():
                src_rel = _norm((d / src).resolve().relative_to(pack_root.resolve()))
                m[key] = src_rel
                sources.add(src_rel)
            rules[out_rel] = m
    return rules, sources


def resolve(pack_root: Path, target) -> dict[str, Path]:
    """Return {outputRel: sourceAbsPath} for one pack and one target."""
    pack_root = Path(pack_root)
    tgt = parse_version(target)
    rules, sources = collect_rules(pack_root)
    out: dict[str, Path] = {}
    for f in sorted(pack_root.rglob("*")):
        if not f.is_file():
            continue
        rel = _norm(f.relative_to(pack_root))
        if f.name == DIST_FILE or rel in sources:
            continue
        rule = rules.get(rel)
        if rule:
            pick = pick_variant(rule, tgt)
            out[rel] = (pack_root / Path(pick[1])) if pick else f
        else:
            out[rel] = f
    return out


def selections(pack_root: Path, target) -> list[dict]:
    """Report which variant each ruled file resolves to (for logging/auditing)."""
    pack_root = Path(pack_root)
    tgt = parse_version(target)
    rules, _ = collect_rules(pack_root)
    rows = []
    for rel, variants in sorted(rules.items()):
        pick = pick_variant(variants, tgt)
        rows.append(
            {
                "file": rel,
                "key": pick[0] if pick else None,
                "source": pick[1] if pick else rel,
                "fallback": pick is None,
            }
        )
    return rows


def validate(pack_root: Path) -> list[str]:
    """Return a list of warning strings (empty = clean)."""
    pack_root = Path(pack_root)
    rules, sources = collect_rules(pack_root)
    warns: list[str] = []
    for rel, variants in sorted(rules.items()):
        base = pack_root / rel
        if not base.exists():
            warns.append(f"{rel}: output file missing (needed as universal fallback)")
        for key, src in variants.items():
            if not (pack_root / src).exists():
                warns.append(f"{rel}: variant '{key}' -> '{src}' not found")
    # orphan heuristic: files that look like variants but are not referenced
    for f in sorted(pack_root.rglob("*")):
        if not f.is_file() or f.name == DIST_FILE:
            continue
        rel = _norm(f.relative_to(pack_root))
        if rel in sources:
            continue
        name = f.name
        if re.search(r"\.\d+\.\d*\.[\dx]+(\.|$)|\.x(\.|$)", name):
            warns.append(f"{rel}: looks like a variant but is not referenced by any dist.json")
    return warns


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    pack = Path(argv[0]) if argv else Path.cwd()
    target = argv[1] if len(argv) > 1 else "1.21.100"
    for w in validate(pack):
        print("WARN", w)
    print(f"# {pack} @ {target}")
    for row in selections(pack, target):
        tag = "fallback" if row["fallback"] else row["key"]
        print(f"  {row['file']:<48} -> {row['source']}   [{tag}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
