# Builds the addon packages for every target in config/targets.json.
#
# Delegates to tools_py/build_config.py: one packer, one version source
# (config/version.json). The legacy zipper that produced an unversioned
# dist/PCraftRevorn.mcaddon is retired; use the target-suffixed packages
#   dist/PCraftRevorn_<version>_<target>.mcaddon
# that the builder writes.
#
# Usage:
#   .\build.ps1                      every target
#   .\build.ps1 -Target 1.21.100     a single target (repeat for more)
#   .\build.ps1 -List                show targets + dist.json hits
#   .\build.ps1 -Version 10.18.0     one-off override (config stays as is)
param(
  [string[]]$Target = @(),
  [string]$Version,
  [switch]$List
)

$ErrorActionPreference = 'Stop'

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Python 3 not found on PATH (tools_py/build_config.py needs it).' }

$buildArgs = @()
if ($List) { $buildArgs += '--list' }
foreach ($t in $Target) { $buildArgs += @('--target', $t) }
if ($Version) { $buildArgs += $Version }

& $python.Path (Join-Path $PSScriptRoot 'tools_py\build_config.py') @buildArgs
exit $LASTEXITCODE
