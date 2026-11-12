$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Raiz 'backend'
Set-Location $Backend
if (-not (Test-Path '.venv\Scripts\python.exe')) {
  py -3 -m venv .venv
  if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel criar o ambiente virtual Python.' }
}
& '.\.venv\Scripts\python.exe' -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependencias.' }
if (-not (Test-Path '.env')) { Copy-Item '.env.exemplo' '.env' }
Write-Host "Instalacao concluida. Configure backend\.env e acrescente backend\credentials.json antes de validar." -ForegroundColor Green
