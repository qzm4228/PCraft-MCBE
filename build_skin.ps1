# Standalone skin pack build (independent from the PCraftRevorn addon).
# Produces: dist/SandmoSkin.mcpack  (double-click to import as a skin pack)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'skin_pack'
$dist = Join-Path $root 'dist'
if (-not (Test-Path -LiteralPath $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$dest = Join-Path $dist 'SandmoSkin.mcpack'
if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }

$base = (Resolve-Path -LiteralPath $src).Path
$zip = [System.IO.Compression.ZipFile]::Open($dest, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $base -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($base.Length + 1).Replace('\', '/')
    $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $out = $entry.Open()
    $in = [System.IO.File]::OpenRead($_.FullName)
    try { $in.CopyTo($out) } finally { $in.Dispose(); $out.Dispose() }
  }
} finally { $zip.Dispose() }

Write-Host "Built skin pack: $dest"
