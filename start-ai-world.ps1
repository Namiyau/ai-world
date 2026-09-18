param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://127.0.0.1:5173"

Set-Location -LiteralPath $projectRoot

function Test-AiWorldServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500 -and $response.Content -match "ai-world|game-canvas|Economy World"
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "package.json"))) {
  throw "package.json was not found. Keep this launcher in the ai-world project root."
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $npmCommand) {
  throw "Node.js/npm was not found. Install Node.js 20.19+ or 22.12+ first."
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) {
  Write-Host "First launch: installing project dependencies..." -ForegroundColor Yellow
  & $npmCommand.Source install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed. The project cannot start."
  }
}

if (Test-AiWorldServer) {
  Write-Host "AI World is already running: $url" -ForegroundColor Green
} else {
  Write-Host "Starting the AI World development server..." -ForegroundColor Cyan
  $serverCommand = "title AI World Dev Server && npm.cmd run dev -- --host 127.0.0.1"
  Start-Process -FilePath "cmd.exe" -ArgumentList @("/k", $serverCommand) -WorkingDirectory $projectRoot | Out-Null

  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    if (Test-AiWorldServer) {
      $ready = $true
      break
    }
  }
  if (-not $ready) {
    throw "The development server did not respond within 30 seconds. Check the AI World Dev Server window."
  }
}

if (-not $NoBrowser) {
  Start-Process $url | Out-Null
}

Write-Host "AI World is ready: $url" -ForegroundColor Green
