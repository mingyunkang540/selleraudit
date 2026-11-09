$ErrorActionPreference = 'Stop'
$global:testPosts = 0
$global:testReports = @()
function Read-Host {
    param([string]$Prompt, [switch]$AsSecureString)
    if ($AsSecureString) { return ConvertTo-SecureString 'synthetic-password' -AsPlainText -Force }
    if ($Prompt -eq '회사 이메일') { return 'fixture@example.invalid' }
    if ($Prompt -eq '기록 번호 (취소는 0)') { return '1' }
    throw 'Unexpected prompt'
}
function New-Item { param($ItemType,$Path,[switch]$Force) return [pscustomobject]@{ FullName=$Path } }
function Set-Content {
    param([Parameter(ValueFromPipeline=$true)]$Value,$LiteralPath,$Encoding)
    process { $global:testReports += $Value }
}
function Invoke-RestMethod {
    param($Uri,$Method,$Headers,$ContentType,$Body,$SessionVariable,$WebSession,$TimeoutSec)
    switch -Wildcard ($Uri) {
        '*/api/health' { return @{status='ok'} }
        '*/api/auth/login' { Set-Variable -Name $SessionVariable -Value @{ test=$true } -Scope 1; return @{csrf=('a'*64)} }
        '*/api/auth/session' { return @{user=@{role='ADMIN'};importEnabled=$true} }
        '*/api/import/batches' { Write-Output -NoEnumerate @(@{id='33333333-3333-3333-3333-333333333333';status='REVIEW_REQUIRED';source_filename='other.xlsx';created_at='today';product_candidate_count=5;parser_version='test';source_file_hash=('d'*64)},@{id='11111111-1111-1111-1111-111111111111';status='REVIEW_REQUIRED';source_filename='fixture.xlsx';created_at='today';product_candidate_count=1;parser_version='test';source_file_hash=('b'*64)}) }
        '*/initial-plan' { if($Uri -notlike '*/11111111-1111-1111-1111-111111111111/initial-plan') { throw 'Wrong batch selected' }; return @{fingerprint=('c'*64);products=@(@{row=6;code='1001';name='fixture';components=@()});skuCount=1;excluded=@()} }
        '*/initial-apply' {
            $request=[Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
            if ($Method -ne 'Post' -or $request.confirmed -ne $true -or $request.fingerprint -ne ('c'*64) -or $Headers['X-CSRF-Token'] -ne ('a'*64)) { throw 'Invalid apply request' }
            $global:testPosts++
            return @{status='APPLIED';productsCreated=1;skusCreated=1;componentsCreated=1;excluded=@()}
        }
        '*/api/auth/logout' { return @{ok=$true} }
        default { throw 'Unexpected request' }
    }
}
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Invoke-LocalRegistration.ps1') -BatchId '11111111-1111-1111-1111-111111111111'
if ($global:testPosts -ne 1 -or $global:testReports.Count -ne 2) { throw 'Registration workflow did not complete as expected.' }
if (($global:testReports -join '') -match 'synthetic-password|fixture@example.invalid|aaaaaa') { throw 'Secret or session information leaked to report.' }
$global:testPosts=0
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Invoke-LocalRegistration.ps1') -BatchId '22222222-2222-2222-2222-222222222222'
if ($global:testPosts -ne 0) { throw 'Unknown batch was applied.' }
Write-Output 'Registration script synthetic workflow PASS.'
