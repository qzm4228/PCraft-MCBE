"""Memory-tiered entity textures via resource-pack subpacks.

The PCraft art ships 2000x2000 / 128x800 canvases with the used region packed
into a corner; uncompressed that is ~5.9 GB of texture memory, which is instant
OOM on a 6 GB phone. This module rewrites the **built** pack (the source art is
restored from the upstream assets by generate_entities.py on every run, so the
transformation has to happen here):

  * crop every texture group to its maximum UV extent and rewrite the geometry's
    ``texture_width`` / ``texture_height`` to the cropped canvas -> removes the
    empty canvas without touching a single UV;
  * base pack  = cropped art resized to at most LOW_CAP px   (~70 MB);
  * "hd" subpack = same paths resized to at most TIERS[0]cap (~270 MB).

The engine picks the highest subpack whose ``memory_tier`` the device can afford
(tier unit = 250 MB); anything below it keeps the base copy.

Why resizing is UV-safe: ``texture_width`` / ``texture_height`` define the UV
coordinate space in pixels, and the PNG resolution is independent of it (this is
how HD skin packs work).

Generated files live in ``.cache/tex_tiers`` and are rebuilt when the source PNG
is newer.
"""

from __future__ import annotations

import json
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

MARGIN = 2

# Hard ceiling for the base pack. The build fails above this so nobody
# reintroduces a 2000x2000 canvas by accident.
BASE_BUDGET_MB = 320


# --------------------------------------------------------------------------- #
# jsonc (geometry files are plain JSON, client entities may carry comments)
# --------------------------------------------------------------------------- #
def _load_jsonc(path: Path):
    text = path.read_text(encoding="utf-8")
    out, in_str, esc, i = [], False, False, 0
    n = len(text)
    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""
        if in_str:
            out.append(c)
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            i += 1
            continue
        if c == '"':
            in_str = True
            out.append(c)
            i += 1
            continue
        if c == "/" and nxt == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and nxt == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return json.loads("".join(out))


def _uv_extent(geom):
    maxu = maxv = 0.0

    def take(uv, size):
        nonlocal maxu, maxv
        if not (isinstance(uv, (list, tuple)) and len(uv) >= 2):
            return
        w = float(size[0]) if isinstance(size, (list, tuple)) and len(size) >= 1 else 0.0
        h = float(size[1]) if isinstance(size, (list, tuple)) and len(size) >= 2 else 0.0
        maxu = max(maxu, float(uv[0]) + w)
        maxv = max(maxv, float(uv[1]) + h)

    for bone in geom.get("bones", []):
        for cube in bone.get("cubes", []):
            uv = cube.get("uv")
            size = cube.get("uv_size") or cube.get("size")
            if isinstance(uv, dict):
                for face in uv.values():
                    if isinstance(face, dict):
                        take(face.get("uv"), face.get("uv_size"))
                    else:
                        take(face, size)
            else:
                take(uv, size)
    return maxu, maxv


def _plan(base_dir: Path) -> dict:
    """Decide crop canvases -> {'geo': {rel: {id:(w,h)}}, 'tex': {rel:(w,h)}}."""
    import math

    geo: dict[str, dict] = {}
    for path in sorted((base_dir / "models").rglob("*.geo.json")):
        try:
            data = _load_jsonc(path)
        except Exception:
            continue
        for g in data.get("minecraft:geometry", []):
            desc = g.get("description", {})
            ident = desc.get("identifier")
            if not ident:
                continue
            mu, mv = _uv_extent(g)
            geo[ident] = {
                "rel": path.relative_to(base_dir).as_posix(),
                "w": desc.get("texture_width"),
                "h": desc.get("texture_height"),
                "mu": mu,
                "mv": mv,
            }

    tex_to_geo: dict[str, set[str]] = {}
    for path in sorted((base_dir / "entity").rglob("*.json")):
        try:
            data = _load_jsonc(path)
        except Exception:
            continue
        ce = data.get("minecraft:client_entity", {}).get("description", {})
        gs = {g for g in (ce.get("geometry") or {}).values() if isinstance(g, str)}
        if not gs:
            continue
        for t in (ce.get("textures") or {}).values():
            if isinstance(t, str) and t.startswith("textures/"):
                tex_to_geo.setdefault(t + ".png", set()).update(gs)

    groups: dict[frozenset, list[str]] = {}
    for tex, gs in tex_to_geo.items():
        groups.setdefault(frozenset(gs), []).append(tex)

    tex_crop: dict[str, tuple[int, int]] = {}
    geo_size: dict[str, dict[str, tuple[int, int]]] = {}
    for gs, texs in groups.items():
        known = [g for g in gs if g in geo]
        if not known:
            continue
        declared = {(geo[g]["w"], geo[g]["h"]) for g in known if geo[g].get("w")}
        dims = set()
        for tex in texs:
            p = base_dir / tex
            if not p.exists():
                dims = set()
                break
            try:
                with Image.open(p) as im:
                    dims.add(im.size)
            except Exception:
                dims = set()
                break
        if len(declared) != 1 or len(dims) != 1 or dims != declared:
            continue  # mixed sizes -> resize only, no crop
        dw, dh = declared.pop()
        mu = max(geo[g]["mu"] for g in known)
        mv = max(geo[g]["mv"] for g in known)
        cw = min(dw, int(math.ceil(mu)) + MARGIN)
        ch = min(dh, int(math.ceil(mv)) + MARGIN)
        for tex in texs:
            tex_crop[tex] = (cw, ch)
        for g in known:
            geo_size.setdefault(geo[g]["rel"], {})[g] = (cw, ch)

    return {"geo": geo_size, "tex": tex_crop}


