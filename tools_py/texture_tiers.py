"""Memory-tiered entity textures via resource-pack subpacks.

The PCraft art ships 2000x2000 canvases. Uncompressed that is ~5.9 GB of
texture memory -- a 6 GB phone cannot survive it. This module makes the pack
scale with the device:

  * base pack  -> every texture resized to at most LOW_CAP px  (~120 MB)
  * "hd" subpack -> same paths resized to at most TIERS[0].cap  (~300 MB)

The engine picks the highest subpack whose ``memory_tier`` the device can
afford (tier unit = 250 MB, per Microsoft's docs); devices below it simply keep
the base copy.

Why resizing is UV-safe: ``texture_width`` / ``texture_height`` define the UV
coordinate space in pixels, and the PNG resolution is independent of it (this
is how HD skin packs work). We only change pixels, never geometry.

Generated files live in ``.cache/tex_tiers`` and are rebuilt when the source
PNG is newer.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "tex_tiers"

LOW_CAP = 256

# folder_name, max texture side, memory_tier (x250 MB), memory_performance_tier
TIERS = [
    {"folder": "hd", "cap": 512, "memory_tier": 12, "memory_performance_tier": 2},
]

# Hard ceiling for the base pack. The build fails above this so nobody
# reintroduces a 2000x2000 canvas by accident.
BASE_BUDGET_MB = 320


def _target(w: int, h: int, cap: int):
    big = max(w, h)
    if big <= cap:
        return None
    f = cap / big
    return max(1, round(w * f)), max(1, round(h * f))


def _render(src: Path, dst: Path, cap: int) -> bool:
    """Write a capped copy. Returns True when the file had to be resized."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return True
    with Image.open(src) as im:
        w, h = im.size
        new = _target(w, h, cap)
        if not new:
            return False
        im = im.convert("RGBA").resize(new, Image.LANCZOS)
        im.save(dst, "PNG", optimize=True)
    # keep the mtime ahead of the source so the cache is reused
    os.utime(dst, None)
    return True


def prepare(base_dir: Path) -> dict[str, dict]:
    """Map ``textures/...png`` -> generated tier paths (empty dict if none)."""
    base_dir = Path(base_dir)
    tex_root = base_dir / "textures"
    if not tex_root.is_dir():
        return {}

    out: dict[str, dict] = {}
    budget = 0
    for src in sorted(tex_root.rglob("*.png")):
        rel = src.relative_to(base_dir).as_posix()
        if src.name == "pack_icon.png":
            continue
        try:
            with Image.open(src) as im:
                w, h = im.size
        except Exception:
            continue
        new = _target(w, h, LOW_CAP)
        if not new:
            continue
        cache_dir = CACHE / src.parent.relative_to(base_dir)
        low = cache_dir / src.name
        if not _render(src, low, LOW_CAP):
            continue
        tiers = {}
        for tier in TIERS:
            dst = cache_dir / tier["folder"] / src.name
            if _render(src, dst, tier["cap"]):
                tiers[tier["folder"]] = dst
        out[rel] = {"base": low, "tiers": tiers}
        budget += new[0] * new[1] * 4

    print(f"[texture_tiers] base textures: {len(out)} / {budget / 1024 / 1024:.0f} MB")
    if budget / 1024 / 1024 > BASE_BUDGET_MB:
        raise SystemExit(
            f"[texture_tiers] base texture budget exceeded: "
            f"{budget / 1024 / 1024:.0f} MB > {BASE_BUDGET_MB} MB"
        )
    return out


_CACHE: dict[str, dict] = {}


def cached(base_dir: Path) -> dict[str, dict]:
    key = str(Path(base_dir).resolve())
    if key not in _CACHE:
        _CACHE[key] = prepare(Path(base_dir))
    return _CACHE[key]


def subpacks_manifest() -> list[dict]:
    return [
        {
            "folder_name": t["folder"],
            "name": f"{t['cap']}px textures",
            "memory_tier": t["memory_tier"],
            "memory_performance_tier": t["memory_performance_tier"],
        }
        for t in TIERS
    ]


def apply(entries: list[tuple[str, object]], base_dir: Path, prefix: str = "") -> list[tuple[str, object]]:
    """Swap base texture entries for their capped copies and add subpack entries."""
    table = cached(base_dir)
    if not table:
        return entries

    pre = f"{prefix}/" if prefix else ""
    out: list[tuple[str, object]] = []
    seen: set[str] = set()
    for arcname, src in entries:
        rel = arcname[len(pre):] if pre and arcname.startswith(pre) else arcname
        info = table.get(rel)
        if info:
            out.append((arcname, info["base"]))
            seen.add(rel)
            for folder, path in info["tiers"].items():
                out.append((f"{pre}{folder}/{rel}", path))
        else:
            out.append((arcname, src))
    return out
