$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $root
try {
    bun run scripts/check-error-registry.ts
} finally {
    Pop-Location
}
