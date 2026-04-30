param(
    [string] $Version = "patch"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $root
try {
    bun run release $Version --dry-run
} finally {
    Pop-Location
}
