$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$credential=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'SellerAudit\local-database.dpapi'
$secure=Get-Content -Raw -LiteralPath $credential | ConvertTo-SecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{
 $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 $encoded=[Uri]::EscapeDataString($password);$password=$null
 $env:SELLERAUDIT_LOCAL_DATABASE_URL="postgresql://selleraudit_app:${encoded}@127.0.0.1:5432/selleraudit_local";$encoded=$null
 node --experimental-strip-types scripts/Invoke-SmartstoreImport.mjs
 if($LASTEXITCODE -ne 0){throw '스마트스토어 등록에 실패했습니다. 등록 상태를 확인하기 전에는 재실행하지 마세요.'}
}finally{Remove-Item Env:SELLERAUDIT_LOCAL_DATABASE_URL -ErrorAction SilentlyContinue;[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secure.Dispose()}
