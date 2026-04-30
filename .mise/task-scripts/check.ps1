$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $root
try {
    bun run scripts/check-error-registry.ts
    bun run scripts/check-unity-meta-guids.ts
} finally {
    Pop-Location
}
