# 启动开发环境：后端 + 前端
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "启动后端服务 (backend-node)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend-node'; npm run dev" -WindowStyle Normal

Write-Host "启动前端服务 (frontweb)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontweb'; npm run dev" -WindowStyle Normal

Write-Host "开发服务器已启动！" -ForegroundColor Green
Write-Host "  后端: http://127.0.0.1:5679" -ForegroundColor Yellow
Write-Host "  前端: http://127.0.0.1:3013" -ForegroundColor Yellow

Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:3013"
