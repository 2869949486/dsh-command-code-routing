# Delayed DSH restart + post-restart probe, launched detached so the current turn
# can finish its answer before the host goes down.
$ErrorActionPreference = "Continue"
$log = "D:\DSH\DSH-PLUGIN\Command-Code-Routing\_restart.log"
function Say($text) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $text
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding utf8
}

Set-Content -Path $log -Value "restart wrapper started" -Encoding utf8
Start-Sleep -Seconds 20
Say "invoking restart-dsh.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File "D:\DSH\OpenMausBot\tmp\restart-dsh.ps1" 2>&1 | ForEach-Object { Say $_ }

Start-Sleep -Seconds 8
$hostProc = Get-CimInstance Win32_Process -Filter "Name = 'DSH NEXT.exe'" |
  Where-Object { $_.CommandLine -match "lib\\host\.js" } | Select-Object -First 1
if ($hostProc) { Say ("host pid {0}" -f $hostProc.ProcessId) } else { Say "host process NOT found" }

foreach ($port in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -in @("127.0.0.1", "0.0.0.0") -and $_.LocalPort -gt 1024 } |
    Select-Object -ExpandProperty LocalPort -Unique)) {
  try {
    $probe = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri ("http://127.0.0.1:{0}/command-code-usage.json" -f $port) -ErrorAction Stop
    $data = $probe.Content | ConvertFrom-Json
    Say ("port {0}: usage HTTP {1} | plan {2} | usage {3} | models {4} | accounts {5}" -f $port, $probe.StatusCode, $data.plan, ($data.usage -ne $null), $data.models.Count, $data.accounts.Count)
    Say ("usageError: {0}" -f ($data.usageError ?? "(none)"))
    break
  } catch { }
}

$imageModules = Get-ChildItem "C:\Users\rabbit\.dsh\profiles\desktop\node_modules" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match "image-gen|image-bridge" } | Select-Object -ExpandProperty Name
Say ("image modules still installed: {0}" -f (($imageModules -join ", ") -replace "^$", "(none)"))
Say "done"
