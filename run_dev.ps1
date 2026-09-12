# 启动开发环境：后端 + 前端
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction Stop).Source
$listener = Get-NetTCPConnection -LocalPort 5679 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
$reuseBackend = $false
$reuseFrontend = $false

if ($listener) {
  $null = & $node "$root\scripts\wait-local-dev.cjs" backend 2000 2>$null
  $reuseBackend = $LASTEXITCODE -eq 0
  if (-not $reuseBackend) {
    Write-Error "port 5679 is occupied by another process; refusing to terminate it. Stop it manually or change the backend port."
    exit 1
  }
}

$frontendListener = Get-NetTCPConnection -LocalPort 3013 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($frontendListener) {
  $null = & $node "$root\scripts\wait-local-dev.cjs" frontend 2000 2>$null
  $reuseFrontend = $LASTEXITCODE -eq 0
  if (-not $reuseFrontend) {
    Write-Error "port 3013 is occupied by another process; refusing to open an unverified page. Stop it manually or change the frontend port."
    exit 1
  }
}

if ($reuseBackend) {
  Write-Host "Reusing existing LocalMiniDrama backend on port 5679." -ForegroundColor Yellow
} else {
  Write-Host "启动后端服务 (backend-node)..." -ForegroundColor Cyan
  Start-Process powershell -WorkingDirectory "$root\backend-node" -ArgumentList "-NoExit", "-Command", "npm run dev" -WindowStyle Normal
  & $node "$root\scripts\wait-local-dev.cjs" backend 60000
  if ($LASTEXITCODE -ne 0) {
    Write-Error "LocalMiniDrama backend did not become ready within 60 seconds. Review the backend window for the startup error."
    exit 1
  }
}

if ($reuseFrontend) {
  Write-Host "Reusing existing LocalMiniDrama frontend on port 3013." -ForegroundColor Yellow
} else {
  Write-Host "启动前端服务 (frontweb)..." -ForegroundColor Cyan
  Start-Process powershell -WorkingDirectory "$root\frontweb" -ArgumentList "-NoExit", "-Command", "npm run dev" -WindowStyle Normal
  & $node "$root\scripts\wait-local-dev.cjs" frontend 60000
  if ($LASTEXITCODE -ne 0) {
    Write-Error "LocalMiniDrama frontend did not become ready within 60 seconds. Review the frontend window for the startup error."
    exit 1
  }
}

Write-Host "开发服务器已启动！" -ForegroundColor Green
Write-Host "  后端: http://127.0.0.1:5679" -ForegroundColor Yellow
Write-Host "  前端: http://127.0.0.1:3013" -ForegroundColor Yellow

Start-Process "http://127.0.0.1:3013"
