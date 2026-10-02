# Builds dist/*.mcpack and dist/*.mcaddon.
#
# Bedrock requires zip entries to use forward slashes ("/"); PowerShell's
# Compress-Archive can write backslashes, so entries are written explicitly
# via System.IO.Compression with normalized paths.
param([string]$Version = '261002-beta-5')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

function New-Zip([string]$outFile, $entries) {
  if (Test-Path $outFile) { Remove-Item $outFile -Force }
  $fs = [IO.File]::Open($outFile, [IO.FileMode]::Create)
  $zip = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($e in $entries) {
      $base = (Resolve-Path $e.dir).Path.TrimEnd('\')
      Get-ChildItem $base -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($base.Length + 1).Replace('\', '/')
        $name = if ($e.name) { $e.name + '/' + $rel } else { $rel }
        $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
        $s = $entry.Open()
        try {
          $bytes = [IO.File]::ReadAllBytes($_.FullName)
          $s.Write($bytes, 0, $bytes.Length)
        } finally { $s.Dispose() }
      }
    }
  } finally { $zip.Dispose(); $fs.Dispose() }
}

$packs = @(
  @{ name = 'PCraftRevorn_BP';       dir = Join-Path $root 'behavior_pack' },
  @{ name = 'PCraftRevorn_RP';       dir = Join-Path $root 'resource_pack' },
  @{ name = 'PCraftRevornGender_BP'; dir = Join-Path $root 'gender_pack\behavior_pack' },
  @{ name = 'PCraftRevornGender_RP'; dir = Join-Path $root 'gender_pack\resource_pack' },
  @{ name = 'VCraft_BP';             dir = Join-Path $root 'vcraft_pack\behavior_pack' },
  @{ name = 'VCraft_RP';             dir = Join-Path $root 'vcraft_pack\resource_pack' }
)

foreach ($p in $packs) {
  New-Zip (Join-Path $dist ($p.name + '.mcpack')) @(@{ name = ''; dir = $p.dir })
}
New-Zip (Join-Path $dist 'PCraftRevorn.mcaddon') ($packs | ForEach-Object { @{ name = $_.name; dir = $_.dir } })
Copy-Item (Join-Path $dist 'PCraftRevorn.mcaddon') (Join-Path $dist ('PCraftRevorn_' + $Version + '.mcaddon')) -Force

Write-Host "Built dist packages (version $Version)."
Get-ChildItem $dist -File | ForEach-Object { '{0,10:N0} KB  {1}' -f ($_.Length / 1KB), $_.Name }
