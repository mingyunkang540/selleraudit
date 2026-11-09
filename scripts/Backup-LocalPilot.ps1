$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$bin = 'C:\Program Files\PostgreSQL\17\bin'
$dump = Join-Path $bin 'pg_dump.exe'
$restore = Join-Path $bin 'pg_restore.exe'
$createdb = Join-Path $bin 'createdb.exe'
$dropdb = Join-Path $bin 'dropdb.exe'
$psql = Join-Path $bin 'psql.exe'
foreach ($exe in @($dump, $restore, $createdb, $dropdb, $psql)) {
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Missing PostgreSQL tool: $exe" }
}
if (Get-NetTCPConnection -State Listen -LocalPort 4179 -ErrorAction SilentlyContinue) {
    throw 'Stop the SellerAudit local server before backing up.'
}
if ($env:SELLERAUDIT_LOCAL_DATA_DIR -or ((Test-Path -LiteralPath '.env.local-server') -and (Select-String -LiteralPath '.env.local-server' -Pattern '^\s*SELLERAUDIT_LOCAL_DATA_DIR\s*=' -Quiet))) {
    throw 'Custom source storage is configured; this backup supports only the default local pilot storage.'
}
$storageRoot = Join-Path (Split-Path -Parent (Get-Location).Path) 'SellerAudit-data'
$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop -or -not (Test-Path -LiteralPath $desktop -PathType Container)) { throw 'Desktop folder not found.' }
$backupRoot = Join-Path $desktop 'selleraudit backup'
$backupDir = Join-Path $backupRoot ('SellerAudit-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$testDb = 'seller_audit_rehearsal_' + [guid]::NewGuid().ToString('N')
$created = $false
$securePassword = Read-Host 'PostgreSQL administrator password (not displayed)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    New-Item -ItemType Directory -Path $backupRoot -Force -ErrorAction Stop | Out-Null
    New-Item -ItemType Directory -Path $backupDir -ErrorAction Stop | Out-Null
    $dumpFile = Join-Path $backupDir 'database.dump'
    & $dump --host=127.0.0.1 --port=5432 --username=postgres --no-password --format=custom --file=$dumpFile selleraudit_local
    if ($LASTEXITCODE -ne 0) { throw 'Database backup failed.' }
    & $restore --list $dumpFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Database dump validation failed.' }
    & $createdb --host=127.0.0.1 --port=5432 --username=postgres --no-password $testDb
    if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated restore test database.' }
    $created = $true
    & $restore --host=127.0.0.1 --port=5432 --username=postgres --no-password --dbname=$testDb --no-owner --exit-on-error $dumpFile
    if ($LASTEXITCODE -ne 0) { throw 'Database restore test failed.' }
    $migrationQuery = "SELECT coalesce(json_agg(json_build_array(name, sha256) ORDER BY name), '[]'::json)::text FROM seller_audit_local.schema_migrations"
    $originalMigrations = & $psql --host=127.0.0.1 --port=5432 --username=postgres --no-password --dbname=selleraudit_local --tuples-only --no-align --command=$migrationQuery
    if ($LASTEXITCODE -ne 0 -or -not $originalMigrations -or $originalMigrations -eq '[]') { throw 'Original migration verification failed.' }
    $restoredMigrations = & $psql --host=127.0.0.1 --port=5432 --username=postgres --no-password --dbname=$testDb --tuples-only --no-align --command=$migrationQuery
    if ($LASTEXITCODE -ne 0 -or $restoredMigrations -ne $originalMigrations) { throw 'Restored migration verification failed.' }
    $migrationList = ConvertFrom-Json -InputObject $restoredMigrations
    $count = $migrationList.Count
    $sourceJson = & $psql --host=127.0.0.1 --port=5432 --username=postgres --no-password --dbname=$testDb --tuples-only --no-align --command="SELECT coalesce(json_agg(json_build_object('path', storage_object_path, 'hash', server_verified_sha256, 'bytes', server_verified_byte_size)), '[]'::json) FROM seller_audit_local.import_source_files WHERE verification_status='VERIFIED'"
    if ($LASTEXITCODE -ne 0) { throw 'Could not check restored source metadata.' }
    $verifiedSources = ConvertFrom-Json -InputObject $sourceJson
    $backupStorage = Join-Path $backupDir 'storage'
    New-Item -ItemType Directory -Path $backupStorage | Out-Null
    $storageFiles = @()
    if (Test-Path -LiteralPath $storageRoot) {
        $rootItem = Get-Item -LiteralPath $storageRoot -Force
        if (-not $rootItem.PSIsContainer -or ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid source storage root.' }
        $items = @(Get-ChildItem -LiteralPath $storageRoot -Force -Recurse)
        if (@($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -gt 0) { throw 'Source storage contains a link or reparse point.' }
        foreach ($item in $items) {
            $relativePath = $item.FullName.Substring($storageRoot.Length).TrimStart('\')
            $destination = Join-Path $backupStorage $relativePath
            if ($item.PSIsContainer) { New-Item -ItemType Directory -Path $destination -Force | Out-Null; continue }
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            Copy-Item -LiteralPath $item.FullName -Destination $destination
            $originalHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLowerInvariant()
            $copiedHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
            if ($originalHash -ne $copiedHash) { throw 'Source copy verification failed.' }
            $storageFiles += @{ path=$relativePath.Replace('\','/'); sha256=$copiedHash; bytes=$item.Length }
        }
    }
    foreach ($source in $verifiedSources) {
        if ($source.path -notmatch '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/source\.xlsx$') { throw 'Invalid source path in database.' }
        $matched=@($storageFiles | Where-Object { $_.path -eq $source.path -and $_.sha256 -eq $source.hash -and $_.bytes -eq $source.bytes })
        if ($matched.Count -ne 1) { throw 'Verified database source does not match a backed-up file.' }
    }
    $rehearsal = Join-Path $backupDir '_storage-restore-check'
    Copy-Item -LiteralPath $backupStorage -Destination $rehearsal -Recurse
    foreach ($file in $storageFiles) {
        $restoredFile = Join-Path $rehearsal ($file.path.Replace('/','\'))
        if (-not (Test-Path -LiteralPath $restoredFile -PathType Leaf) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $restoredFile).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'Source restore verification failed.' }
    }
    Remove-Item -LiteralPath $rehearsal -Recurse -Force
    $manifest = @{ created_utc = [DateTime]::UtcNow.ToString('o'); database = 'selleraudit_local'; dump_sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $dumpFile).Hash.ToLowerInvariant(); storage_files = $storageFiles; restore_test = 'PASS'; restored_migrations = [int]$count; same_pc_backup = $true }
    $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupDir 'manifest.json') -Encoding UTF8
    Write-Host "Backup created and empty test database restored successfully: $backupDir"
    Write-Host 'Database and default local source storage were verified in the restore rehearsal.'
} finally {
    if ($created) {
        & $dropdb --host=127.0.0.1 --port=5432 --username=postgres --no-password --if-exists $testDb
        if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove isolated test database $testDb" }
    }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $securePassword.Dispose()
}
