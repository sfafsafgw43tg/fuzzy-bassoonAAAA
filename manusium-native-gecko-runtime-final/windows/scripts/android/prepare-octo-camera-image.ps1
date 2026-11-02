[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [int]$Width = 1280,
  [int]$Height = 720,
  [ValidateSet('stretch','fit','crop')][string]$Fit = 'fit',
  [ValidateSet('none','grayscale','sepia','bright','contrast')][string]$Filter = 'none',
  [int]$SourceX = 0,
  [int]$SourceY = 0,
  [int]$SourceWidth = 0,
  [int]$SourceHeight = 0
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
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  if ($Filter -ne 'none') {
    $matrix = New-Object 'System.Single[,]' 5,5
    $matrix[0,0]=1; $matrix[1,1]=1; $matrix[2,2]=1; $matrix[3,3]=1; $matrix[4,4]=1
    if ($Filter -eq 'grayscale') { $matrix[0,0]=0.299; $matrix[0,1]=0.587; $matrix[0,2]=0.114; $matrix[1,0]=0.299; $matrix[1,1]=0.587; $matrix[1,2]=0.114; $matrix[2,0]=0.299; $matrix[2,1]=0.587; $matrix[2,2]=0.114 }
    if ($Filter -eq 'sepia') { $matrix[0,0]=0.393; $matrix[0,1]=0.769; $matrix[0,2]=0.189; $matrix[1,0]=0.349; $matrix[1,1]=0.686; $matrix[1,2]=0.168; $matrix[2,0]=0.272; $matrix[2,1]=0.534; $matrix[2,2]=0.131 }
    if ($Filter -eq 'bright') { $matrix[4,0]=0.12; $matrix[4,1]=0.12; $matrix[4,2]=0.12 }
    if ($Filter -eq 'contrast') { $matrix[0,0]=1.25; $matrix[1,1]=1.25; $matrix[2,2]=1.25; $matrix[4,0]=-0.125; $matrix[4,1]=-0.125; $matrix[4,2]=-0.125 }
    if (-not ('OctoCameraColorMatrix' -as [type])) {
      Add-Type -ReferencedAssemblies ([System.Drawing.Image].Assembly.Location) @'
using System.Drawing.Imaging;
public static class OctoCameraColorMatrix {
  public static ColorMatrix Create(float[,] values) {
    var rows = new float[5][];
    for (int r = 0; r < 5; r++) { rows[r] = new float[5]; for (int c = 0; c < 5; c++) rows[r][c] = values[r,c]; }
    return new ColorMatrix(rows);
  }
}
'@
    }
    $attributes.SetColorMatrix([OctoCameraColorMatrix]::Create($matrix))
  }
  $sourceRect = New-Object System.Drawing.Rectangle(0, 0, $source.Width, $source.Height)
  if ($Fit -eq 'crop' -and $SourceWidth -gt 0 -and $SourceHeight -gt 0) {
    $sx = [Math]::Max(0, [Math]::Min($SourceX, $source.Width - 1))
    $sy = [Math]::Max(0, [Math]::Min($SourceY, $source.Height - 1))
    $swInt = [Math]::Max(1, [Math]::Min($SourceWidth, $source.Width - $sx))
    $shInt = [Math]::Max(1, [Math]::Min($SourceHeight, $source.Height - $sy))
    $sourceRect = New-Object System.Drawing.Rectangle($sx, $sy, $swInt, $shInt)
  }
  $sw = [double]$sourceRect.Width; $sh = [double]$sourceRect.Height
  if ($Fit -eq 'stretch') {
    $dest = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
  } else {
    $scale = if ($Fit -eq 'crop') { [Math]::Max($Width / $sw, $Height / $sh) } else { [Math]::Min($Width / $sw, $Height / $sh) }
    $dw = [int][Math]::Round($sw * $scale); $dh = [int][Math]::Round($sh * $scale)
    $dest = New-Object System.Drawing.Rectangle(([int](($Width - $dw) / 2)), ([int](($Height - $dh) / 2)), $dw, $dh)
  }
  $graphics.DrawImage($source, $dest, $sourceRect.X, $sourceRect.Y, $sourceRect.Width, $sourceRect.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
  $parent = Split-Path -Parent $OutputPath
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
} finally {
  $attributes.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $source.Dispose()
}
[ordered]@{ input=(Resolve-Path $InputPath).Path; output=(Resolve-Path $OutputPath).Path; width=$Width; height=$Height; fit=$Fit; bytes=(Get-Item $OutputPath).Length } | ConvertTo-Json
