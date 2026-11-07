"""Delete entity textures that nothing references.

The generators copy textures only for the models that are actually ported, but
a few strays can still slip in (leftovers from a source pack). Reference sources
are: client entities, attachables, particles, atlases and UI files - anything
mentioning textures/entity/pcraftrevorn/<name>.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RP = ROOT / "resource_pack"
BP = ROOT / "behavior_pack"
TEX = RP / "textures" / "entity" / "pcraftrevorn"
PREFIX = "textures/entity/pcraftrevorn/"

refs = set()

for p in RP.rglob("*.json"):
    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        continue
    for m in re.finditer(re.escape(PREFIX) + r"[A-Za-z0-9_./-]+", text):
        refs.add(m.group(0))
for p in BP.rglob("*.js"):
    try:
        text = p.read_text(encoding="utf-8")
    except Exception:
        continue
    for m in re.finditer(re.escape(PREFIX) + r"[A-Za-z0-9_./-]+", text):
        refs.add(m.group(0))

refs = {r if r.endswith(".png") else r + ".png" for r in refs}

removed = []
for p in sorted(TEX.glob("*.png")):
    key = PREFIX + p.name
    if key not in refs:
        p.unlink()
        removed.append(p.name)

print(f"[tex] pruned {len(removed)} unreferenced entity texture(s)")
for n in removed:
    print(f"   - {n}")
