# Links the addon pack folders into Minecraft Bedrock's "development" pack
# folders so they show up directly in world settings (no .mcaddon re-import).
#
#   scripts    -> edit then run  /reload  in game
#   resources  -> edit then leave & re-enter the world
#
# Uses directory junctions (mklink /J): works across drives and needs no admin.
# Run again any time; it re-creates the links.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# --- locate ...\games\com.mojang ---
$candidates = @()
$candidates += Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang'
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Microsoft.MinecraftUWP_*' -ErrorAction SilentlyContinue |
  ForEach-Object { $candidates += Join-Path $_.FullName 'LocalState\games\com.mojang' }
$mojang = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $mojang) {
  Write-Host "Could not find com.mojang. Edit `$mojang in this script to the right path." -ForegroundColor Red
  exit 1
}

$devBp = Join-Path $mojang 'development_behavior_packs'
$devRp = Join-Path $mojang 'development_resource_packs'
New-Item -ItemType Directory -Force -Path $devBp, $devRp | Out-Null

# safely remove a link (rmdir removes a junction without touching its target)
function Remove-Link([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { return }
  $item = Get-Item -LiteralPath $p -Force
  if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    & cmd /c rmdir "$p" | Out-Null
  } else {
    Remove-Item -LiteralPath $p -Recurse -Force
  }
}

$links = @(
  @{ link = (Join-Path $devBp 'PCraftRevorn_BP');       target = (Join-Path $root 'behavior_pack') },
  @{ link = (Join-Path $devRp 'PCraftRevorn_RP');       target = (Join-Path $root 'resource_pack') },
  @{ link = (Join-Path $devBp 'PCraftRevornGender_BP'); target = (Join-Path $root 'gender_pack\behavior_pack') },
  @{ link = (Join-Path $devRp 'PCraftRevornGender_RP'); target = (Join-Path $root 'gender_pack\resource_pack') }
)

foreach ($l in $links) {
  if (-not (Test-Path -LiteralPath $l.target)) { Write-Host "MISSING target: $($l.target)" -ForegroundColor Red; continue }
  Remove-Link $l.link
  & cmd /c mklink /J "$($l.link)" "$($l.target)" | Out-Null
  if (Test-Path -LiteralPath $l.link) { Write-Host "OK   $($l.link)" -ForegroundColor Green }
  else { Write-Host "FAIL $($l.link)" -ForegroundColor Red }
}

Write-Host ""
Write-Host "Linked into: $mojang"
Write-Host "In world settings enable the 4 dev packs, then: scripts=/reload, resources=re-enter world."
