"""Converts Java structure .nbt (big-endian, gzip) into a compact JS data table
that scripts can place with BlockPermutation.resolve().
Avoids the binary .mcstructure format entirely.

Port of tools/nbt_to_data.js.

Usage: python tools_py/nbt_to_data.py
Output: behavior_pack/scripts/pcraftrevorn/data/structures.js
"""
from __future__ import annotations

import gzip
import json
import struct
import sys
from pathlib import Path

from _common import ROOT, ensure_dir, rel, write_text

MOD = ROOT / ".work" / "mod"
SRC = MOD / "data" / "pcraftrevorn" / "structures"
OUT = ROOT / "behavior_pack" / "scripts" / "pcraftrevorn" / "data" / "structures.js"


# ---------- big-endian NBT reader ----------
class NbtReader:
    def __init__(self, buf: bytes):
        self.buf = buf
        self.i = 0

    def u8(self) -> int:
        v = self.buf[self.i]
        self.i += 1
        return v

    def i16(self) -> int:
        v = struct.unpack_from(">h", self.buf, self.i)[0]
        self.i += 2
        return v

    def i32(self) -> int:
        v = struct.unpack_from(">i", self.buf, self.i)[0]
        self.i += 4
        return v

    def i64(self) -> int:
        v = int.from_bytes(self.buf[self.i : self.i + 8], "big", signed=True)
        self.i += 8
        return v

    def f32(self) -> float:
        v = struct.unpack_from(">f", self.buf, self.i)[0]
        self.i += 4
        return v

    def f64(self) -> float:
        v = struct.unpack_from(">d", self.buf, self.i)[0]
        self.i += 8
        return v

    def string(self) -> str:
        n = struct.unpack_from(">H", self.buf, self.i)[0]  # readUInt16BE
        self.i += 2
        s = self.buf[self.i : self.i + n].decode("utf-8", errors="replace")
        self.i += n
        return s

    def payload(self, t: int):
        if t == 0:
            return None
        if t == 1:
            return self.u8()
        if t == 2:
            return self.i16()
        if t == 3:
            return self.i32()
        if t == 4:
            return self.i64()
        if t == 5:
            return self.f32()
        if t == 6:
            return self.f64()
        if t == 7:
            n = self.i32()
            a = self.buf[self.i : self.i + n]
            self.i += n
            return a
        if t == 8:
            return self.string()
        if t == 9:
            et = self.u8()
            n = self.i32()
            return [self.payload(et) for _ in range(n)]
        if t == 10:
            o = {}
            while True:
                et = self.u8()
                if et == 0:
                    break
                key = self.string()
                o[key] = self.payload(et)
            return o
        if t == 11:
            n = self.i32()
            return [self.i32() for _ in range(n)]
        if t == 12:
            n = self.i32()
            return [self.i64() for _ in range(n)]
        raise ValueError("bad tag " + str(t))


def read_nbt(buf: bytes):
    r = NbtReader(buf)
    t = r.u8()
    if t != 10:
        raise ValueError("root not compound")
    r.string()
    return r.payload(10)


# ---------- Java -> Bedrock state mapping ----------
STAIR_DIR = {"east": 0, "west": 1, "south": 2, "north": 3}
FACE_DIR = {"north": "north", "east": "east", "south": "south", "west": "west"}
WALL_CONN = {"none": "none", "low": "short", "tall": "tall"}


def js_number(v):
    """Mirror JS Number()/JSON.stringify: whole-valued numbers print without .0."""
    if isinstance(v, bool):
        v = 1 if v else 0
    if isinstance(v, str):
        v = float(v)
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def map_block(java_name: str, props):
    states = {}
    if props:
        if java_name.endswith("_stairs"):
            if "half" in props:
                states["upside_down_bit"] = 1 if props["half"] == "top" else 0
            if "facing" in props:
                states["weirdo_direction"] = STAIR_DIR.get(props["facing"], 0)
        elif java_name.endswith("_wall"):
            for d in ("east", "north", "south", "west"):
                if d in props:
                    states[f"wall_connection_type_{d}"] = WALL_CONN.get(props[d], "none")
            if "up" in props:
                states["wall_post_bit"] = 1 if props["up"] == "true" else 0
        elif java_name in ("minecraft:basalt", "minecraft:chain"):
            if "axis" in props:
                states["pillar_axis"] = props["axis"]
        elif java_name == "minecraft:chest":
            if "facing" in props and props["facing"] in FACE_DIR:
                states["minecraft:cardinal_direction"] = FACE_DIR[props["facing"]]
        elif java_name.startswith("pcraftrevorn:piglin_throne"):
            if "facing" in props and props["facing"] in FACE_DIR:
                states["minecraft:cardinal_direction"] = FACE_DIR[props["facing"]]
        elif java_name == "minecraft:lava":
            states["liquid_depth"] = js_number(props.get("level") or 0)
    return {"name": java_name, "states": states}


# ---------- convert ----------
def convert(file) -> dict:
    data = Path(file).read_bytes()
    if len(data) >= 2 and data[0] == 0x1F and data[1] == 0x8B:
        data = gzip.decompress(data)
    root = read_nbt(data)
    sx, sy, sz = root["size"]
    palette = [map_block(p["Name"], p.get("Properties")) for p in (root.get("palette") or [])]
    blocks = []
    for b in root.get("blocks") or []:
        x, y, z = b["pos"]
        idx = int(b["state"])
        if 0 <= idx < len(palette) and palette[idx]["name"] == "minecraft:air":
            continue
        blocks.append([x, y, z, idx])
    # strip air from palette to compact (remap indices)
    remap = {}
    new_palette = []
    for i, p in enumerate(palette):
        if p["name"] == "minecraft:air":
            continue
        remap[i] = len(new_palette)
        new_palette.append(p)
    compact = [[x, y, z, remap[i]] for (x, y, z, i) in blocks]
    entities = []
    for e in root.get("entities") or []:
        eid = (e.get("nbt") or {}).get("id")
        if not eid or str(eid).startswith("minecraft:experience_orb"):
            continue
        pos = e["pos"]
        entities.append(
            {
                "id": str(eid),
                "x": js_number(pos[0]),
                "y": js_number(pos[1]),
                "z": js_number(pos[2]),
            }
        )
    return {"size": [sx, sy, sz], "palette": new_palette, "blocks": compact, "entities": entities}


TARGETS = {"remnant_throne_room": "remnant_throne_room.nbt"}


def main() -> int:
    out = {}
    for name, filename in TARGETS.items():
        full = SRC / filename
        if not full.exists():
            print("missing " + str(full), file=sys.stderr)
            return 1
        out[name] = convert(full)
        d = out[name]
        size = "x".join(str(v) for v in d["size"])
        print(
            f"{name}: {len(d['blocks'])} blocks, {len(d['palette'])} palette, "
            f"{len(d['entities'])} entities, size {size}"
        )

    js = (
        "// AUTO-GENERATED by tools/nbt_to_data.js. Java structure -> Bedrock placeable data.\n"
        + "// blocks: [x, y, z, paletteIndex]; entities: {id, x, y, z}\n"
        + "export const STRUCTURES = "
        + json.dumps(out, separators=(",", ":"), ensure_ascii=False)
        + ";\n"
    )
    ensure_dir(OUT.parent)
    write_text(OUT, js)
    print("wrote " + rel(OUT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
