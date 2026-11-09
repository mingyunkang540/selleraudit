$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
Write-Host 'First local SellerAudit administrator setup'
if (-not $env:SELLERAUDIT_LOCAL_DATABASE_URL -and -not (Test-Path -LiteralPath '.env.local-server')) {
    throw 'Local server database configuration is required before bootstrapping.'
}
$email = Read-Host 'Company email'
$displayName = Read-Host 'Display name'
Write-Host 'Use at least 10 characters. The password is not displayed or written to disk.'
$securePassword = Read-Host 'Password' -AsSecureString
$confirmation = Read-Host 'Confirm password' -AsSecureString
$firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$secondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
try {
    $first = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPointer)
    $second = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPointer)
    if ($first -cne $second) { throw 'The passwords do not match.' }
    $json = @{ email=$email; displayName=$displayName; password=$first } | ConvertTo-Json -Compress
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [Console]::OutputEncoding
    $json | node --experimental-strip-types server/bootstrap.ts
    if ($LASTEXITCODE -ne 0) { throw 'Administrator setup failed.' }
} finally {
    $first=$null; $second=$null; $json=$null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPointer)
    $securePassword.Dispose(); $confirmation.Dispose()
}
