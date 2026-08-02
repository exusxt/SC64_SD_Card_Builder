Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'icon-assets\appstore.png'
if (-not (Test-Path -LiteralPath $src)) {
    Write-Error "Source icon not found: $src"
    exit 1
}

$source = [System.Drawing.Image]::FromFile($src)

$sizes = @(16, 24, 32, 48, 64, 128, 256)

$pngs = @{}
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($source, 0, 0, $size, $size)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs[$size] = $ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()
}

$outIco = Join-Path $root 'build\icon.ico'
New-Item -ItemType Directory -Path (Split-Path -Parent $outIco) -Force | Out-Null

$count = $pngs.Count
$headerLen = 6 + 16 * $count
$fs = [System.IO.File]::Create($outIco)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$count)

$offset = $headerLen
foreach ($size in $sizes) {
    $data = $pngs[$size]
    $dim = if ($size -ge 256) { 0 } else { $size }
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$data.Length)
    $bw.Write([UInt32]$offset)
    $offset += $data.Length
}

foreach ($size in $sizes) {
    $bw.Write($pngs[$size])
}
$bw.Dispose()
$fs.Dispose()

$outPng = Join-Path $root 'src\renderer\src\assets\app-icon.png'
New-Item -ItemType Directory -Path (Split-Path -Parent $outPng) -Force | Out-Null
$logo = New-Object System.Drawing.Bitmap(256, 256)
$g = [System.Drawing.Graphics]::FromImage($logo)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($source, 0, 0, 256, 256)
$g.Dispose()
$logo.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
$logo.Dispose()

$source.Dispose()

Write-Output "Wrote $outIco ($((Get-Item -LiteralPath $outIco).Length) bytes)"
Write-Output "Wrote $outPng"
