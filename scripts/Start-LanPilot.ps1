param([Parameter(Mandatory=$true)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')][string]$Address)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address -ErrorAction SilentlyContinue)) { throw 'The specified address is not assigned to this PC.' }
foreach($port in @(4179,5443)) { if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw "Port $port is already in use. Close the existing SellerAudit server first."} }
$certDir=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit\shared-tls'
$cert=Join-Path $certDir 'certificate.pem';$key=Join-Path $certDir 'private-key.pem'
if(-not (Test-Path -LiteralPath $cert -PathType Leaf) -or -not (Test-Path -LiteralPath $key -PathType Leaf)){throw 'The company HTTPS certificate and private key are not configured.'}
$openssl='C:\Program Files\Git\usr\bin\openssl.exe'
if(-not (Test-Path -LiteralPath $openssl -PathType Leaf)){throw 'OpenSSL is required to check the certificate.'}
$ipCheck=& $openssl x509 -in $cert -noout -checkip $Address
if($LASTEXITCODE -ne 0 -or $ipCheck -notmatch 'does match certificate'){throw 'The HTTPS certificate does not match the PC address.'}
& $openssl x509 -in $cert -noout -checkend 86400 | Out-Null
if($LASTEXITCODE -ne 0){throw 'The HTTPS certificate expires within a day.'}
$credential=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit\local-database.dpapi'
if(-not (Test-Path -LiteralPath $credential -PathType Leaf)){throw 'The saved local database credential is unavailable.'}
$env:VITE_DATA_SOURCE='local-server'
& npm.cmd run build
if($LASTEXITCODE -ne 0){throw 'Application build failed.'}
$secure=Get-Content -Raw -LiteralPath $credential | ConvertTo-SecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$backend=$null;$proxy=$null
try{
 $encoded=[Uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
 $env:SELLERAUDIT_LOCAL_DATABASE_URL="postgresql://selleraudit_app:${encoded}@127.0.0.1:5432/selleraudit_local"
 $env:SELLERAUDIT_LOCAL_DATA_DIR=Join-Path (Split-Path -Parent (Get-Location).Path) 'SellerAudit-data'
 $env:SELLERAUDIT_LOCAL_OPEN_MODE='NO';$env:SELLERAUDIT_LOCAL_IMPORT_ENABLED='YES';$env:SELLERAUDIT_LOCAL_APPLY_ENABLED='YES'
 $env:SELLERAUDIT_LOCAL_PARENT_PID=[string]$PID
 . (Join-Path $PSScriptRoot 'Load-InitialPassword.ps1')
 $env:SELLERAUDIT_LAN_ADDRESS=$Address;$env:SELLERAUDIT_LAN_PORT='5443';$env:SELLERAUDIT_LAN_CERT=$cert;$env:SELLERAUDIT_LAN_KEY=$key
 $node=(Get-Command node.exe -ErrorAction Stop).Source
 $backend=Start-Process -FilePath $node -ArgumentList @('--experimental-strip-types','server/index.ts') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru
 $ready=$false
 for($i=0;$i -lt 30;$i++){
  if($backend.HasExited){break}
  try { if((Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4179/api/auth/session' -TimeoutSec 1).StatusCode -eq 200){throw 'Login is not enabled.'} } catch {if($_.Exception.Response.StatusCode.value__ -eq 401){$ready=$true;break}}
  Start-Sleep -Milliseconds 500
 }
 if(-not $ready){throw 'Backend did not start with login enabled.'}
 $proxy=Start-Process -FilePath $node -ArgumentList @('server/lanProxy.mjs') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru
 Start-Sleep -Seconds 1
 if($proxy.HasExited){throw 'Secure shared server failed to start. Check the certificate and key.'}
 Write-Host "SellerAudit shared address: https://${Address}:5443/"
 Write-Host 'Keep this window open. Only computers trusting the company certificate can connect securely.'
 while(-not $backend.HasExited -and -not $proxy.HasExited){Start-Sleep -Seconds 2}
 throw 'A shared server process stopped.'
}finally{
 foreach($proc in @($proxy,$backend)){if($proc -and -not $proc.HasExited){Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue}}
 Remove-Item Env:SELLERAUDIT_LOCAL_DATABASE_URL,Env:SELLERAUDIT_LOCAL_DATA_DIR,Env:SELLERAUDIT_LOCAL_OPEN_MODE,Env:SELLERAUDIT_LOCAL_IMPORT_ENABLED,Env:SELLERAUDIT_LOCAL_APPLY_ENABLED,Env:SELLERAUDIT_LOCAL_PARENT_PID,Env:SELLERAUDIT_LAN_ADDRESS,Env:SELLERAUDIT_LAN_PORT,Env:SELLERAUDIT_LAN_CERT,Env:SELLERAUDIT_LAN_KEY,Env:VITE_DATA_SOURCE,Env:SELLERAUDIT_INITIAL_PASSWORD_HASH -ErrorAction SilentlyContinue
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secure.Dispose()
}
