@echo off
rem Full rebuild: server (wipes dist/control-ui) then UI (restores it).
cd /d d:\Dhiraj\Startup_products\openclaw
call pnpm build
if errorlevel 1 (
  echo SERVER BUILD FAILED
  exit /b 1
)
call pnpm ui:build
if errorlevel 1 (
  echo UI BUILD FAILED
  exit /b 1
)
echo ALL BUILDS OK
