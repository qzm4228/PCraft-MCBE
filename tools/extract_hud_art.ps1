# Extracts the PCraftRevorn HUD art from the original Forge jar into the resource pack.
#
# Produces (all under resource_pack/textures/ui/pcraftrevorn/):
#   hud/struggle_<dir>_<state>.png   16 original 48x48 arrow sprites (verbatim)
#   hud/acid_indicator.png           original 320x32 bar frame (verbatim)
#   hud/acid_bar_fill.png            100 x 3x8 acid segments composited into one 300x8 strip
#   struggle_<dir>.png               16x16 hotbar icons cropped from the idle arrows
#
# The hud/ directory is not owned by tools_py/generate.py, so these survive regeneration.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

$jar = Get-ChildItem -LiteralPath (Join-Path $root 'jar') -Filter '*pcraftrevorn*.jar' | Select-Object -First 1
if (-not $jar) { throw "no PCraftRevorn jar found" }

$tmp = Join-Path $env:TEMP 'pcr_hud_art'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$prefix = 'assets/pcraftrevorn/textures/screens/'
$z = [System.IO.Compression.ZipFile]::OpenRead($jar.FullName)
$wanted = @()
foreach ($d in 'up', 'down', 'left', 'right') {
  foreach ($s in 'off', 'idle', 'correct', 'incorrect') { $wanted += "struggle_${d}_$s" }
}
for ($n = 1; $n -le 100; $n++) { $wanted += "acid_bar_$n" }
$wanted += 'acid_indicator'
foreach ($w in $wanted) {
  $e = $z.GetEntry("$prefix$w.png")
  if (-not $e) { throw "missing $prefix$w.png in $($jar.Name)" }
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $tmp "$w.png"), $true)
}
$z.Dispose()
Write-Host "extracted $($wanted.Count) source sprites from $($jar.Name)"

$outUi = Join-Path $root 'resource_pack\textures\ui\pcraftrevorn'
$outHud = Join-Path $outUi 'hud'
New-Item -ItemType Directory -Force -Path $outHud | Out-Null

function New-Argb([int]$w, [int]$h) {
  New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}
function Save-Png($bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

# ---- 1) verbatim sprites -----------------------------------------------------
foreach ($d in 'up', 'down', 'left', 'right') {
  foreach ($s in 'off', 'idle', 'correct', 'incorrect') {
    Copy-Item (Join-Path $tmp "struggle_${d}_$s.png") (Join-Path $outHud "struggle_${d}_$s.png") -Force
  }
}
Copy-Item (Join-Path $tmp 'acid_indicator.png') (Join-Path $outHud 'acid_indicator.png') -Force

# ---- 2) acid fill strip: segment n occupies x = (n-1)*3 .. +2 (matches the
# original draw call, which places segment 1 one pixel right of the frame). ----
$fill = New-Argb 300 8
for ($n = 1; $n -le 100; $n++) {
  $seg = New-Object System.Drawing.Bitmap((Join-Path $tmp "acid_bar_$n.png"))
  for ($y = 0; $y -lt 8; $y++) {
    for ($x = 0; $x -lt 3; $x++) {
      $c = $seg.GetPixel($x, $y)
      if ($c.A -gt 0) { $fill.SetPixel((($n - 1) * 3) + $x, $y, $c) }
    }
  }
  $seg.Dispose()
}
Save-Png $fill (Join-Path $outHud 'acid_bar_fill.png')

# ---- 3) 16x16 hotbar icons: crop the idle arrow's ink box, fit into 16x16 -----
foreach ($d in 'up', 'down', 'left', 'right') {
  $src = New-Object System.Drawing.Bitmap((Join-Path $tmp "struggle_${d}_idle.png"))
  $minX = $src.Width; $minY = $src.Height; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $src.Height; $y++) {
    for ($x = 0; $x -lt $src.Width; $x++) {
      if ($src.GetPixel($x, $y).A -ge 100) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($maxX -lt 0) { throw "no ink in struggle_${d}_idle.png" }
  $sw = $maxX - $minX + 1
  $sh = $maxY - $minY + 1
  $scale = [Math]::Min(16.0 / $sw, 16.0 / $sh)
  $dw = [int][Math]::Round($sw * $scale)
  $dh = [int][Math]::Round($sh * $scale)
  $ico = New-Argb 16 16
  $g = [System.Drawing.Graphics]::FromImage($ico)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $dst = New-Object System.Drawing.Rectangle([int]([Math]::Floor((16 - $dw) / 2)), [int]([Math]::Floor((16 - $dh) / 2)), $dw, $dh)
  $srect = New-Object System.Drawing.Rectangle($minX, $minY, $sw, $sh)
  $g.DrawImage($src, $dst, $srect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  $src.Dispose()
  Save-Png $ico (Join-Path $outUi "struggle_$d.png")
  Write-Host ("  icon struggle_{0}.png  {1}x{2} ink -> {3}x{4}" -f $d, $sw, $sh, $dw, $dh)
}

Write-Host "HUD art written to $outUi"
