param([switch]$MigrateOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
Write-Host 'SellerAudit local foundation verification'
Write-Host 'Enter the PostgreSQL administrator password. It will not be displayed or saved.'
$securePassword = Read-Host 'PostgreSQL password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $localPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $encodedPassword = [Uri]::EscapeDataString($localPassword)
    $env:SELLERAUDIT_LOCAL_DATABASE_URL = "postgresql://postgres:${encodedPassword}@127.0.0.1:5432/selleraudit_local"
    $localPassword = $null
    $encodedPassword = $null
    npm.cmd run local:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed. Verify the local password and database.' }
    npm.cmd run local:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Migration repeat failed.' }
    if ($MigrateOnly) {
        Write-Host 'Migration checks passed.'
        $markerFile = Join-Path (Split-Path -Parent (Get-Location).Path) 'outputs\selleraudit-local-migration-check.json'
        $migrations = @(Get-ChildItem -LiteralPath 'server\migrations' -Filter '*.sql' | Sort-Object Name | ForEach-Object {
            @{ name = $_.Name; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
        })
        @{ migrations = $migrations; result = 'PASS' } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $markerFile -Encoding UTF8
        exit 0
    }
    Write-Host 'Migration checks passed. Local server will now start; leave this window open.'
    npm.cmd run local:server
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    Remove-Item Env:SELLERAUDIT_LOCAL_DATABASE_URL -ErrorAction SilentlyContinue
    $securePassword.Dispose()
}
