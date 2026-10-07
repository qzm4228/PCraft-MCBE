#!/usr/bin/env python3
"""Alias for the config-driven builder (``tools_py/build_config.py``).

All packing is centralised in ``build_config.py`` and driven by
``config/packs.json`` so every entry point produces identical output. This file
is kept as a thin wrapper for scripts that call ``tools_py/build.py [version]``.

Optional argv[0] overrides the version for this build only (edit the config to
persist a version change).
"""
import runpy
import sys
from pathlib import Path

if __name__ == "__main__":
    runpy.run_path(
        str(Path(__file__).resolve().parent / "build_config.py"),
        run_name="__main__",
    )
