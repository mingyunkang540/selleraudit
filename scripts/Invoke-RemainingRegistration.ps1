$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$base='http://127.0.0.1:4179'
$batchId='27869cd2-b440-467c-9a26-bb51cb27c8ca'
$session=$null;$csrf=$null;$pointer=[IntPtr]::Zero;$securePassword=$null;$payload=$null;$dispatched=$false
try {
    Write-Host 'SellerAudit 확인된 나머지 상품 등록'
    $health=Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5
    if($health.status -ne 'ok'){throw 'SellerAudit 서버를 먼저 실행해 주세요.'}
    $email=Read-Host '회사 이메일'
    $securePassword=Read-Host 'SellerAudit 로그인 비밀번호 (화면에 표시되지 않음)' -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $body=@{email=$email;password=$password}|ConvertTo-Json -Compress
    $payload=[Text.Encoding]::UTF8.GetBytes($body);$password=$null;$body=$null
    $login=Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post -Headers @{Origin=$base} -ContentType 'application/json' -Body $payload -SessionVariable session -TimeoutSec 20
    [Array]::Clear($payload,0,$payload.Length);$payload=$null;$csrf=$login.csrf
    if($csrf -notmatch '^[0-9a-f]{64}$'){throw '로그인 응답을 확인하지 못했습니다.'}
    $identity=Invoke-RestMethod -Uri "$base/api/auth/session" -WebSession $session -TimeoutSec 10
    if($identity.user.role -ne 'ADMIN' -or -not $identity.importEnabled){throw '관리자 계정과 데이터 가져오기가 활성화된 서버가 필요합니다.'}
    $plan=Invoke-RestMethod -Uri "$base/api/import/batches/$batchId/remaining-plan" -WebSession $session -TimeoutSec 180
    if($plan.fingerprint -notmatch '^[0-9a-f]{64}$' -or @($plan.products).Count -eq 0){throw '등록할 상품 계획을 확인하지 못했습니다.'}
    $reportDir=Join-Path (Split-Path -Parent (Get-Location).Path) 'outputs\local-registration'
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    $reportFile=Join-Path $reportDir ('remaining-registration-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.json')
    $report=@{batchId=$batchId;plan=$plan;status='PLANNED';createdUtc=[DateTime]::UtcNow.ToString('o')}
    $report|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $reportFile -Encoding UTF8
    Write-Host ('등록 대상 {0}건, 충돌 등으로 제외 {1}건.' -f @($plan.products).Count,@($plan.excluded).Count)
    $request=@{confirmed=$true;fingerprint=$plan.fingerprint}|ConvertTo-Json -Compress
    $dispatched=$true
    $result=Invoke-RestMethod -Uri "$base/api/import/batches/$batchId/remaining-apply" -Method Post -Headers @{Origin=$base;'X-CSRF-Token'=$csrf} -WebSession $session -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($request)) -TimeoutSec 180
    if($result.status -notin @('APPLIED','PARTIALLY_APPLIED')){throw '등록 결과 상태를 확인하지 못했습니다.'}
    $report.status='COMPLETED';$report.result=$result;$report.completedUtc=[DateTime]::UtcNow.ToString('o');$report|ConvertTo-Json -Depth 20|Set-Content -LiteralPath $reportFile -Encoding UTF8
    Write-Host ('등록 완료: 상품 {0}건, SKU {1}건, 구성 {2}건, 제외 {3}건.' -f $result.productsCreated,$result.skusCreated,$result.componentsCreated,@($result.excluded).Count)
    Write-Host "결과 파일: $reportFile"
}catch{
    if($dispatched){Write-Host '등록 응답을 확인하지 못했습니다. 기록의 상태를 확인하기 전에는 다시 실행하지 마세요.'}
    else{Write-Host '등록을 시작하지 못했습니다. 서버, 로그인 및 검증 상태를 확인해 주세요.'}
    Write-Host ('상세: ' + $_.Exception.Message)
}finally{
    if($session -and $csrf){try{Invoke-RestMethod -Uri "$base/api/auth/logout" -Method Post -Headers @{Origin=$base;'X-CSRF-Token'=$csrf} -WebSession $session -ContentType 'application/json' -Body '{}' -TimeoutSec 5|Out-Null}catch{}}
    if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
    if($securePassword){$securePassword.Dispose()}
    if($payload){[Array]::Clear($payload,0,$payload.Length)}
    $password=$null;$body=$null;$csrf=$null;$session=$null
}
