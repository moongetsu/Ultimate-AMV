@echo off
setlocal
cd /d "%~dp0"

echo Ultimate AMV - Cache Clean
echo ==========================
echo.
echo Will delete:
echo   src-tauri\target    (Rust/Cargo build cache, often 10+ GB)
echo   dist                (Vite frontend output)
echo   node_modules\.vite  (Vite dev cache)
echo   build.log, build-0.3.0.log, temp.txt
echo.
echo Next build will be a cold rebuild (~10-15 min for Rust).
echo.
choice /c YN /n /m "Proceed? [Y/N] "
if errorlevel 2 (
    echo Aborted.
    exit /b 0
)
echo.

call :wipe_dir "src-tauri\target"
call :wipe_dir "dist"
call :wipe_dir "node_modules\.vite"
call :wipe_file "build.log"
call :wipe_file "build-0.3.0.log"
call :wipe_file "temp.txt"

echo.
echo Done.
exit /b 0


:wipe_dir
if not exist %~1 (
    echo skip   %~1  ^(not present^)
    exit /b 0
)
echo clean  %~1
rd /s /q %~1 >nul 2>&1
if exist %~1 (
    rem Retry once - Defender often holds a transient handle right after bulk deletes
    timeout /t 2 /nobreak >nul
    rd /s /q %~1 >nul 2>&1
)
if exist %~1 (
    echo   WARN: %~1 not fully removed - close Explorer/IDE windows pointing into it and re-run
    exit /b 1
)
exit /b 0

:wipe_file
if not exist %~1 (
    exit /b 0
)
echo clean  %~1
del /f /q %~1 >nul 2>&1
exit /b 0
