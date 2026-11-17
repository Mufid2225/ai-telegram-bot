param(
  [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'fg')]
  [string]$Command = 'start'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$TmpDir = Join-Path $ProjectRoot 'tmp'
$StateFile = Join-Path $TmpDir 'nerissa-state.json'
$StdoutLog = Join-Path $TmpDir 'nerissa.log'
$StderrLog = Join-Path $TmpDir 'nerissa-error.log'

function Get-ConfiguredPort {
  $EnvFile = Join-Path $ProjectRoot '.env.local'
  if (Test-Path -LiteralPath $EnvFile) {
    foreach ($Line in (Get-Content -LiteralPath $EnvFile)) {
      if ($Line -match '^\s*PORT\s*=\s*(\d+)\s*$') {
        return [int]$Matches[1]
      }
    }
  }
  return 3000
}

$Port = Get-ConfiguredPort

function Get-RunningBotProcesses {
  $Found = [Collections.Generic.List[object]]::new()
  if (Test-Path -LiteralPath $StateFile) {
    try {
      $Meta = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
      if ($Meta.Pid) {
        $Proc = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Meta.Pid)" -ErrorAction SilentlyContinue
        if ($Proc -and $Proc.Name -match '^node') {
          $Found.Add($Proc)
        }
      }
    } catch {}
  }

  $EscapedRoot = [Regex]::Escape($ProjectRoot)
  $AllNode = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
  foreach ($Proc in @($AllNode)) {
    $Cmd = [string]$Proc.CommandLine
    if ($Cmd -match 'src[/\\]index\.js' -and ($Cmd -match $EscapedRoot -or $Proc.ExecutablePath)) {
      if (-not ($Found | Where-Object { $_.ProcessId -eq $Proc.ProcessId })) {
        $Found.Add($Proc)
      }
    }
  }
  return $Found
}

function Test-BotHealth([int]$CheckPort) {
  try {
    $Resp = Invoke-WebRequest -Uri "http://127.0.0.1:$CheckPort" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    return ($Resp.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Show-BotRunning([int]$BotPid, [int]$BotPort, [bool]$Healthy) {
  $HealthLabel = if ($Healthy) { 'OK (200)' } else { 'STARTING' }
  Write-Host "Nerissa Bot sedang berjalan (PID $BotPid)" -ForegroundColor Green
  Write-Host "  Health URL : http://localhost:$BotPort ($HealthLabel)"
  Write-Host "  Folder     : $ProjectRoot"
  Write-Host "  Log        : $StdoutLog"
  Write-Host "  Cek status : nerissa status"
  Write-Host "  Lihat log  : nerissa logs"
  Write-Host "  Restart    : nerissa restart"
  Write-Host "  Hentikan   : nerissa stop"
}

function Stop-BotInternal {
  $Procs = Get-RunningBotProcesses
  if (-not $Procs -or $Procs.Count -eq 0) {
    Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue
    return $false
  }
  foreach ($P in $Procs) {
    Stop-Process -Id $P.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue
  return $true
}

function Start-BotInternal {
  $Existing = Get-RunningBotProcesses
  if ($Existing -and $Existing.Count -gt 0) {
    $Healthy = Test-BotHealth $Port
    Show-BotRunning $Existing[0].ProcessId $Port $Healthy
    return
  }

  $Node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $Node) {
    throw 'Node.js tidak ditemukan di PATH.'
  }

  New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
  if (Test-Path -LiteralPath $StdoutLog) { Remove-Item -LiteralPath $StdoutLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $StderrLog) { Remove-Item -LiteralPath $StderrLog -Force -ErrorAction SilentlyContinue }

  $Proc = Start-Process -FilePath $Node.Source `
    -ArgumentList @('src/index.js') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog

  $Ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    if ($Proc.HasExited) { break }
    if (Test-BotHealth $Port) {
      $Ready = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }

  if ($Proc.HasExited) {
    $ErrText = if (Test-Path -LiteralPath $StderrLog) { (Get-Content -LiteralPath $StderrLog -Tail 12) -join "`n" } else { 'Tidak ada output error.' }
    throw "Nerissa Bot gagal berjalan:`n$ErrText"
  }

  $StateJson = @{ Pid = $Proc.Id; Port = $Port; StartedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($StateFile, $StateJson, (New-Object Text.UTF8Encoding($false)))
  Show-BotRunning $Proc.Id $Port $Ready
}

switch ($Command) {
  'start' {
    Start-BotInternal
  }
  'stop' {
    if (Stop-BotInternal) {
      Write-Host "Nerissa Bot berhasil dihentikan." -ForegroundColor Yellow
    } else {
      Write-Host "Nerissa Bot sedang tidak berjalan." -ForegroundColor DarkGray
    }
  }
  'restart' {
    [void](Stop-BotInternal)
    Start-Sleep -Milliseconds 400
    Start-BotInternal
  }
  'status' {
    $Existing = Get-RunningBotProcesses
    if ($Existing -and $Existing.Count -gt 0) {
      $Healthy = Test-BotHealth $Port
      Show-BotRunning $Existing[0].ProcessId $Port $Healthy
    } else {
      Write-Host "Nerissa Bot sedang tidak berjalan." -ForegroundColor Yellow
      Write-Host "  Jalankan   : nerissa"
    }
  }
  'logs' {
    if (Test-Path -LiteralPath $StdoutLog) {
      Write-Host "=== Output Log ($StdoutLog) ===" -ForegroundColor Cyan
      Get-Content -LiteralPath $StdoutLog -Tail 25
    } else {
      Write-Host "Belum ada file log di $StdoutLog"
    }
    if ((Test-Path -LiteralPath $StderrLog) -and (Get-Item -LiteralPath $StderrLog).Length -gt 0) {
      Write-Host "`n=== Error Log ($StderrLog) ===" -ForegroundColor Red
      Get-Content -LiteralPath $StderrLog -Tail 20
    }
  }
  'fg' {
    Push-Location $ProjectRoot
    try {
      & node src/index.js
    } finally {
      Pop-Location
    }
  }
}
