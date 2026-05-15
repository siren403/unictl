$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $root
try {
    bun run scripts/check-error-registry.ts
    bun run check:meta-guids
} finally {
    Pop-Location
}
