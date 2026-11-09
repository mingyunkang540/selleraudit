$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
 Write-Host 'Creating a backup before replacing own-store records...'
 & (Join-Path $PSScriptRoot 'Backup-OhousePreparation.ps1')
 if (-not $?) { throw 'Backup failed.' }
 Write-Host 'The previous own-store listings, issues and mappings will be replaced.'
 Write-Host 'The product master and other channels will remain unchanged.'
 $secure=Read-Host 'PostgreSQL administrator password (not displayed)' -AsSecureString
 $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
 try {
  $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $json=@{password=$password}|ConvertTo-Json -Compress
  [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
  $OutputEncoding=[Console]::OutputEncoding
  $json | node scripts/Replace-OwnedStore.mjs
  if($LASTEXITCODE -ne 0){throw 'Replacement failed. Database changes were rolled back. Do not retry before checking the error.'}
 } finally {
  $password=$null;$json=$null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secure.Dispose()
 }
} catch {Write-Host $_.Exception.Message;exit 1}