# --------------------------------------------------------------------------- #
# cache
# --------------------------------------------------------------------------- #
def _target(w: int, h: int, cap: int):
    big = max(w, h)
    if big <= cap:
        return None
    f = cap / big
    return max(1, round(w * f)), max(1, round(h * f))


def _write_variant(src: Path, dst: Path, cap: int, crop) -> bool:
    """Crop (optional) + resize + save. Returns False when no change is needed."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return True
    with Image.open(src) as im:
        im = im.convert("RGBA")
        if crop:
            im = im.crop((0, 0, min(crop[0], im.width), min(crop[1], im.height)))
        new = _target(im.width, im.height, cap)
        if new:
            im = im.resize(new, Image.LANCZOS)
        im.save(dst, "PNG", optimize=True)
    os.utime(dst, None)
    return True


def prepare(base_dir: Path) -> dict:
    base_dir = Path(base_dir)
    plan = _plan(base_dir)
    crops = plan["tex"]

    table: dict[str, dict] = {}
    budget = 0
    tex_root = base_dir / "textures"
    if not tex_root.is_dir():
        return {"tex": {}, "geo": {}}

    for src in sorted(tex_root.rglob("*.png")):
        if src.name == "pack_icon.png":
            continue
        rel = src.relative_to(base_dir).as_posix()
        crop = crops.get(rel)
        try:
            with Image.open(src) as im:
                w, h = im.size
        except Exception:
            continue
        cw, ch = crop if crop else (w, h)
        out_size = _target(cw, ch, LOW_CAP)
        if not crop and not out_size:
            continue  # already small, keep the original entry
        cache_dir = CACHE / src.parent.relative_to(base_dir)
        low = cache_dir / src.name
        if not _write_variant(src, low, LOW_CAP, crop):
            continue
        tiers = {}
        for tier in TIERS:
            dst = cache_dir / tier["folder"] / src.name
            if _write_variant(src, dst, tier["cap"], crop):
                tiers[tier["folder"]] = dst
        table[rel] = {"base": low, "tiers": tiers}
        final = out_size or (cw, ch)
        budget += final[0] * final[1] * 4

    geo_bytes: dict[str, bytes] = {}
    for rel, items in plan["geo"].items():
        path = base_dir / rel
        try:
            data = _load_jsonc(path)
        except Exception:
            continue
        for g in data.get("minecraft:geometry", []):
            desc = g.get("description", {})
            size = items.get(desc.get("identifier"))
            if size:
                desc["texture_width"] = size[0]
                desc["texture_height"] = size[1]
        geo_bytes[rel] = json.dumps(data, indent=2).encode("utf-8")

    print(
        f"[texture_tiers] cropped groups: {len(plan['geo'])} files | "
        f"tiered textures: {len(table)} | base {budget / 1024 / 1024:.0f} MB"
    )
    if budget / 1024 / 1024 > BASE_BUDGET_MB:
        raise SystemExit(
            f"[texture_tiers] base texture budget exceeded: "
            f"{budget / 1024 / 1024:.0f} MB > {BASE_BUDGET_MB} MB"
        )
    return {"tex": table, "geo": geo_bytes}


_CACHE: dict[str, dict] = {}


def cached(base_dir: Path) -> dict:
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
    """Swap in the cropped/tiered textures and the rewritten geometry files."""
    prep = cached(base_dir)
    table = prep["tex"]
    geo_bytes = prep["geo"]
    if not table and not geo_bytes:
        return entries

    pre = f"{prefix}/" if prefix else ""
    out: list[tuple[str, object]] = []
    for arcname, src in entries:
        rel = arcname[len(pre):] if pre and arcname.startswith(pre) else arcname
        info = table.get(rel)
        if info:
            out.append((arcname, info["base"]))
            for folder, path in info["tiers"].items():
                out.append((f"{pre}{folder}/{rel}", path))
        elif rel in geo_bytes:
            out.append((arcname, geo_bytes[rel]))
        else:
            out.append((arcname, src))
    return out
