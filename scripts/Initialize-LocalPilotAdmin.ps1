$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
Write-Host 'This one-time setup uses the PostgreSQL administrator only to create the first local application administrator.'
$securePassword = Read-Host 'PostgreSQL administrator password (not displayed)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $localPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $encodedPassword = [Uri]::EscapeDataString($localPassword)
    $env:SELLERAUDIT_LOCAL_DATABASE_URL = "postgresql://postgres:${encodedPassword}@127.0.0.1:5432/selleraudit_local"
    $localPassword = $null; $encodedPassword = $null
    & (Join-Path $PSScriptRoot 'Bootstrap-LocalAdmin.ps1')
} finally {
    Remove-Item Env:SELLERAUDIT_LOCAL_DATABASE_URL -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $securePassword.Dispose()
}
