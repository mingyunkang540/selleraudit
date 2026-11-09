$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$base='http://127.0.0.1:4179'
$source=Join-Path (Split-Path -Parent (Get-Location).Path) 'outputs\master-restoration\SellerAudit_Aqua_Confirmed_A24.xlsx'
$expectedHash='fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'
$session=$null; $csrf=$null; $pointer=[IntPtr]::Zero; $securePassword=$null; $dispatched=$false; $payload=$null
try {
    Write-Host 'SellerAudit 확인된 누락 데이터 등록'
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw '확인된 수정 파일을 찾지 못했습니다.' }
    $hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $source).Hash.ToLowerInvariant()
    if ($hash -ne $expectedHash) { throw '수정 파일이 확인한 내용과 다릅니다. 파일을 다시 확인해 주세요.' }
    $health=Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5
    if ($health.status -ne 'ok') { throw 'SellerAudit 서버를 먼저 실행해 주세요.' }
    $email=Read-Host '회사 이메일'
    $securePassword=Read-Host 'SellerAudit 로그인 비밀번호 (화면에 표시되지 않음)' -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $body=@{ email=$email; password=$password } | ConvertTo-Json -Compress
    $payload=[Text.Encoding]::UTF8.GetBytes($body); $password=$null; $body=$null
    $login=Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post -Headers @{Origin=$base} -ContentType 'application/json' -Body $payload -SessionVariable session -TimeoutSec 20
    [Array]::Clear($payload,0,$payload.Length);$payload=$null
    $csrf=$login.csrf
    if ($csrf -notmatch '^[0-9a-f]{64}$') { throw '로그인 응답을 확인하지 못했습니다.' }
    $identity=Invoke-RestMethod -Uri "$base/api/auth/session" -WebSession $session -TimeoutSec 10
    if ($identity.user.role -ne 'ADMIN' -or -not $identity.importEnabled) { throw '관리자 계정과 데이터 가져오기가 활성화된 서버가 필요합니다.' }
    $headers=@{Origin=$base;'X-CSRF-Token'=$csrf}
    $uploadHeaders=@{Origin=$base;'X-CSRF-Token'=$csrf;'X-Source-Filename'='SellerAudit_Aqua_Confirmed_A24.xlsx';'X-Source-Sha256'=$hash}
    $uploaded=Invoke-RestMethod -Uri "$base/api/import/sources" -Method Post -Headers $uploadHeaders -WebSession $session -ContentType 'application/octet-stream' -InFile $source -TimeoutSec 120
    if ($uploaded.serverSha256 -ne $hash -or $uploaded.id -notmatch '^[0-9a-fA-F-]{36}$') { throw '원본 저장 검증에 실패했습니다.' }
    $batch=Invoke-RestMethod -Uri "$base/api/import/sources/$($uploaded.id)/analyze" -Method Post -Headers $headers -WebSession $session -ContentType 'application/json' -Body '{}' -TimeoutSec 180
    if ($batch.id -notmatch '^[0-9a-fA-F-]{36}$') { throw '분석 기록을 확인하지 못했습니다.' }
    $plan=Invoke-RestMethod -Uri "$base/api/import/batches/$($batch.id)/expanded-plan" -WebSession $session -TimeoutSec 180
    if ($plan.fingerprint -notmatch '^[0-9a-f]{64}$') { throw '등록 계획을 확인하지 못했습니다.' }
    $reportDir=Join-Path (Split-Path -Parent (Get-Location).Path) 'outputs\local-registration'
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    $reportFile=Join-Path $reportDir ('expanded-registration-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.json')
    $report=@{batchId=$batch.id;sourceHash=$hash;plan=$plan;status='PLANNED';createdUtc=[DateTime]::UtcNow.ToString('o')}
    $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reportFile -Encoding UTF8
    Write-Host ('대상: 상품 행 {0}, 내부 세트 {1}, 모음전 옵션 {2}, 아쿠아 채널 구성 {3}. 제외 {4}행.' -f $plan.productCount,$plan.unlistedCount,$plan.optionCount,$plan.variantCount,@($plan.excluded).Count)
    Write-Host '기존과 일치하는 상품은 유지하고 충돌 또는 확인이 필요한 항목은 제외합니다.'
    $request=@{confirmed=$true;fingerprint=$plan.fingerprint}|ConvertTo-Json -Compress
    $dispatched=$true
    $result=Invoke-RestMethod -Uri "$base/api/import/batches/$($batch.id)/expanded-apply" -Method Post -Headers $headers -WebSession $session -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($request)) -TimeoutSec 180
    if ($result.status -notin @('APPLIED','PARTIALLY_APPLIED')) { throw '등록 응답 상태를 확인하지 못했습니다.' }
    $report.status='COMPLETED';$report.result=$result;$report.completedUtc=[DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reportFile -Encoding UTF8
    Write-Host ('등록 완료: 신규 상품 {0}, 신규 SKU {1}, 내부 세트 {2}, 모음전 옵션 {3}, 채널 구성 {4}, 제외 {5}행.' -f $result.productsCreated,$result.skusCreated,$result.unlistedCreated,$result.optionsCreated,$result.variantsCreated,@($result.excluded).Count)
    Write-Host "결과 파일: $reportFile"
} catch {
    if ($dispatched) { Write-Host '등록 응답을 확인하지 못했습니다. 기록의 상태를 확인하기 전에는 다시 실행하지 마세요.' }
    else { Write-Host '등록을 시작하지 못했습니다. 서버, 로그인, 파일 및 검증 상태를 확인해 주세요.' }
    Write-Host ('상세: ' + $_.Exception.Message)
} finally {
    if ($session -and $csrf) { try { Invoke-RestMethod -Uri "$base/api/auth/logout" -Method Post -Headers @{Origin=$base;'X-CSRF-Token'=$csrf} -WebSession $session -ContentType 'application/json' -Body '{}' -TimeoutSec 5 | Out-Null } catch {} }
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($securePassword) { $securePassword.Dispose() }
    if ($payload) { [Array]::Clear($payload,0,$payload.Length) }
    $password=$null;$body=$null;$csrf=$null;$session=$null
}
