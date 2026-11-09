param([string]$BatchId = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$base = 'http://127.0.0.1:4179'
$headers = @{ Origin = $base }
$session = $null
$csrf = $null
$pointer = [IntPtr]::Zero
$securePassword = $null
$dispatched = $false
try {
    Write-Host 'SellerAudit 로컬 상품 등록'
    Write-Host '지정하거나 선택한 검증 기록에서 등록 가능한 상품이 자동으로 등록됩니다.'
    Write-Host '미등록 구성, 모음전, 채널별 상품, AL502/AL510 묶음 및 미확인 항목은 제외됩니다.'
    $health = Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5
    if ($health.status -ne 'ok') { throw 'SellerAudit server is not ready.' }
    $email = Read-Host '회사 이메일'
    $securePassword = Read-Host 'SellerAudit 로그인 비밀번호 (화면에 표시되지 않음)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $body = @{ email = $email; password = $password } | ConvertTo-Json -Compress
    $payload = [Text.Encoding]::UTF8.GetBytes($body)
    $password = $null; $body = $null
    $login = Invoke-RestMethod -Uri "$base/api/auth/login" -Method Post -Headers $headers -ContentType 'application/json' -Body $payload -SessionVariable session -TimeoutSec 20
    [Array]::Clear($payload, 0, $payload.Length)
    $csrf = $login.csrf
    if ($csrf -notmatch '^[0-9a-f]{64}$') { throw 'Login did not return a valid session.' }
    $identity = Invoke-RestMethod -Uri "$base/api/auth/session" -WebSession $session -TimeoutSec 10
    if ($identity.user.role -ne 'ADMIN' -or -not $identity.importEnabled) { throw 'An active administrator and import-enabled server are required.' }
    $batchResponse = Invoke-RestMethod -Uri "$base/api/import/batches" -WebSession $session -TimeoutSec 20
    $batches = @(@($batchResponse) | Where-Object { $_.status -eq 'REVIEW_REQUIRED' })
    if (-not $batches.Count) { throw 'No saved review-required validation records were found.' }
    if ($BatchId) {
        if ($BatchId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw 'Invalid requested batch ID.' }
        $matchingBatches = @($batches | Where-Object { $_.id -eq $BatchId })
        if ($matchingBatches.Count -ne 1) { throw 'Requested batch is unavailable or already applied.' }
        $batch = $matchingBatches[0]
        Write-Host ('지정된 기록: {0} | {1} | 상품 후보 {2}개' -f $batch.created_at,$batch.source_filename,$batch.product_candidate_count)
    } else {
        Write-Host ''
        Write-Host '등록할 검증 기록을 선택하세요. 번호를 입력하면 등록을 시작합니다.'
        for ($i = 0; $i -lt $batches.Count; $i++) {
            $item = $batches[$i]
            Write-Host ('[{0}] {1} | {2} | products {3} | parser {4} | {5}' -f ($i+1), $item.created_at, $item.source_filename, $item.product_candidate_count, $item.parser_version, $item.id)
        }
        $choice = Read-Host '기록 번호 (취소는 0)'
        $index = 0
        if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 0 -or $index -gt $batches.Count) { throw 'Invalid record selection.' }
        if ($index -eq 0) { Write-Host '취소했습니다. 등록된 상품은 없습니다.'; return }
        $batch = $batches[$index-1]
    }
    if ($batch.id -isnot [string] -or $batch.id -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw 'Invalid record ID.' }
    $plan = Invoke-RestMethod -Uri "$base/api/import/batches/$($batch.id)/initial-plan" -WebSession $session -TimeoutSec 90
    if ($plan.fingerprint -notmatch '^[0-9a-f]{64}$' -or @($plan.products).Count -lt 1) { throw 'The registration plan is empty or invalid.' }
    $reportDir = Join-Path (Split-Path -Parent (Get-Location).Path) 'outputs\local-registration'
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    $reportFile = Join-Path $reportDir ('registration-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.json')
    $report = @{ batchId=$batch.id; sourceFilename=$batch.source_filename; sourceHash=$batch.source_file_hash; plan=$plan; status='PLANNED'; createdUtc=[DateTime]::UtcNow.ToString('o') }
    $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reportFile -Encoding UTF8
    Write-Host ("등록 대상: 상품 {0}행, 필요한 SKU {1}개, 제외 {2}행." -f @($plan.products).Count, $plan.skuCount, @($plan.excluded).Count)
    Write-Host "계획 및 결과 파일: $reportFile"
    $request = @{ confirmed=$true; fingerprint=$plan.fingerprint } | ConvertTo-Json -Compress
    $writeHeaders = @{ Origin=$base; 'X-CSRF-Token'=$csrf }
    $dispatched = $true
    $result = Invoke-RestMethod -Uri "$base/api/import/batches/$($batch.id)/initial-apply" -Method Post -Headers $writeHeaders -WebSession $session -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($request)) -TimeoutSec 180
    if ($result.status -notin @('APPLIED','PARTIALLY_APPLIED')) { throw 'Unexpected response; check the batch state before retrying.' }
    $report.status = 'COMPLETED'; $report.result = $result; $report.completedUtc = [DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reportFile -Encoding UTF8
    Write-Host ("등록 완료: 신규 상품 {0}개, 신규 SKU {1}개, 신규 구성 {2}개, 제외 {3}행." -f $result.productsCreated, $result.skusCreated, $result.componentsCreated, @($result.excluded).Count)
} catch {
    if ($dispatched) { Write-Host '등록 응답을 확인하지 못했습니다. 저장된 기록의 상태를 확인하기 전에는 다시 실행하지 마세요.' }
    else { Write-Host '등록을 시작하지 못했습니다. 로그인, 선택한 기록, 현재 검증 상태를 확인해 주세요.' }
    Write-Host ('상세: ' + $_.Exception.Message)
} finally {
    if ($session -and $csrf) {
        try { Invoke-RestMethod -Uri "$base/api/auth/logout" -Method Post -Headers @{ Origin=$base; 'X-CSRF-Token'=$csrf } -WebSession $session -TimeoutSec 5 | Out-Null } catch { }
    }
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if ($securePassword) { $securePassword.Dispose() }
    if ($payload) { [Array]::Clear($payload, 0, $payload.Length) }
    $password = $null; $body = $null; $csrf = $null; $session = $null
}
