@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
for %%I in (node.exe) do if not "%%~$PATH:I"=="" set "NODE_EXE=%%~$PATH:I"

if not defined NODE_EXE (
  set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)

if not exist "%NODE_EXE%" (
  echo Node.js was not found. Opening the published game instead.
  start "" "https://yuboxieyi.netlify.app/"
  exit /b 1
)

start "" "http://127.0.0.1:4173/submission/"
"%NODE_EXE%" tools\serve.mjs
