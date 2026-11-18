# Vẽ hình đại diện của app Xếp giờ HIS bằng công cụ vẽ có sẵn của Windows, không cần cài thêm gì.
#   powershell -File ve-icon.ps1 -Sheet xem-thu.png          vẽ tờ xem thử gồm các mẫu ở nhiều cỡ
#   powershell -File ve-icon.ps1 -Ico XepGioHIS.ico -Mau B   ghi file .ico của mẫu đã chọn
param([string]$Sheet = '', [string]$Ico = '', [string]$Mau = 'B')
Add-Type -AssemblyName System.Drawing
$D2 = [System.Drawing.Drawing2D.LinearGradientBrush]

function C([string]$hex, [int]$a = 255) { $c = [System.Drawing.ColorTranslator]::FromHtml($hex); return [System.Drawing.Color]::FromArgb($a, $c.R, $c.G, $c.B) }
function RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [single](2 * $r)
  $p.AddArc($x, $y, $d, $d, [single]180, [single]90)
  $p.AddArc([single]($x + $w - $d), $y, $d, $d, [single]270, [single]90)
  $p.AddArc([single]($x + $w - $d), [single]($y + $h - $d), $d, $d, [single]0, [single]90)
  $p.AddArc($x, [single]($y + $h - $d), $d, $d, [single]90, [single]90)
  $p.CloseFigure()
  return ,$p
}
function Grad([string]$a, [string]$b) {
  return New-Object $D2 ((New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF 256, 256), (C $a), (C $b))
}
function Disc($g, [single]$cx, [single]$cy, [single]$r, $color) {
  $b = New-Object System.Drawing.SolidBrush $color
  $g.FillEllipse($b, [single]($cx - $r), [single]($cy - $r), [single](2 * $r), [single](2 * $r)); $b.Dispose()
}
function Hand($g, [single]$cx, [single]$cy, [double]$deg, [single]$len, [single]$w, $color, [single]$back = 0) {
  $rad = $deg * [Math]::PI / 180; $dx = [Math]::Sin($rad); $dy = -[Math]::Cos($rad)
  $pen = New-Object System.Drawing.Pen $color, $w
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawLine($pen, [single]($cx - $dx * $back), [single]($cy - $dy * $back), [single]($cx + $dx * $len), [single]($cy + $dy * $len)); $pen.Dispose()
}
function Arc($g, [single]$r, [single]$w, [single]$start, [single]$sweep, $color, [bool]$round = $true) {
  $pen = New-Object System.Drawing.Pen $color, $w
  if ($round) { $pen.StartCap = 'Round'; $pen.EndCap = 'Round' }
  $g.DrawArc($pen, [single](128 - $r), [single](128 - $r), [single](2 * $r), [single](2 * $r), $start, $sweep); $pen.Dispose()
}
function Bar($g, [single]$x, [single]$y, [single]$w, [single]$h, [single]$r, $color) {
  $p = RoundRect $x $y $w $h $r; $b = New-Object System.Drawing.SolidBrush $color; $g.FillPath($b, $p); $b.Dispose(); $p.Dispose()
}

# Mọi mẫu vẽ trên khung 256 x 256 rồi co theo cỡ cần lấy; cỡ nhỏ thì bỏ chi tiết và làm nét đậm hơn cho dễ nhìn
function Draw([string]$mau, [int]$n) {
  $bmp = New-Object System.Drawing.Bitmap $n, $n, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.ScaleTransform([single]($n / 256.0), [single]($n / 256.0))
  $nho = $n -le 24; $vua = $n -le 48
  $bgPath = RoundRect 6 6 244 244 58

  if ($mau -eq 'A') {          # nền xanh ngọc, mặt đồng hồ trắng, dấu chữ thập y tế ở góc
    $b = Grad '#2dd4bf' '#0f766e'; $g.FillPath($b, $bgPath); $b.Dispose()
    $r = 88; if ($nho) { $r = 98 }
    Disc $g 128 134 $r (C '#003b36' 60)
    Disc $g 128 128 $r (C '#ffffff')
    if (-not $vua) {
      0..11 | ForEach-Object { $big = ($_ % 3) -eq 0; $rad = $_ * 30 * [Math]::PI / 180; $dx = [Math]::Sin($rad); $dy = -[Math]::Cos($rad)
        $r1 = 76; $r0 = 66; $w = 4; if ($big) { $r0 = 60; $w = 7 }
        $pen = New-Object System.Drawing.Pen (C '#0f766e'), ([single]$w); $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
        $g.DrawLine($pen, [single](128 + $dx * $r0), [single](128 + $dy * $r0), [single](128 + $dx * $r1), [single](128 + $dy * $r1)); $pen.Dispose() }
    }
    $hw = 13; $mw = 10; if ($nho) { $hw = 22; $mw = 20 } elseif ($vua) { $hw = 16; $mw = 13 }
    Hand $g 128 128 300 44 $hw (C '#0f172a')
    Hand $g 128 128 60 62 $mw (C '#0f172a')
    if (-not $nho) { Disc $g 128 128 11 (C '#f59e0b') }
    if (-not $nho) {
      Disc $g 196 196 54 (C '#ffffff')
      Disc $g 196 196 45 (C '#10b981')
      Bar $g 166 186 60 20 6 (C '#ffffff'); Bar $g 186 166 20 60 6 (C '#ffffff')
    }
  }
  elseif ($mau -eq 'B') {      # nền tối, vòng tròn chia thành các ca nhiều màu nối nhau không chồng lên nhau, kim trắng
    $b = Grad '#27364f' '#0b1220'; $g.FillPath($b, $bgPath); $b.Dispose()
    $r = 82; $w = 26; if ($nho) { $r = 84; $w = 34 }
    $cols = '#34d399', '#fbbf24', '#38bdf8', '#fb7185'
    0..3 | ForEach-Object { if ($nho) { Arc $g $r $w ([single](-90 + 6 + $_ * 90)) 78 (C $cols[$_]) $false } else { Arc $g $r $w ([single](-90 + 15 + $_ * 90)) 60 (C $cols[$_]) $true } }
    $hw = 13; $mw = 10; if ($nho) { $hw = 24; $mw = 22 } elseif ($vua) { $hw = 16; $mw = 13 }
    Hand $g 128 128 300 34 $hw (C '#ffffff')
    Hand $g 128 128 60 50 $mw (C '#ffffff')
    if (-not $nho) { Disc $g 128 128 10 (C '#fbbf24') }
  }
  else {                       # nền xanh lá, chữ thập y tế trắng, đồng hồ nằm giữa chữ thập
    $b = Grad '#34d399' '#047857'; $g.FillPath($b, $bgPath); $b.Dispose()
    Bar $g 86 40 84 188 22 (C '#003b2a' 55); Bar $g 34 92 188 84 22 (C '#003b2a' 55)
    Bar $g 86 34 84 188 22 (C '#ffffff'); Bar $g 34 86 188 84 22 (C '#ffffff')
    $r = 52; if ($nho) { $r = 56 }
    Disc $g 128 128 $r (C '#065f46')
    $hw = 10; $mw = 8; if ($nho) { $hw = 20; $mw = 18 } elseif ($vua) { $hw = 13; $mw = 11 }
    Hand $g 128 128 300 24 $hw (C '#ffffff')
    Hand $g 128 128 60 35 $mw (C '#ffffff')
    if (-not $vua) { Disc $g 128 128 7 (C '#fbbf24') }
  }
  $bgPath.Dispose(); $g.Dispose()
  return ,$bmp
}

