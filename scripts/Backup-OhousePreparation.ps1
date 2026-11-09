$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$bin='C:\Program Files\PostgreSQL\17\bin'
$desktop=[Environment]::GetFolderPath('Desktop');$backupRoot=Join-Path $desktop 'selleraudit backup'
$backupDir=Join-Path $backupRoot ('SellerAudit-pre-channel-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$storageRoot=Join-Path (Split-Path -Parent (Get-Location).Path) 'SellerAudit-data'
$credential=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit\local-database.dpapi'
$secure=Get-Content -Raw -LiteralPath $credential | ConvertTo-SecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{
 $env:PGPASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 New-Item -ItemType Directory -Path $backupDir -Force|Out-Null
 $dumpFile=Join-Path $backupDir 'database.dump'
 & (Join-Path $bin 'pg_dump.exe') --host=127.0.0.1 --port=5432 --username=selleraudit_app --no-password --format=custom --schema=seller_audit_local --no-owner --file=$dumpFile selleraudit_local
 if($LASTEXITCODE -ne 0){throw 'Database backup failed.'}
 & (Join-Path $bin 'pg_restore.exe') --list $dumpFile | Out-Null
 if($LASTEXITCODE -ne 0){throw 'Database dump validation failed.'}
 $sourceJson=& (Join-Path $bin 'psql.exe') --host=127.0.0.1 --port=5432 --username=selleraudit_app --no-password --dbname=selleraudit_local --tuples-only --no-align --command="SELECT coalesce(json_agg(json_build_object('path',storage_object_path,'hash',server_verified_sha256,'bytes',server_verified_byte_size)),'[]'::json) FROM seller_audit_local.import_source_files WHERE verification_status='VERIFIED'"
 if($LASTEXITCODE -ne 0){throw 'Source metadata unavailable.'}
 $verified=ConvertFrom-Json -InputObject $sourceJson
 $backupStorage=Join-Path $backupDir 'storage';New-Item -ItemType Directory -Path $backupStorage|Out-Null;$files=@()
 if(Test-Path -LiteralPath $storageRoot){
  $root=Get-Item -LiteralPath $storageRoot -Force
  if(-not $root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Invalid storage root.'}
  $items=@(Get-ChildItem -LiteralPath $storageRoot -Force -Recurse)
  if(@($items|Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'Source storage has a link.'}
  foreach($item in $items){$relative=$item.FullName.Substring($storageRoot.Length).TrimStart('\');$dest=Join-Path $backupStorage $relative;if($item.PSIsContainer){New-Item -ItemType Directory -Path $dest -Force|Out-Null;continue};New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force|Out-Null;Copy-Item -LiteralPath $item.FullName -Destination $dest;$a=(Get-FileHash -Algorithm SHA256 -LiteralPath $item.FullName).Hash.ToLowerInvariant();$b=(Get-FileHash -Algorithm SHA256 -LiteralPath $dest).Hash.ToLowerInvariant();if($a -ne $b){throw 'Source copy mismatch.'};$files+=@{path=$relative.Replace('\','/');sha256=$b;bytes=$item.Length}}
 }
 foreach($item in $verified){if($item.path -notmatch '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/source\.xlsx$'){throw 'Invalid source path.'};$found=@($files|Where-Object {$_.path -eq $item.path -and $_.sha256 -eq $item.hash -and $_.bytes -eq $item.bytes});if($found.Count -ne 1){throw 'Verified source missing from backup.'}}
 $manifest=@{created_utc=[DateTime]::UtcNow.ToString('o');database='selleraudit_local';scope='seller_audit_local';dump_sha256=(Get-FileHash -Algorithm SHA256 -LiteralPath $dumpFile).Hash.ToLowerInvariant();storage_files=$files;dump_validation='PASS';restore_test='NOT_RUN';same_pc_backup=$true}
 $manifest|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $backupDir 'manifest.json') -Encoding UTF8
 Write-Host "백업 생성 및 원본 해시 확인 완료: $backupDir"
}finally{Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue;[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secure.Dispose()}
