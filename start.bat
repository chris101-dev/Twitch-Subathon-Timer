@echo off
cd /d "%~dp0Backend"
start /min node server.js
::timeout /t 2
::start http://localhost:3000
exit