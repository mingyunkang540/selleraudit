$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$inputJson=[Console]::In.ReadToEnd()
$payload=ConvertFrom-Json -InputObject $inputJson
if(-not $payload.password){throw 'Missing password.'}
$credential=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit\local-database.dpapi'
$destination=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit\initial-password-hash.dpapi'
$old=if(Test-Path -LiteralPath $destination){Get-Content -Raw -LiteralPath $destination}else{$null}
$dbSecure=Get-Content -Raw -LiteralPath $credential | ConvertTo-SecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($dbSecure)
try {
 $encoded=[Uri]::EscapeDataString([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
 $env:SELLERAUDIT_LOCAL_DATABASE_URL="postgresql://selleraudit_app:${encoded}@127.0.0.1:5432/selleraudit_local"
 [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$OutputEncoding=[Console]::OutputEncoding
 $hash=$inputJson | node --experimental-strip-types scripts/Hash-SharedInitial.mjs
 if($LASTEXITCODE -ne 0 -or -not $hash){throw 'Unable to prepare password.'}
 $protected=ConvertFrom-SecureString (ConvertTo-SecureString -String $hash -AsPlainText -Force)
 [IO.File]::WriteAllText($destination,$protected,[Text.UTF8Encoding]::new($false))
 try {
  $inputJson | node --experimental-strip-types scripts/Activate-TeamInitial.mjs
  if($LASTEXITCODE -ne 0){throw 'Employee activation failed.'}
 } catch {
  if($null -eq $old){Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue}else{[IO.File]::WriteAllText($destination,$old,[Text.UTF8Encoding]::new($false))}
  throw
 }
 Write-Host 'Shared initial password configured.'
} finally {
 Remove-Item Env:SELLERAUDIT_LOCAL_DATABASE_URL -ErrorAction SilentlyContinue
 $payload=$null;$inputJson=$null;$hash=$null;$protected=$null;$encoded=$null
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$dbSecure.Dispose()
}
