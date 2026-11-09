param([switch]$EnableImport)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
foreach ($port in @(4179,5174)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is already in use." }
}
$credentialDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit'
$credentialFile = Join-Path $credentialDir 'local-database.dpapi'
$rememberCredential = -not (Test-Path -LiteralPath $credentialFile -PathType Leaf)
if ($rememberCredential) {
    Write-Host 'Enter the database password once. Windows will protect it for this user account.'
    $securePassword = Read-Host 'SellerAudit database password (not displayed)' -AsSecureString
} else {
    try { $securePassword = Get-Content -LiteralPath $credentialFile -Raw | ConvertTo-SecureString }
    catch { throw 'Could not unlock the saved local database credential for this Windows account.' }
}
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$server = $null
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $encoded = [Uri]::EscapeDataString($password)
    $env:SELLERAUDIT_LOCAL_DATABASE_URL = "postgresql://selleraudit_app:${encoded}@127.0.0.1:5432/selleraudit_local"
    $password=$null; $encoded=$null
    $env:VITE_DATA_SOURCE='local-server'
    $env:SELLERAUDIT_LOCAL_OPEN_MODE=if ($env:SELLERAUDIT_REQUIRE_LOGIN -eq 'YES') { 'NO' } else { 'YES' }
    $env:SELLERAUDIT_LOCAL_PARENT_PID=[string]$PID
    . (Join-Path $PSScriptRoot 'Load-InitialPassword.ps1')
    $env:SELLERAUDIT_LOCAL_APPLY_ENABLED='NO'
    $env:SELLERAUDIT_LOCAL_DATA_DIR = Join-Path (Split-Path -Parent (Get-Location).Path) 'SellerAudit-data'
    if ($EnableImport) {
        $env:SELLERAUDIT_LOCAL_IMPORT_ENABLED='YES'
        $env:SELLERAUDIT_LOCAL_APPLY_ENABLED='YES'
    } else {
        $env:SELLERAUDIT_LOCAL_IMPORT_ENABLED='NO'
    }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $server = Start-Process -FilePath $node -ArgumentList @('--experimental-strip-types','server/index.ts') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru
    $healthy=$false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        if ($server.HasExited) { break }
        try {
            $health=Invoke-RestMethod -Uri 'http://127.0.0.1:4179/api/health' -TimeoutSec 1
            if ($health.status -eq 'ok') { $healthy=$true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $healthy) { throw 'Local backend did not become ready. Check the database password and role.' }
    if ($rememberCredential) {
        New-Item -ItemType Directory -Path $credentialDir -Force | Out-Null
        $protected = ConvertFrom-SecureString $securePassword
        [IO.File]::WriteAllText($credentialFile, $protected, [Text.UTF8Encoding]::new($false))
        $protected = $null
    }
    Write-Host 'Open http://127.0.0.1:5174/ in your browser. Keep this window open while using SellerAudit.'
    npm.cmd run dev -- --port 5174 --strictPort
} finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
    Remove-Item Env:SELLERAUDIT_LOCAL_DATABASE_URL,Env:SELLERAUDIT_LOCAL_DATA_DIR,Env:SELLERAUDIT_LOCAL_IMPORT_ENABLED,Env:SELLERAUDIT_LOCAL_APPLY_ENABLED,Env:SELLERAUDIT_LOCAL_PARENT_PID,Env:SELLERAUDIT_LOCAL_OPEN_MODE,Env:VITE_DATA_SOURCE,Env:SELLERAUDIT_INITIAL_PASSWORD_HASH -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $securePassword.Dispose()
}
