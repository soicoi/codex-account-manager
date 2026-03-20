@echo off
setlocal
cd /d "%~dp0"
for %%I in ("%~dp0.") do set "BASE_DIR=%%~fI"

set "ELECTRON_EXE=%BASE_DIR%\node_modules\electron\dist\electron.exe"
set "ELECTRON_CMD=%BASE_DIR%\node_modules\.bin\electron.cmd"
set "APP_ENTRY=%BASE_DIR%\manager\electron-main.js"

if exist "%ELECTRON_EXE%" (
  start "" "%ELECTRON_EXE%" "%APP_ENTRY%"
  exit /b 0
)

if exist "%ELECTRON_CMD%" (
  start "" "%ELECTRON_CMD%" "%APP_ENTRY%"
  exit /b 0
)

echo [ERROR] Could not find Electron in this source workspace.
echo Expected one of:
echo   %ELECTRON_EXE%
echo   %ELECTRON_CMD%
echo.
echo Run "npm.cmd install" in this repository first.
pause
exit /b 1
