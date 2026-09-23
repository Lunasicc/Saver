@echo off
title Saver
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Saver needs Node.js 22 or newer.
  echo   Download the LTS version from https://nodejs.org, install it, then run this again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing Saver. This only happens the first time and takes a minute or two...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Installation failed. See the messages above.
    pause
    exit /b 1
  )
)

call npm start
pause
