#!/usr/bin/env python3
"""Builds dist/*.mcpack and dist/*.mcaddon from config/packs.json.
Supports i18n format and Unicode-friendly names.
"""
from __future__ import annotations
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
CONFIG = ROOT / "config" / "packs.json"
DIST = ROOT / "dist"

def load_config() -> dict:
    """Load configuration from JSON."""
    with open(CONFIG, 'r', encoding='utf-8') as f:
        return json.load(f)

def new_zip(out_file: Path, entries: list) -> None:
    out_file = Path(out_file)
    if out_file.exists():
        out_file.unlink()
    with zipfile.ZipFile(out_file, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, directory in entries:
            base = Path(directory)
            files = [p for p in base.rglob("*") if p.is_file()]
            files.sort(key=lambda p: p.relative_to(base).as_posix())
            for f in files:
                rel_name = f.relative_to(base).as_posix()
                arcname = f"{name}/{rel_name}" if name else rel_name
                zf.write(f, arcname)

def main(argv) -> int:
    config = load_config()
    ensure_dir(DIST)
    
    print("📦 开始构建...")
    
    # 构建每个独立的 mcpack
    for key, pack_config in config.items():
        source_dir = ROOT / pack_config["base_dir"]
        folder_name = pack_config["folder_name"]
        output_name = pack_config.get("output_name", f"{folder_name}_{key}")
        out_name = f"{output_name}.mcpack"
        out_file = DIST / out_name
        print(f"  构建 {out_name}... -> {pack_config['display_name']['en_US']}")
        new_zip(out_file, [(folder_name, source_dir)])
    
    # 构建 mcaddon (所有 packs 在顶层文件夹)
    stage = DIST / "_stage"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    
    for key, pack_config in config.items():
        source_dir = ROOT / pack_config["base_dir"]
        folder_name = pack_config["folder_name"]
        dest_dir = stage / folder_name
        if dest_dir.exists():
            shutil.rmtree(dest_dir)
        shutil.copytree(source_dir, dest_dir)
    
    new_zip(DIST / "PCraftRevorn.mcaddon", [("", stage)])
    shutil.copyfile(DIST / "PCraftRevorn.mcaddon", DIST / "PCraftRevorn_261002-beta-2.mcaddon")
    
    # 清理 stage
    shutil.rmtree(stage)
    
    print(f"\n✅ {len(config)} 个组件构建完成")
    print(f"📂 输出目录: {DIST}")
    
    for f in sorted(DIST.iterdir()):
        if f.is_file() and not f.name.endswith("__pycache__"):
            kb = f.stat().st_size / 1024
            print(f"{kb:>10,.0f} KB  {f.name}")
    
    return 0

def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path

if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
