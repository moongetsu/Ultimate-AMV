@echo off
setlocal

set "APP_NAME=Ultimate AMV"
set "APP_EXE=ultimate-amv-script.exe"
set "APP_ID=com.elishapervez.ultimateamv"
set "BAT_SELF=%~f0"

echo Killing running app processes...
taskkill /f /im "%APP_EXE%" >nul 2>&1
timeout /t 1 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$bat = $env:BAT_SELF;" ^
  "$script = Get-Content -LiteralPath $bat -Raw;" ^
  "$script = $script -split '(?m)^# POWERSHELL_UNINSTALLER\r?$', 2;" ^
  "if ($script.Count -lt 2) { throw 'PowerShell uninstall body was not found.' }" ^
  "Invoke-Expression $script[1]"

set "PS_EXIT=%ERRORLEVEL%"
if "%PS_EXIT%"=="2" (
    echo.
    echo Uninstall completed with leftovers - see the list above.
    exit /b 2
)
if not "%PS_EXIT%"=="0" (
    echo.
    echo Cleanup failed with exit code %PS_EXIT%.
    exit /b %PS_EXIT%
)

echo.
echo Done. Ultimate AMV install, app data, shortcuts, and uninstall entries were cleaned for this Windows user.
exit /b 0

# POWERSHELL_UNINSTALLER
$ErrorActionPreference = 'SilentlyContinue'

$appName = 'Ultimate AMV'
$appId = 'com.elishapervez.ultimateamv'

$uninstallRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)

$entries = foreach ($root in $uninstallRoots) {
    if (Test-Path $root) {
        Get-ChildItem $root | ForEach-Object {
            $item = Get-ItemProperty $_.PSPath
            if ($item.DisplayName -like "$appName*" -or $_.PSChildName -eq $appName -or $_.PSChildName -eq $appId) {
                $item
            }
        }
    }
}

$entries = @(
    $entries |
        Where-Object { $_ } |
        Select-Object -Unique PSPath, DisplayName, InstallLocation, UninstallString, QuietUninstallString
)

# Discover candidate install dirs BEFORE running the uninstaller : we need
# them to filter the python.exe kill below. We accept either an explicit
# InstallLocation registry value or the directory containing the
# (Quiet)UninstallString exe.
$uninstallDirs = foreach ($entry in $entries) {
    $command = if ($entry.QuietUninstallString) { $entry.QuietUninstallString } else { $entry.UninstallString }
    if ($command -match '^\s*"([^"]+)"') {
        Split-Path -Parent $matches[1]
    } elseif ($command) {
        Split-Path -Parent $command.Split(' ', 2)[0]
    }
}

$installDirs = @(
    $entries | ForEach-Object { $_.InstallLocation } | Where-Object { $_ }
    $uninstallDirs | Where-Object { $_ }
) | Select-Object -Unique

