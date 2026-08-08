# Generate Lanshan app icon (512x512 + 256x256 PNG)
# Mountain with lit/shadow faces (ridge line) and its own cast shadow.
# Peak slightly right (272,150), tall. Dark green gradient bg.
# NOTE: ASCII only (PS 5.1 reads .ps1 as ANSI, non-ASCII comments break parsing)
Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath([int]$w, [int]$h, [int]$radius) {
  $p = New-Object -TypeName System.Drawing.Drawing2D.GraphicsPath
  $d = $radius * 2
  [void]$p.AddArc(0, 0, $d, $d, 180, 90)
  [void]$p.AddArc($w - $d, 0, $d, $d, 270, 90)
  [void]$p.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
  [void]$p.AddArc(0, $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return ,$p
}

function New-Icon([int]$size) {
  $s = [float]($size / 512.0)
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  # Background: diagonal dark green gradient
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $bgPath = New-RoundedRectPath $size $size ([int](110 * $s))
  $bgC1 = [System.Drawing.Color]::FromArgb(255, 2, 44, 34)
  $bgC2 = [System.Drawing.Color]::FromArgb(255, 13, 95, 77)
  $bgBrush = New-Object -TypeName System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @($rect, $bgC1, $bgC2, [single]145.0)
  $g.FillPath($bgBrush, $bgPath)

  # Mountain: peak (272,150), left foot (104,452), right foot (416,452)
  # ridge from peak to (238,452): left = lit face, right = shadow face

  # 1) Cast shadow: same silhouette offset (24,22), dark translucent
  $csPts = @(
    (New-Object System.Drawing.PointF((296 * $s), (172 * $s))),
    (New-Object System.Drawing.PointF((128 * $s), (474 * $s))),
    (New-Object System.Drawing.PointF((440 * $s), (474 * $s)))
  )
  $csBrush = New-Object -TypeName System.Drawing.SolidBrush -ArgumentList @([System.Drawing.Color]::FromArgb(95, 1, 22, 16))
  $g.FillPolygon($csBrush, $csPts)

  # 2) Shadow face (right, cool grey-green gradient)
  $shPts = @(
    (New-Object System.Drawing.PointF((272 * $s), (150 * $s))),
    (New-Object System.Drawing.PointF((238 * $s), (452 * $s))),
    (New-Object System.Drawing.PointF((416 * $s), (452 * $s)))
  )
  $shRect = New-Object System.Drawing.RectangleF((238 * $s), (150 * $s), (178 * $s), (302 * $s))
  $shC1 = [System.Drawing.Color]::FromArgb(255, 148, 178, 168)
  $shC2 = [System.Drawing.Color]::FromArgb(255, 98, 130, 119)
  $shBrush = New-Object -TypeName System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @($shRect, $shC1, $shC2, [single]90.0)
  $g.FillPolygon($shBrush, $shPts)

  # 3) Lit face (left, snow-white gradient)
  $ltPts = @(
    (New-Object System.Drawing.PointF((272 * $s), (150 * $s))),
    (New-Object System.Drawing.PointF((104 * $s), (452 * $s))),
    (New-Object System.Drawing.PointF((238 * $s), (452 * $s)))
  )
  $ltRect = New-Object System.Drawing.RectangleF((104 * $s), (150 * $s), (168 * $s), (302 * $s))
  $ltC1 = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
  $ltC2 = [System.Drawing.Color]::FromArgb(255, 218, 238, 231)
  $ltBrush = New-Object -TypeName System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList @($ltRect, $ltC1, $ltC2, [single]90.0)
  $g.FillPolygon($ltBrush, $ltPts)

  $g.Dispose()
  return ,$bmp
}

$outDir = Join-Path $PSScriptRoot '..\resources'
$icon512 = New-Icon 512
$icon512.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon256 = New-Icon 256
$icon256.Save((Join-Path $outDir 'icon-256.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon512.Dispose()
$icon256.Dispose()
Write-Output 'OK: resources/icon.png + resources/icon-256.png'
