#!/usr/bin/env python3
"""Build the addon(s). Produces:
  dist/PCraftRevorn_BP.mcpack
  dist/PCraftRevorn_RP.mcpack
  dist/PCraftRevornGender_BP.mcpack
  dist/PCraftRevornGender_RP.mcpack
  dist/VCraft_BP.mcpack
  dist/VCraft_RP.mcpack
  dist/PCraftRevorn.mcaddon   (all packs, importable bundle)
"""
import os
import shutil
import zipfile
from pathlib import Path

root = Path(__file__).parent.resolve()
dist = root / 'dist'
dist.mkdir(exist_ok=True)

def new_zip(source: Path, dest: Path):
    if dest.exists():
        dest.unlink()
    base = source.resolve()
    with zipfile.ZipFile(dest, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipf:
        for entry in base.rglob('*'):
            if entry.is_file():
                rel = entry.relative_to(base).as_posix()
                zipf.write(entry, arcname=rel)

# Build individual packs
new_zip(root / 'behavior_pack', dist / 'PCraftRevorn_BP.mcpack')
new_zip(root / 'resource_pack', dist / 'PCraftRevorn_RP.mcpack')
new_zip(root / 'gender_pack' / 'behavior_pack', dist / 'PCraftRevornGender_BP.mcpack')
new_zip(root / 'gender_pack' / 'resource_pack', dist / 'PCraftRevornGender_RP.mcpack')
new_zip(root / 'vcraft_pack' / 'behavior_pack', dist / 'VCraft_BP.mcpack')
new_zip(root / 'vcraft_pack' / 'resource_pack', dist / 'VCraft_RP.mcpack')

# Build .mcaddon bundle
stage = dist / '_stage'
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir()

shutil.copytree(root / 'behavior_pack', stage / 'PCraftRevorn_BP')
shutil.copytree(root / 'resource_pack', stage / 'PCraftRevorn_RP')
shutil.copytree(root / 'gender_pack' / 'behavior_pack', stage / 'PCraftRevornGender_BP')
shutil.copytree(root / 'gender_pack' / 'resource_pack', stage / 'PCraftRevornGender_RP')
shutil.copytree(root / 'vcraft_pack' / 'behavior_pack', stage / 'VCraft_BP')
shutil.copytree(root / 'vcraft_pack' / 'resource_pack', stage / 'VCraft_RP')

new_zip(stage, dist / 'PCraftRevorn.mcaddon')
shutil.rmtree(stage)

print(f"Built packages in {dist}")