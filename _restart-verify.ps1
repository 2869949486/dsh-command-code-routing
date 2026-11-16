# Delayed DSH restart + post-restart probe, launched detached so the current turn
# can finish its answer before the host goes down.
$ErrorActionPreference = "Continue"
$log = "D:\DSH\DSH-PLUGIN\Command-Code-Routing\_restart.log"
function Say($text) { $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $text; Write-Host $line; Add-Content -Path $log -Value $line -Encoding utf8 }

Set-Content -Path $log -Value "restart wrapper started" -Encoding utf8
Start-Sleep -Seconds 20
Say "invoking restart-dsh.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File "D:\DSH\OpenMausBot\tmp\restart-dsh.ps1" 2>&1 | ForEach-Object { Say $_ }

# Give the loader a moment, then look for the new bundle in the host's own output.
Start-Sleep -Seconds 5
$hostProc = Get-CimInstance Win32_Process -Filter "Name = 'DSH NEXT.exe'" |
  Where-Object { $_.CommandLine -match "lib\\host\.js" } | Select-Object -First 1
if ($hostProc) { Say ("host pid {0}" -f $hostProc.ProcessId) } else { Say "host process NOT found" }

$portFile = "$env:DSH_HOME\last-gui-url.txt"
if (Test-Path $portFile) { Say ("gui url: " + (Get-Content $portFile -Raw).Trim()) }

foreach ($port in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -in @("127.0.0.1", "0.0.0.0") -and $_.LocalPort -gt 1024 } |
    Select-Object -ExpandProperty LocalPort -Unique)) {
  try {
    $probe = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ("http://127.0.0.1:{0}/command-code-usage.json" -f $port) -ErrorAction Stop
    Say ("port {0}: usage endpoint HTTP {1}" -f $port, $probe.StatusCode)
    Say ("body head: " + $probe.Content.Substring(0, [Math]::Min(160, $probe.Content.Length)))
    break
  } catch { }
}
Say "done"
