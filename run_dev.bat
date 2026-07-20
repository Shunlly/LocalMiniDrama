@echo off
setlocal
set "ROOT=%~dp0"
set "PORT_PID="
set "REUSE_BACKEND="
set "FRONTEND_PID="
set "REUSE_FRONTEND="

echo [0/2] Checking port 5679...
netstat -ano > "%TEMP%\lmd_netstat.txt" 2>&1
findstr ":5679 " "%TEMP%\lmd_netstat.txt" | findstr "LISTENING" > "%TEMP%\lmd_port.txt" 2>&1
for /f "usebackq tokens=5" %%a in ("%TEMP%\lmd_port.txt") do if not defined PORT_PID set "PORT_PID=%%a"
del "%TEMP%\lmd_netstat.txt" >nul 2>&1
del "%TEMP%\lmd_port.txt" >nul 2>&1

if not defined PORT_PID goto check_frontend
node "%ROOT%scripts\wait-local-dev.cjs" backend 2000 >nul 2>&1
if errorlevel 1 goto backend_conflict
set "REUSE_BACKEND=1"
goto check_frontend

:backend_conflict
echo ERROR: port 5679 is occupied by another process ^(PID %PORT_PID%^).
echo Refusing to terminate it. Stop that process manually or change the backend port.
exit /b 1

:check_frontend
echo [0/2] Checking port 3013...
netstat -ano > "%TEMP%\lmd_front_netstat.txt" 2>&1
findstr ":3013 " "%TEMP%\lmd_front_netstat.txt" | findstr "LISTENING" > "%TEMP%\lmd_front_port.txt" 2>&1
for /f "usebackq tokens=5" %%a in ("%TEMP%\lmd_front_port.txt") do if not defined FRONTEND_PID set "FRONTEND_PID=%%a"
del "%TEMP%\lmd_front_netstat.txt" >nul 2>&1
del "%TEMP%\lmd_front_port.txt" >nul 2>&1

if not defined FRONTEND_PID goto launch_services
node "%ROOT%scripts\wait-local-dev.cjs" frontend 2000 >nul 2>&1
if errorlevel 1 goto frontend_conflict
set "REUSE_FRONTEND=1"
goto launch_services

:frontend_conflict
echo ERROR: port 3013 is occupied by another process ^(PID %FRONTEND_PID%^).
echo Refusing to open an unverified page. Stop that process manually or change the frontend port.
exit /b 1

:launch_services
if defined REUSE_BACKEND goto reuse_backend
echo [1/2] Starting backend (backend-node)...
start "Backend" /D "%ROOT%backend-node" cmd /k "npm run dev"
node "%ROOT%scripts\wait-local-dev.cjs" backend 60000
if errorlevel 1 goto backend_start_failed
goto backend_ready

:backend_start_failed
echo ERROR: LocalMiniDrama backend did not become ready within 60 seconds.
echo Review the Backend window for the startup error.
exit /b 1

:reuse_backend
echo [1/2] Reusing existing LocalMiniDrama backend on port 5679.

:backend_ready
if defined REUSE_FRONTEND goto reuse_frontend
echo [2/2] Starting frontend (frontweb)...
start "Frontend" /D "%ROOT%frontweb" cmd /k "npm run dev"
node "%ROOT%scripts\wait-local-dev.cjs" frontend 60000
if errorlevel 1 goto frontend_start_failed
goto frontend_ready

:frontend_start_failed
echo ERROR: LocalMiniDrama frontend did not become ready within 60 seconds.
echo Review the Frontend window for the startup error.
exit /b 1

:reuse_frontend
echo [2/2] Reusing existing LocalMiniDrama frontend on port 3013.

:frontend_ready

echo Done. Backend: http://127.0.0.1:5679  Frontend: http://127.0.0.1:3013

start "" http://127.0.0.1:3013
endlocal
exit /b 0
