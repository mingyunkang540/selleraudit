$ErrorActionPreference='Stop'
$launchers=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'Start-LanPilot\.ps1' -and $_.CommandLine -match '-Address 192\.168\.0\.2' })
if($launchers.Count -eq 0){Write-Host 'SellerAudit shared server is not running.';exit 0}
if($launchers.Count -ne 1){throw 'Could not identify a single shared server launcher.'}
$launcher=$launchers[0]
$children=@(Get-CimInstance Win32_Process | Where-Object {$_.ParentProcessId -eq $launcher.ProcessId -and $_.Name -eq 'node.exe' -and ($_.CommandLine -match '--experimental-strip-types server/index\.ts' -or $_.CommandLine -match 'server/lanProxy\.mjs')})
Stop-Process -Id $launcher.ProcessId
foreach($child in $children){Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue}
Write-Host 'SellerAudit shared server stopped.'
