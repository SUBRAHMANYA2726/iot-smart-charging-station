$ErrorActionPreference = 'Stop'
$dashboardDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:HOST = '127.0.0.1'
if ([string]::IsNullOrWhiteSpace($env:PORT)) { $env:PORT = '3000' }
$dashboardUrl = "http://127.0.0.1:$($env:PORT)/"
$server = Start-Process -FilePath 'node' -ArgumentList 'server.mjs' -WorkingDirectory $dashboardDirectory -PassThru -WindowStyle Hidden

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 50; $attempt++) {
    if ($server.HasExited) { throw 'The dashboard server stopped before it was ready.' }
    try {
      $response = Invoke-WebRequest -Uri $dashboardUrl -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $ready) { throw "The dashboard did not start at $dashboardUrl" }
  Start-Process $dashboardUrl
  Write-Host "ChargeSense is open at $dashboardUrl"
  Write-Host 'Live readings appear only after real ESP32 telemetry is configured.'
  Read-Host 'Press Enter to stop the local dashboard server' | Out-Null
}
finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
