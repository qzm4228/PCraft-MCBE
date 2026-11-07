"""Crop entity textures to the UV region their geometry actually samples.

Most imported sheets are 2000x2000 with the skin packed into a tiny corner; the
engine still decodes the whole canvas. This step:

  1. computes each geometry's UV bounding box (box UV and per-face UV);
  2. groups geometries and textures that are used together (client entities);
  3. crops every texture of the group to that box (+1 px) and shifts all UVs
     by -origin, updating texture_width/height.

Pixels outside the UV box can never be sampled, so the result is pixel-identical
in game. Textures referenced outside client entities (particles / attachables /
UI) are left alone.
"""

import json
import math
import re
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None

ROOT = Path(__file__).resolve().parent.parent
RP = ROOT / "resource_pack"
ENT = RP / "entity"
GEO = RP / "models/entity"
TEXDIR = RP / "textures" / "entity" / "pcraftrevorn"
PREFIX = "textures/entity/pcraftrevorn/"


def load(p):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def face_size(face, sx, sy, sz):
    if face in ("north", "south"):
        return sx, sy
    if face in ("east", "west"):
        return sz, sy
    return sx, sz  # up / down


def cube_rect(cube):
    uv = cube.get("uv")
    size = cube.get("size") or [0, 0, 0]
    sx, sy, sz = size
    if isinstance(uv, list) and len(uv) >= 2 and all(isinstance(x, (int, float)) for x in uv[:2]):
        u, v = uv[0], uv[1]
        return u, v, u + 2 * (sx + sz), v + (sy + sz)
    if isinstance(uv, dict):
        rects = []
        for face, d in uv.items():
            if isinstance(d, dict):
                fuv = d.get("uv")
                if not fuv:
                    continue
                fsz = d.get("uv_size") or face_size(face, sx, sy, sz)
                rects.append((fuv[0], fuv[1], fuv[0] + fsz[0], fuv[1] + fsz[1]))
            elif isinstance(d, list) and len(d) >= 2:
                fsz = face_size(face, sx, sy, sz)
                rects.append((d[0], d[1], d[0] + fsz[0], d[1] + fsz[1]))
        if rects:
            return (min(r[0] for r in rects), min(r[1] for r in rects),
                    max(r[2] for r in rects), max(r[3] for r in rects))
    return None


def geo_rect(g):
    rects = []
    for b in g.get("bones", []):
        for c in b.get("cubes", []):
            r = cube_rect(c)
            if r:
                rects.append(r)
    if not rects:
        return None
    return (min(r[0] for r in rects), min(r[1] for r in rects),
            max(r[2] for r in rects), max(r[3] for r in rects))


def shift_uvs(g, dx, dy):
    def walk(o):
        if isinstance(o, dict):
            for k, v in list(o.items()):
                if k == "uv" and isinstance(v, list) and len(v) >= 2 and all(isinstance(x, (int, float)) for x in v[:2]):
                    v[0] -= dx
                    v[1] -= dy
                else:
                    walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)

    walk(g)


def png_size(p):
    if Image is not None:
        with Image.open(p) as im:
            return im.size
    h = p.read_bytes()[:24]
    return int.from_bytes(h[16:20], "big"), int.from_bytes(h[20:24], "big")


def crop_png(p, box, nw, nh, aw, ah, tw, th):
    """Crop to box, clamp-pad UV overflow, then pad to a 16-aligned canvas.

    Every source texture is a multiple of 16; odd crop sizes get padded by the
    engine with an unknown alignment, which shifts the UVs.
    """
    if Image is None:
        raise SystemExit("[crop] Pillow is required for fast texture cropping")
    with Image.open(p) as im:
        im = im.convert("RGBA")
        part = im.crop((box[0], box[1], min(box[2], tw), min(box[3], th)))
        canvas = Image.new("RGBA", (aw, ah), (0, 0, 0, 0))
        canvas.paste(part, (0, 0))
        pw, ph = part.size
        if pw < nw and ph > 0:
            edge = part.crop((pw - 1, 0, pw, ph)).resize((nw - pw, ph), Image.NEAREST)
            canvas.paste(edge, (pw, 0))
        if ph < nh and nw > 0:
            edge = canvas.crop((0, ph - 1, nw, ph)).resize((nw, nh - ph), Image.NEAREST)
            canvas.paste(edge, (0, ph))
        canvas.save(p)


# ---------------------------------------------------------------- collect geos
geo_rects = {}
geo_sizes = {}
geo_files = {}
for p in GEO.glob("*.geo.json"):
    d = load(p)
    if not d:
        continue
    for g in d.get("minecraft:geometry", []):
        ident = (g.get("description") or {}).get("identifier")
        r = geo_rect(g)
        if not ident or not r:
            continue
        geo_rects[ident] = r
        geo_sizes[ident] = (
            (g["description"].get("texture_width") or 0),
            (g["description"].get("texture_height") or 0),
        )
        geo_files[ident] = p

