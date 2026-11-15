@echo off
rem berkeleyenglish.co.kr deploy - double click this file
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1
echo.
pause
