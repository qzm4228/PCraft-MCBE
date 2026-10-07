#!/usr/bin/env python3
"""Top-level build entry point.

Delegates to the config-driven builder ``tools_py/build_config.py`` so the top
level and ``tools_py`` always agree (config = ``config/packs.json``).
"""
import runpy
from pathlib import Path

if __name__ == "__main__":
    runpy.run_path(
        str(Path(__file__).resolve().parent / "tools_py" / "build_config.py"),
        run_name="__main__",
    )
