$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$base='http://127.0.0.1:4179';$batchId='27869cd2-b440-467c-9a26-bb51cb27c8ca'
$session=$null;$csrf=$null;$pointer=[IntPtr]::Zero;$secure=$null;$payload=$null;$dispatched=$false
try{
 $health=Invoke-RestMethod -Uri "$base/api/health" -TimeoutSec 5
 if($health.status -ne 'ok'){throw 'SellerAudit 서버를 먼저 실행해 주세요.'}
 $identity=Invoke-RestMethod -Uri "$base/api/auth/session" -SessionVariable session -TimeoutSec 10
 if(-not $identity.openMode){throw '로그인 없는 로컬 개발 서버가 필요합니다.'}
 $csrf=$identity.csrf
 if($csrf -notmatch '^[0-9a-f]{64}$'){throw '로그인 응답을 확인하지 못했습니다.'}
 if($identity.user.role -ne 'ADMIN' -or -not $identity.importEnabled){throw '관리자 계정과 데이터 가져오기가 활성화된 서버가 필요합니다.'}
 $plan=Invoke-RestMethod -Uri "$base/api/import/batches/$batchId/retire-d08-plan" -WebSession $session -TimeoutSec 180
 if($plan.fingerprint -notmatch '^[0-9a-f]{64}$' -or $plan.productCode -ne '100472' -or $plan.retiredSku -ne 'D08'){throw '변경 계획을 확인하지 못했습니다.'}
 $dir=Join-Path (Split-Path -Parent (Get-Location).Path) 'outputs\local-registration';New-Item -ItemType Directory -Path $dir -Force|Out-Null
 $file=Join-Path $dir ('retire-d08-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8) + '.json')
 $report=@{batchId=$batchId;plan=$plan;status='PLANNED';createdUtc=[DateTime]::UtcNow.ToString('o')};$report|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $file -Encoding UTF8
 Write-Host '완벽정리세트 26P 등록 및 견출지 상품과 D08 취급 중지를 진행합니다.'
 $request=@{confirmed=$true;fingerprint=$plan.fingerprint}|ConvertTo-Json -Compress;$dispatched=$true
 $result=Invoke-RestMethod -Uri "$base/api/import/batches/$batchId/retire-d08-apply" -Method Post -Headers @{Origin=$base;'X-CSRF-Token'=$csrf} -WebSession $session -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($request)) -TimeoutSec 180
 if($result.productCode -ne '100472' -or $result.retiredSku -ne 'D08' -or $result.productsCreated -ne 1){throw '변경 결과를 확인하지 못했습니다.'}
 $report.status='COMPLETED';$report.result=$result;$report.completedUtc=[DateTime]::UtcNow.ToString('o');$report|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $file -Encoding UTF8
 Write-Host '변경 완료: 완벽정리세트 26P 등록, 견출지 상품과 D08 취급 중지.'
 Write-Host "결과 파일: $file"
}catch{
 if($dispatched){Write-Host '변경 응답을 확인하지 못했습니다. 결과를 확인하기 전에는 다시 실행하지 마세요.'}else{Write-Host '변경을 시작하지 못했습니다. 서버와 현재 상품 상태를 확인해 주세요.'}
 Write-Host ('상세: '+$_.Exception.Message)
}finally{
 if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
 if($secure){$secure.Dispose()};if($payload){[Array]::Clear($payload,0,$payload.Length)};$password=$null;$body=$null
}
