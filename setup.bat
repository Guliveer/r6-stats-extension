@echo off
REM Install dependencies, scrape rank icons, and build the extension.
REM Run from the repo root: setup.bat
setlocal

cd /d "%~dp0"

echo ==^> Installing dependencies
if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 goto :error

echo ==^> Fetching rank icons
call node scripts\scrape-rank-icons.mjs
if errorlevel 1 goto :error

REM Champion top-X icons. Skipped if already populated.
if not exist public\icons\ranks\champion-ranks\9999.webp (
  echo ==^> Fetching champion-rank icons ^(several minutes^)
  call node scripts\scrape-champion-ranks.mjs
  if errorlevel 1 goto :error
  echo ==^> Compressing champion-rank icons
  call node scripts\convert-champion-ranks.mjs
  if errorlevel 1 goto :error
)

echo ==^> Building extension
call npm run build
if errorlevel 1 goto :error

echo.
echo Done. Load 'dist\' in chrome://extensions (Developer mode -^> Load unpacked).
exit /b 0

:error
echo Setup failed.
exit /b 1
