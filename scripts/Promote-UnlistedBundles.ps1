$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$credential=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit\local-database.dpapi'
$secure=Get-Content -Raw -LiteralPath $credential | ConvertTo-SecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:SELLERAUDIT_TASK_DB_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  node scripts/Promote-UnlistedBundles.mjs
  if($LASTEXITCODE -ne 0){throw 'Promotion failed.'}
} finally {
  Remove-Item Env:SELLERAUDIT_TASK_DB_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $secure.Dispose()
}
