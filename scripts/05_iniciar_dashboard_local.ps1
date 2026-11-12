$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
$server = Join-Path $root 'backend\dashboard_server.py'
$extractor = Join-Path $root 'backend\extrair_google_ads.py'
if (!(Test-Path $py)) { throw 'Ambiente virtual nao encontrado. Instale as dependencias primeiro com scripts\01_instalar.ps1.' }
if (!(Test-Path $extractor)) { throw 'Extrator autenticado nao encontrado. Preserve seu backend\extrair_google_ads.py original.' }
if (!(Test-Path $server)) { throw 'Servidor dinamico nao encontrado; confira a extracao do ZIP V6.1.' }
Write-Host ''
Write-Host 'GOOGLE ADS INTELLIGENCE V6.1 - API DINAMICA RECONCILIADA' -ForegroundColor Cyan
Write-Host 'Abra no Chrome: http://127.0.0.1:8765/' -ForegroundColor Green
Write-Host 'Nao precisa mais executar o sincronizador de snapshots.' -ForegroundColor Green
Write-Host 'Feche a janela ou CTRL+C para parar.' -ForegroundColor Yellow
Write-Host ''
& $py $server
if ($LASTEXITCODE -ne 0) { throw "Servidor terminou com erro ($LASTEXITCODE)" }