# Kill any Python sidecars whose ImagePath sits inside an install dir.
# Pre-0.4.1 builds did not pin children to a Job Object, so a bare
# `taskkill /f /im ultimate-amv-script.exe` leaves orphan clip-server /
# audio-worker processes alive : they hold python\python.exe and
# python\_bz2.pyd open, NSIS's Delete fails silently, and Remove-Item
# below leaves stragglers behind. Filtering by ImagePath means we only
# touch *our* python.exes, never the user's other Python installs.
foreach ($dir in $installDirs) {
    if (-not (Test-Path $dir)) { continue }
    $prefix = (Resolve-Path -LiteralPath $dir).Path
    if (-not $prefix.EndsWith('\')) { $prefix = "$prefix\" }
    Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" |
        Where-Object {
            $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
        } |
        ForEach-Object {
            Write-Host "Stopping Python sidecar: $($_.ExecutablePath) (PID $($_.ProcessId))"
            Stop-Process -Id $_.ProcessId -Force
        }
}

foreach ($entry in $entries) {
    $command = if ($entry.QuietUninstallString) { $entry.QuietUninstallString } else { $entry.UninstallString }
    if (-not $command) {
        continue
    }

    Write-Host 'Running registered uninstaller...'
    if ($command -match '^\s*"([^"]+)"\s*(.*)$') {
        $exe = $matches[1]
        $args = $matches[2]
    } else {
        $parts = $command.Split(' ', 2)
        $exe = $parts[0]
        $args = if ($parts.Count -gt 1) { $parts[1] } else { '' }
    }

    if ($args -notmatch '(^| )/S( |$)') {
        $args = "$args /S".Trim()
    }

    Start-Process -FilePath $exe -ArgumentList $args -Wait
}
foreach ($dir in $installDirs) {
    if (Test-Path $dir) {
        Write-Host "Removing install directory: $dir"
        Remove-Item -LiteralPath $dir -Recurse -Force
    }
}

$knownDirs = @(
    (Join-Path $env:LOCALAPPDATA $appName),
    (Join-Path $env:LOCALAPPDATA $appId),
    (Join-Path $env:APPDATA $appId)
)
foreach ($dir in $knownDirs) {
    if (Test-Path $dir) {
        Write-Host "Removing app data: $dir"
        Remove-Item -LiteralPath $dir -Recurse -Force
    }
}

$shortcuts = @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Ultimate AMV.lnk'),
    (Join-Path $env:USERPROFILE 'Desktop\Ultimate AMV.lnk'),
    (Join-Path $env:PUBLIC 'Desktop\Ultimate AMV.lnk'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Ultimate AMV.lnk')
)
foreach ($shortcut in $shortcuts) {
    if (Test-Path $shortcut) {
        Write-Host "Removing shortcut: $shortcut"
        Remove-Item -LiteralPath $shortcut -Force
    }
}

foreach ($root in $uninstallRoots) {
    if (Test-Path $root) {
        Get-ChildItem $root | ForEach-Object {
            $item = Get-ItemProperty $_.PSPath
            if ($item.DisplayName -like "$appName*" -or $_.PSChildName -eq $appName -or $_.PSChildName -eq $appId) {
                Write-Host "Removing uninstall registry key: $($_.Name)"
                Remove-Item -LiteralPath $_.PSPath -Recurse -Force
            }
        }
    }
}

# Verification pass : fail loudly if anything we tried to remove is still
# there. $ErrorActionPreference = SilentlyContinue would otherwise swallow
# the Delete / Remove-Item failures that happen when a file is still held
# open (the exact symptom we're trying to fix). Returning a non-zero exit
# code lets the outer .bat surface a clear "incomplete" message instead
# of reporting "Done" on a half-clean uninstall.
$ErrorActionPreference = 'Continue'
$leftover = New-Object System.Collections.Generic.List[string]
foreach ($dir in $installDirs) {
    if ($dir -and (Test-Path -LiteralPath $dir)) { $leftover.Add("install dir: $dir") }
}
foreach ($dir in $knownDirs) {
    if (Test-Path -LiteralPath $dir) { $leftover.Add("app data: $dir") }
}
foreach ($shortcut in $shortcuts) {
    if (Test-Path -LiteralPath $shortcut) { $leftover.Add("shortcut: $shortcut") }
}
foreach ($root in $uninstallRoots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem $root | ForEach-Object {
        $item = Get-ItemProperty $_.PSPath
        if ($item.DisplayName -like "$appName*" -or $_.PSChildName -eq $appName -or $_.PSChildName -eq $appId) {
            $leftover.Add("registry: $($_.Name)")
        }
    }
}

if ($leftover.Count -gt 0) {
    Write-Host ''
    Write-Host 'Uninstall finished but the following items are still present:' -ForegroundColor Yellow
    $leftover | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    Write-Host ''
    Write-Host 'This usually means a python.exe sidecar was still holding files open.' -ForegroundColor Yellow
    Write-Host 'Reboot and re-run dev-uninstall.bat, or delete the listed paths by hand.' -ForegroundColor Yellow
    exit 2
}
