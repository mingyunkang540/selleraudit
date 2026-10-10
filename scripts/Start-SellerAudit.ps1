param(
    [switch]$NoBrowser,
    [ValidateRange(1024, 65535)]
    [int]$Port = 5174
)

$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$baseUrl = "http://127.0.0.1:$Port/"
$startedServer = $null

function Test-SellerAudit {
    try {
        $response = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content.Contains('<title>SellerAudit')
    } catch {
        return $false
    }
}

try {
    if (-not (Test-SellerAudit)) {
        $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
        $vitePath = Join-Path $projectPath 'node_modules\vite\bin\vite.js'
        if (-not (Test-Path -LiteralPath $vitePath)) {
            throw "Dependencies are missing. Run npm ci in: $projectPath"
        }
        $logPath = Join-Path $env:LOCALAPPDATA 'SellerAudit\logs'
        New-Item -ItemType Directory -Path $logPath -Force | Out-Null
        $startedServer = Start-Process -FilePath $nodePath `
            -ArgumentList @(('"' + $vitePath + '"'), '--host', '127.0.0.1', '--port', "$Port", '--strictPort') `
            -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logPath "server-$Port.log") `
            -RedirectStandardError (Join-Path $logPath "server-$Port.error.log")

        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if (Test-SellerAudit) { $ready = $true; break }
            if ($startedServer.HasExited) { break }
            Start-Sleep -Milliseconds 300
        }
        if (-not $ready) {
            throw "SellerAudit could not start on port $Port. See logs in: $logPath"
        }
    }

    $appUrl = $baseUrl + '#/dashboard'
    if (-not $NoBrowser) { Start-Process $appUrl }
    [pscustomobject]@{
        Url = $appUrl
        StartedProcessId = $(if ($startedServer) { $startedServer.Id } else { $null })
    }
} catch {
    if ($NoBrowser) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'SellerAudit') | Out-Null
    exit 1
}