# textures used outside client entities must not be cropped
external = set()
for sub in ("particles", "attachables", "ui"):
    d = RP / sub
    if not d.exists():
        continue
    for p in d.rglob("*.json"):
        try:
            t = p.read_text(encoding="utf-8")
        except Exception:
            continue
        for m in re.finditer(re.escape(PREFIX) + r"[A-Za-z0-9_./-]+", t):
            external.add(m.group(0).replace(PREFIX, ""))

# ------------------------------------------------------------ usage + grouping
parent_set = set()
parent = {}


def find(x):
    parent.setdefault(x, x)
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra


for p in ENT.glob("*.entity.json"):
    d = load(p)
    if not d:
        continue
    desc = d.get("minecraft:client_entity", {}).get("description", {})
    geos = set()
    for v in (desc.get("geometry") or {}).values():
        if isinstance(v, str):
            geos.add(v)
        elif isinstance(v, list):
            geos.update(x for x in v if isinstance(x, str))
    texs = set()
    for v in (desc.get("textures") or {}).values():
        if isinstance(v, str):
            texs.add(v)
        elif isinstance(v, list):
            texs.update(x for x in v if isinstance(x, str))
    geos = {g for g in geos if g in geo_rects}
    if not geos or not texs:
        continue
    nodes = [("g", g) for g in geos] + [("t", t) for t in texs]
    for n in nodes[1:]:
        union(nodes[0], n)

components = {}
for key in list(parent):
    components.setdefault(find(key), []).append(key)

cropped_files = 0
cropped_px_in = 0
cropped_px_out = 0
skipped = []

for root, nodes in components.items():
    geos = [n[1] for n in nodes if n[0] == "g"]
    texs = [n[1] for n in nodes if n[0] == "t"]
    if not geos or not texs:
        continue
    if any(t.replace(PREFIX, "") in external for t in texs):
        skipped.append((sorted(geos)[0], "used outside client entities"))
        continue

    declared = {geo_sizes[g] for g in geos}
    if len(declared) != 1:
        skipped.append((sorted(geos)[0], "geometries disagree on texture size"))
        continue
    tw, th = declared.pop()
    if not tw or not th:
        continue

    rs = [geo_rects[g] for g in geos]
    x0 = max(0, math.floor(min(r[0] for r in rs)) - 1)
    y0 = max(0, math.floor(min(r[1] for r in rs)) - 1)
    x1 = math.ceil(max(r[2] for r in rs)) + 1
    y1 = math.ceil(max(r[3] for r in rs)) + 1
    if x1 <= x0 or y1 <= y0:
        continue
    nw, nh = x1 - x0, y1 - y0
    aw = (nw + 15) // 16 * 16
    ah = (nh + 15) // 16 * 16
    if aw > 4096 or ah > 4096:
        skipped.append((sorted(geos)[0], f"crop too large {nw}x{nh}"))
        continue
    if x1 <= tw and y1 <= th and nw * nh >= tw * th * 0.98:
        continue  # already tight

    ok = True
    for t in texs:
        f = RP / (t if t.endswith(".png") else t + ".png")
        if not f.exists():
            ok = False
            skipped.append((sorted(geos)[0], f"missing {t}"))
            break
        if png_size(f) != (tw, th):
            ok = False
            skipped.append((sorted(geos)[0], f"size mismatch {t}"))
            break
    if not ok:
        continue

    for t in texs:
        f = RP / (t if t.endswith(".png") else t + ".png")
        crop_png(f, (x0, y0, x1, y1), nw, nh, aw, ah, tw, th)
        cropped_files += 1
        cropped_px_in += tw * th
        cropped_px_out += aw * ah

    for g in geos:
        p = geo_files[g]
        d = load(p)
        for gg in d.get("minecraft:geometry", []):
            if (gg.get("description") or {}).get("identifier") != g:
                continue
            shift_uvs(gg, x0, y0)
            gg["description"]["texture_width"] = aw
            gg["description"]["texture_height"] = ah
            check = geo_rect(gg)
            if check and (check[2] > aw + 0.01 or check[3] > ah + 0.01):
                print(f"[crop][debug] {g}: rect={check} new={aw}x{ah} origin=({x0},{y0})")
                print(f"[crop][debug] geos={geos}")
                print(f"[crop][debug] sizes={ {k: geo_sizes.get(k) for k in geos} }")
                print(f"[crop][debug] rects={ {k: geo_rects.get(k) for k in geos} }")
                raise SystemExit(f"[crop] UV out of range after crop: {g}")
        p.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

print(f"[crop] {cropped_files} textures cropped, "
      f"{cropped_px_in:,} -> {cropped_px_out:,} px "
      f"({100 * cropped_px_out / max(1, cropped_px_in):.1f}%)")
for g, why in skipped[:8]:
    print(f"[crop] skip {g}: {why}")
