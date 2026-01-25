@echo off
echo ========================================
echo  VAM Seek Electron Demo - Setup
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    echo This may take a few minutes on first run.
    echo.
    npm install
    if errorlevel 1 (
        echo.
        echo ERROR: npm install failed.
        echo Please make sure Node.js is installed.
        echo Download from: https://nodejs.org/
        pause
        exit /b 1
    )
    echo.
    echo Dependencies installed successfully!
    echo.
)

echo Starting VAM Seek Electron Demo...
npm start

pause