if ($Sheet) {
  $maus = 'A', 'B', 'C'; $W = 820; $rowH = 296
  $to = New-Object System.Drawing.Bitmap $W, ($rowH * 3), ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($to); $g.SmoothingMode = 'AntiAlias'
  $g.Clear((C '#f1f5f9'))
  $dark = New-Object System.Drawing.SolidBrush (C '#111827'); $g.FillRectangle($dark, 610, 0, 210, $rowH * 3); $dark.Dispose()
  $font = New-Object System.Drawing.Font 'Segoe UI', 30, ([System.Drawing.FontStyle]::Bold); $ink = New-Object System.Drawing.SolidBrush (C '#0f172a')
  for ($i = 0; $i -lt 3; $i++) {
    $y = $i * $rowH + 20
    $g.DrawString($maus[$i], $font, $ink, 14, ($y + 100))
    $x = 70
    foreach ($n in 256, 96, 48, 32, 16) { $b = Draw $maus[$i] $n; $g.DrawImageUnscaled($b, $x, ($y + [int]((256 - $n) / 2))); $b.Dispose(); $x += $n + 18 }
    $x = 640
    foreach ($n in 64, 32, 16) { $b = Draw $maus[$i] $n; $g.DrawImageUnscaled($b, $x, ($y + [int]((256 - $n) / 2))); $b.Dispose(); $x += $n + 16 }
  }
  $g.Dispose(); $to.Save($Sheet, [System.Drawing.Imaging.ImageFormat]::Png); $to.Dispose()
  Write-Output "Da ve to xem thu: $Sheet"
}

if ($Ico) {
  # File .ico: cỡ 256 lưu dạng PNG, các cỡ nhỏ lưu dạng điểm ảnh thô 32 bit để trình biên dịch nào cũng đọc được
  $sizes = 16, 20, 24, 32, 40, 48, 64, 256; $blobs = @()
  foreach ($n in $sizes) {
    $bmp = Draw $Mau $n; $ms = New-Object System.IO.MemoryStream
    if ($n -eq 256) { $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png) }
    else {
      $bw = New-Object System.IO.BinaryWriter $ms
      $bw.Write([int]40); $bw.Write([int]$n); $bw.Write([int](2 * $n)); $bw.Write([int16]1); $bw.Write([int16]32); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0); $bw.Write([int]0)
      $rect = New-Object System.Drawing.Rectangle 0, 0, $n, $n
      $bd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $raw = New-Object byte[] ($bd.Stride * $n); [System.Runtime.InteropServices.Marshal]::Copy($bd.Scan0, $raw, 0, $raw.Length); $bmp.UnlockBits($bd)
      for ($y = $n - 1; $y -ge 0; $y--) { $bw.Write($raw, $y * $bd.Stride, $n * 4) }
      $maskRow = [int]([Math]::Ceiling($n / 32.0) * 4); $bw.Write((New-Object byte[] ($maskRow * $n))); $bw.Flush()
    }
    $blobs += ,$ms.ToArray(); $ms.Dispose(); $bmp.Dispose()
  }
  $fs = [System.IO.File]::Create($Ico); $w = New-Object System.IO.BinaryWriter $fs
  $w.Write([int16]0); $w.Write([int16]1); $w.Write([int16]$sizes.Count)
  $off = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $n = $sizes[$i]; $dim = $n; if ($n -eq 256) { $dim = 0 }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0); $w.Write([int16]1); $w.Write([int16]32); $w.Write([int]$blobs[$i].Length); $w.Write([int]$off); $off += $blobs[$i].Length
  }
  foreach ($b in $blobs) { $w.Write($b) }
  $w.Flush(); $fs.Close()
  Write-Output "Da ghi $Ico (mau $Mau)"
}
