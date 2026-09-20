param([int]$Port = 8080)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$python = $null
if (Get-Command py -ErrorAction SilentlyContinue) { $python = 'py' }
elseif (Get-Command python -ErrorAction SilentlyContinue) { $python = 'python' }
else { Write-Host 'Python 3 est nécessaire pour le test local.' -ForegroundColor Red; Read-Host 'Entrée pour fermer'; exit 1 }

$url = "http://localhost:$Port/?test=1"
Write-Host "Le Sceau des Quatre Passages - TEST LOCAL" -ForegroundColor Cyan
Write-Host "Ouverture de $url"
Start-Job -ScriptBlock { param($u) Start-Sleep -Milliseconds 800; Start-Process $u } -ArgumentList $url | Out-Null
& $python -m http.server $Port --bind 127.0.0.1
