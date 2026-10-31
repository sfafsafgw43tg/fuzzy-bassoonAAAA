[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [int]$Width = 1280,
  [int]$Height = 720,
  [ValidateSet('stretch','fit','crop')][string]$Fit = 'fit'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw "Input image was not found: $InputPath" }
if ($Width -lt 16 -or $Height -lt 16) { throw 'Width and height must both be at least 16 pixels.' }
Add-Type -AssemblyName System.Drawing
$source = [System.Drawing.Image]::FromFile((Resolve-Path $InputPath).Path)
$bitmap = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.Clear([System.Drawing.Color]::Black)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $sw = [double]$source.Width; $sh = [double]$source.Height
  if ($Fit -eq 'stretch') {
    $dest = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
  } else {
    $scale = if ($Fit -eq 'crop') { [Math]::Max($Width / $sw, $Height / $sh) } else { [Math]::Min($Width / $sw, $Height / $sh) }
    $dw = [int][Math]::Round($sw * $scale); $dh = [int][Math]::Round($sh * $scale)
    $dest = New-Object System.Drawing.Rectangle(([int](($Width - $dw) / 2)), ([int](($Height - $dh) / 2)), $dw, $dh)
  }
  $graphics.DrawImage($source, $dest)
  $parent = Split-Path -Parent $OutputPath
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
} finally {
  $graphics.Dispose(); $bitmap.Dispose(); $source.Dispose()
}
[ordered]@{ input=(Resolve-Path $InputPath).Path; output=(Resolve-Path $OutputPath).Path; width=$Width; height=$Height; fit=$Fit; bytes=(Get-Item $OutputPath).Length } | ConvertTo-Json
