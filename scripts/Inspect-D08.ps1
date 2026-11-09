$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$base='http://127.0.0.1:4179';$session=$null;$csrf=$null;$secure=$null;$pointer=[IntPtr]::Zero;$payload=$null
try {
 $email=Read-Host '회사 이메일'
 $secure=Read-Host 'SellerAudit 로그인 비밀번호 (화면에 표시되지 않음)' -AsSecureString
 $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
 $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 $body=@{email=$email;password=$password}|ConvertTo-Json -Compress;$payload=[Text.Encoding]::UTF8.GetBytes($body);$password=$null;$body=$null
 $login=Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post -Headers @{Origin=$base} -ContentType 'application/json' -Body $payload -SessionVariable session -TimeoutSec 20
 [Array]::Clear($payload,0,$payload.Length);$payload=$null;$csrf=$login.csrf
 $data=Invoke-RestMethod -Uri "$base/api/data" -WebSession $session -TimeoutSec 30
 $matches=@($data.skus|Where-Object {$_.skuCode -eq 'D08'})
 $sku=@($matches|Select-Object id,skuCode,modelName,color,status)
 $skuIds=@($matches|ForEach-Object {$_.id})
 $linkedProductIds=@($data.components|Where-Object {$_.skuId -in $skuIds}|ForEach-Object {$_.productId}|Select-Object -Unique)
 $linkedProducts=@($data.products|Where-Object {$_.id -in $linkedProductIds}|Select-Object id,sabangnetCode,productName,status)
 $targetProducts=@($data.products|Where-Object {$_.sabangnetCode -in @('100472','100089')}|Select-Object id,sabangnetCode,productName,status)
 $root=Split-Path -Parent $PSScriptRoot;$dir=Join-Path (Split-Path -Parent $root) 'outputs\local-registration'
 New-Item -ItemType Directory -Path $dir -Force | Out-Null
 $file=Join-Path $dir ('sku-d08-review-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
 @{sku=$sku;linkedProducts=$linkedProducts;targetProducts=$targetProducts;checkedUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $file -Encoding UTF8
 Write-Host "SKU 확인 완료. 결과 파일: $file"
}catch{Write-Host ('SKU 확인 실패: '+$_.Exception.Message)}finally{
 if($session -and $csrf){try{Invoke-RestMethod -Uri "$base/api/auth/logout" -Method Post -Headers @{Origin=$base;'X-CSRF-Token'=$csrf} -WebSession $session -ContentType 'application/json' -Body '{}' -TimeoutSec 5|Out-Null}catch{}}
 if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
 if($secure){$secure.Dispose()};if($payload){[Array]::Clear($payload,0,$payload.Length)};$password=$null;$body=$null
}
