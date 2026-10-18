# Builds dist/*.mcpack + dist/*.mcaddon through the config-driven builder.
#
# All packing lives in tools_py/build_config.py -- the same code that
# pipeline.py, build.py and build_win.ps1 use. It reads config/packs.json and
# config/targets.json, and the version comes from config/version.json, so this
# script never owns or hardcodes a version.
#
# The old inline zipper is retired: it defaulted to '261002-beta-2', ignored
# targets and skipped the manifest / localisation pass.
#
# Usage:
#   .\tools\build.ps1                      every target in config/targets.json
#   .\tools\build.ps1 -Target 1.21.100     one target (repeat -Target for more)
#   .\tools\build.ps1 -List                show targets + dist.json hits
#   .\tools\build.ps1 -Version 10.18.0     one-off override (config stays as is)
param(
  [string[]]$Target = @(),
  [string]$Version,
  [switch]$List
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python 3 not found on PATH (tools_py/build_config.py needs it).' }

$buildArgs = @()
if ($List) { $buildArgs += '--list' }
foreach ($t in $Target) { $buildArgs += @('--target', $t) }
if ($Version) { $buildArgs += $Version }

& $python.Path (Join-Path $root 'tools_py\build_config.py') @buildArgs
exit $LASTEXITCODE
