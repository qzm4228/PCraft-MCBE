# Extracts the original Forge jar into .work/mod so tools/generate.js can read it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$jarDir = Join-Path $root 'jar'
$jar = Get-ChildItem -LiteralPath $jarDir -Filter *.jar | Select-Object -First 1
if (-not $jar) { throw "No .jar found in $jarDir" }
$out = Join-Path $root '.work\mod'
if (Test-Path -LiteralPath $out) { Remove-Item -Recurse -Force -LiteralPath $out }
New-Item -ItemType Directory -Force -Path $out | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($jar.FullName, $out)
Write-Host "Extracted '$($jar.Name)' -> $out"
