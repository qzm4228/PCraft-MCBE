# Builds the addon(s). Produces:
#   dist/PCraftRevorn_BP.mcpack
#   dist/PCraftRevorn_RP.mcpack
#   dist/PCraftRevornGender_BP.mcpack
#   dist/PCraftRevornGender_RP.mcpack
#   dist/PCraftRevorn.mcaddon   (all four packs, importable bundle)
#
# Uses forward-slash zip entry names (required by Minecraft's importer).
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
if (-not (Test-Path -LiteralPath $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function New-Zip([string]$source, [string]$dest) {
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
  $base = (Resolve-Path -LiteralPath $source).Path
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
}

New-Zip (Join-Path $root 'behavior_pack') (Join-Path $dist 'PCraftRevorn_BP.mcpack')
New-Zip (Join-Path $root 'resource_pack') (Join-Path $dist 'PCraftRevorn_RP.mcpack')
New-Zip (Join-Path $root 'gender_pack\behavior_pack') (Join-Path $dist 'PCraftRevornGender_BP.mcpack')
New-Zip (Join-Path $root 'gender_pack\resource_pack') (Join-Path $dist 'PCraftRevornGender_RP.mcpack')

# .mcaddon = a zip containing all pack folders at the top level
$stage = Join-Path $dist '_stage'
if (Test-Path -LiteralPath $stage) { Remove-Item -Recurse -Force -LiteralPath $stage }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -Recurse (Join-Path $root 'behavior_pack') (Join-Path $stage 'PCraftRevorn_BP')
Copy-Item -Recurse (Join-Path $root 'resource_pack') (Join-Path $stage 'PCraftRevorn_RP')
Copy-Item -Recurse (Join-Path $root 'gender_pack\behavior_pack') (Join-Path $stage 'PCraftRevornGender_BP')
Copy-Item -Recurse (Join-Path $root 'gender_pack\resource_pack') (Join-Path $stage 'PCraftRevornGender_RP')
New-Zip $stage (Join-Path $dist 'PCraftRevorn.mcaddon')
Remove-Item -Recurse -Force -LiteralPath $stage

Write-Host "Built packages in $dist"
