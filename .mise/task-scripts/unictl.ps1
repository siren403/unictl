$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Push-Location $root
try {
    bun run ./packages/cli/src/cli.ts @args
} finally {
    Pop-Location
}
