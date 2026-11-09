$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$listeners=@(Get-NetTCPConnection -LocalPort 4179 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 1) { throw 'Unexpected backend listener.' }
$process=$null;$parent=$null
if($listeners.Count -eq 1){
  $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($listeners[0].OwningProcess)"
  if ($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch '--experimental-strip-types server/index\.ts') { throw 'Unexpected process on backend port.' }
  $parent=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)"
}
if (-not $parent) {
  $launchers=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -match 'Start-LocalPilot\.ps1.*-EnableImport' })
  if($launchers.Count -ne 1) { throw 'Cannot identify the local launcher.' }
  $parent=$launchers[0]
}
if ($parent.Name -ne 'powershell.exe' -or $parent.CommandLine -notmatch 'Start-LocalPilot\.ps1.*-EnableImport') { throw 'Unexpected launcher configuration.' }
$credential=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit\local-database.dpapi'
$secure=Get-Content -Raw -LiteralPath $credential | ConvertTo-SecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $encoded=[Uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
  $env:SELLERAUDIT_LOCAL_DATABASE_URL="postgresql://selleraudit_app:${encoded}@127.0.0.1:5432/selleraudit_local"
  $env:SELLERAUDIT_LOCAL_DATA_DIR=Join-Path (Split-Path -Parent (Get-Location).Path) 'SellerAudit-data'
  $env:SELLERAUDIT_LOCAL_IMPORT_ENABLED='YES'
  $env:SELLERAUDIT_LOCAL_APPLY_ENABLED='YES'
  $env:SELLERAUDIT_LOCAL_OPEN_MODE='YES'
  $env:SELLERAUDIT_LOCAL_PARENT_PID=[string]$parent.ProcessId
  . (Join-Path $PSScriptRoot 'Load-InitialPassword.ps1')
  if($process){Stop-Process -Id $process.ProcessId}
  $server=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('--experimental-strip-types','server/index.ts') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru
  for($i=0;$i -lt 30;$i++){
    if($server.HasExited){throw 'Backend failed to start.'}
    try { if((Invoke-RestMethod 'http://127.0.0.1:4179/api/health' -TimeoutSec 1).status -eq 'ok'){Write-Output 'Backend restarted.';exit 0} } catch {}
    Start-Sleep -Milliseconds 500
  }
  throw 'Backend did not become ready.'
} finally {
  Remove-Item Env:SELLERAUDIT_LOCAL_DATABASE_URL,Env:SELLERAUDIT_LOCAL_DATA_DIR,Env:SELLERAUDIT_LOCAL_IMPORT_ENABLED,Env:SELLERAUDIT_LOCAL_APPLY_ENABLED,Env:SELLERAUDIT_LOCAL_OPEN_MODE,Env:SELLERAUDIT_LOCAL_PARENT_PID,Env:SELLERAUDIT_INITIAL_PASSWORD_HASH -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $secure.Dispose()
}
