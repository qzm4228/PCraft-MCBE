# Extracts the VCM (Internalised) assets the port needs out of the Forge jar.
#
# Produces (all under .work/vcm/, which is gitignored - never packed, never distributed):
#   assets/vcm/geo/*.geo.json          GeckoLib models  (bat_girl, bunny, neko, lamia, druid, vcmslime, druidstaff, vampiricdagger)
#   assets/vcm/animations/*.json       GeckoLib animations (keyframes need converting, see docs/port-checklist.md 1.12)
#   assets/vcm/textures/entities/*     creature skins: <name>nobelly = empty belly, <name> = full belly
#   assets/vcm/textures/item/*         the 7 item textures
#   assets/vcm/textures/particle/*     particle textures
#   assets/vcm/particles/*.json        the 5 Java particle definitions (rewritten as Bedrock particles)
#   assets/vcm/models/**, assets/vcm/lang/en_us.json
#   data/vcm/**                        loot table, dagger recipe, custom damage type
#
# The jar itself is gitignored too (third-party reference, not redistributed), so this
# script is the reproducible way to get the assets back after a clean checkout.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Add-Type -AssemblyName System.IO.Compression.FileSystem

$jar = Get-ChildItem -LiteralPath (Join-Path $root 'jar') -Filter '*Internalised*.jar' | Select-Object -First 1
if (-not $jar) { throw 'no Internalised jar found in jar/' }

$out = Join-Path $root '.work\vcm'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path $out | Out-Null

$prefixes = @(
  'assets/vcm/geo/',
  'assets/vcm/animations/',
  'assets/vcm/textures/',
  'assets/vcm/particles/',
  'assets/vcm/models/',
  'assets/vcm/lang/',
  'data/vcm/'
)

$zip = [System.IO.Compression.ZipFile]::OpenRead($jar.FullName)
$count = 0
foreach ($e in $zip.Entries) {
  if ($e.FullName -match '/$') { continue }
  $keep = $false
  foreach ($p in $prefixes) {
    if ($e.FullName.StartsWith($p)) { $keep = $true; break }
  }
  if (-not $keep) { continue }
  $dest = Join-Path $out ($e.FullName -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $dest, $true)
  $count++
}
$zip.Dispose()

Write-Host ("extracted {0} files from {1}" -f $count, $jar.Name)
Write-Host ("-> {0}" -f $out)
Get-ChildItem $out -Recurse -File |
  Group-Object { $_.Directory.FullName.Replace($out, '').TrimStart('\') } |
  Sort-Object Name |
  ForEach-Object { Write-Host ("  {0,-30} {1,3}" -f $_.Name, $_.Count) }
