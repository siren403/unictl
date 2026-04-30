param(
    [string] $Version = "patch"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $root
try {
    bun run release $Version
} finally {
    Pop-Location
}
