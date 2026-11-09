$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
Write-Host 'Create the restricted local database account for the SellerAudit server.'
Write-Host 'Choose a separate database password of at least 10 characters and remember it for starting the server.'
$administratorPassword = Read-Host 'PostgreSQL administrator password (not displayed)' -AsSecureString
$rolePassword = Read-Host 'New SellerAudit database password (not displayed)' -AsSecureString
$confirmation = Read-Host 'Confirm new database password' -AsSecureString
$adminPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($administratorPassword)
$rolePointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($rolePassword)
$confirmPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
try {
    $adminPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPointer)
    $rolePlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($rolePointer)
    $confirmPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmPointer)
    if ($rolePlain -cne $confirmPlain) { throw 'Passwords do not match.' }
    $encoded = [Uri]::EscapeDataString($adminPlain)
    $env:SELLERAUDIT_LOCAL_DATABASE_URL = "postgresql://postgres:${encoded}@127.0.0.1:5432/selleraudit_local"
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $OutputEncoding = [Console]::OutputEncoding
    @{password=$rolePlain} | ConvertTo-Json -Compress | node --experimental-strip-types server/provision-local-role.ts
    if ($LASTEXITCODE -ne 0) { throw 'Local database role setup failed.' }
} finally {
    $adminPlain=$null; $rolePlain=$null; $confirmPlain=$null; $encoded=$null
    Remove-Item Env:SELLERAUDIT_LOCAL_DATABASE_URL -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($rolePointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmPointer)
    $administratorPassword.Dispose(); $rolePassword.Dispose(); $confirmation.Dispose()
}
