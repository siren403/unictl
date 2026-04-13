$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path "$ScriptDir\..\.."
$NativeDir = "$RepoRoot\native\unictl_native"
$PluginDir = "$RepoRoot\packages\upm\com.unictl.editor\Plugins\Windows\x86_64"

Push-Location $NativeDir
try {
    cargo build --release --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
Copy-Item "$NativeDir\target\x86_64-pc-windows-msvc\release\unictl_native.dll" "$PluginDir\unictl_native.dll" -Force

Write-Host "Built: $PluginDir\unictl_native.dll"
