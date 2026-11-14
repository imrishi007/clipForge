$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    npm run verify
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
