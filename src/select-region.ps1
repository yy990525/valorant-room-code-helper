param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("region", "point")]
  [string]$Mode,

  [string]$Title = "Select target"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen

$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Bounds = $bounds
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::Black
$form.Opacity = 0.28
$form.Cursor = if ($Mode -eq "region") {
  [System.Windows.Forms.Cursors]::Cross
} else {
  [System.Windows.Forms.Cursors]::Hand
}
$form.KeyPreview = $true
$form.DoubleBuffered = $true

$state = @{
  Down = $false
  Start = [System.Drawing.Point]::Empty
  Current = [System.Drawing.Point]::Empty
  Rect = [System.Drawing.Rectangle]::Empty
  Result = $null
}

function Convert-ToScreenPoint([System.Drawing.Point]$point) {
  return [System.Drawing.Point]::new($point.X + $bounds.X, $point.Y + $bounds.Y)
}

$form.Add_KeyDown({
  if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $form.Tag = "cancel"
    $form.Close()
  }
})

$form.Add_MouseDown({
  if ($_.Button -ne [System.Windows.Forms.MouseButtons]::Left) {
    return
  }

  if ($Mode -eq "point") {
    $screenPoint = Convert-ToScreenPoint $_.Location
    $state.Result = @{
      x = $screenPoint.X
      y = $screenPoint.Y
    }
    $form.Close()
    return
  }

  $state.Down = $true
  $state.Start = $_.Location
  $state.Current = $_.Location
  $form.Invalidate()
})

$form.Add_MouseMove({
  if (-not $state.Down) {
    return
  }

  $state.Current = $_.Location
  $left = [Math]::Min($state.Start.X, $state.Current.X)
  $top = [Math]::Min($state.Start.Y, $state.Current.Y)
  $width = [Math]::Abs($state.Start.X - $state.Current.X)
  $height = [Math]::Abs($state.Start.Y - $state.Current.Y)
  $state.Rect = [System.Drawing.Rectangle]::new($left, $top, $width, $height)
  $form.Invalidate()
})

$form.Add_MouseUp({
  if ($Mode -ne "region" -or -not $state.Down) {
    return
  }

  $state.Down = $false
  if ($state.Rect.Width -lt 8 -or $state.Rect.Height -lt 8) {
    $state.Rect = [System.Drawing.Rectangle]::Empty
    $form.Invalidate()
    return
  }

  $screenPoint = Convert-ToScreenPoint $state.Rect.Location
  $state.Result = @{
    x = $screenPoint.X
    y = $screenPoint.Y
    width = $state.Rect.Width
    height = $state.Rect.Height
  }
  $form.Close()
})

$form.Add_Paint({
  param($sender, $eventArgs)

  $graphics = $eventArgs.Graphics
  $message = if ($Mode -eq "region") {
    "$Title`nDrag around the room code area. Press Esc to cancel."
  } else {
    "$Title`nClick the target point. Press Esc to cancel."
  }

  $font = New-Object System.Drawing.Font("Microsoft YaHei UI", 16, [System.Drawing.FontStyle]::Bold)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 0, 0, 0))
  $graphics.DrawString($message, $font, $shadow, 29, 29)
  $graphics.DrawString($message, $font, $brush, 28, 28)

  if ($Mode -eq "region" -and -not $state.Rect.IsEmpty) {
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 30, 220, 190), 3)
    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(55, 30, 220, 190))
    $graphics.FillRectangle($fill, $state.Rect)
    $graphics.DrawRectangle($pen, $state.Rect)
    $pen.Dispose()
    $fill.Dispose()
  }

  $font.Dispose()
  $brush.Dispose()
  $shadow.Dispose()
})

[void]$form.ShowDialog()

if ($form.Tag -eq "cancel" -or $null -eq $state.Result) {
  Write-Error "Selection cancelled."
  exit 2
}

$state.Result | ConvertTo-Json -Compress
