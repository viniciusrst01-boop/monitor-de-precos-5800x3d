$ErrorActionPreference = "Stop"

$projectRoot = Split-Path $PSScriptRoot -Parent
$localLauncher = Join-Path $projectRoot "run-mercadolivre-collector.local.ps1"
$logFile = Join-Path $projectRoot "pichau-collector.log"

if (-not (Test-Path -LiteralPath $localLauncher)) {
  throw "Configuracao local do coletor nao encontrada."
}

$launcherContent = Get-Content -LiteralPath $localLauncher -Raw
$tokenMatch = [regex]::Match($launcherContent, 'MONITOR_INGEST_TOKEN\s*=\s*["'']([^"'']+)["'']')
if (-not $tokenMatch.Success) {
  throw "Token local do coletor nao encontrado."
}

$env:MONITOR_INGEST_TOKEN = $tokenMatch.Groups[1].Value
$env:PICHAU_ASSISTED = "0"

Push-Location $projectRoot
try {
  & npm.cmd run collect:pichau *>> $logFile
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
