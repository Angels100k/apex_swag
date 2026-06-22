# build-opk.ps1 — package the Overwolf app into dist\apex-swag.opk
#
# An .opk is just a zip of the app folder. We whitelist only what the app needs
# at runtime — the PHP backend, the dev proxy, build tooling and the old local
# history artifacts are all left out.
#
# Usage:  powershell -ExecutionPolicy Bypass -File build-opk.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist '_stage'
$opk = Join-Path $dist 'apex-swag.opk'

# Only these paths are shipped.
$include = @(
    'manifest.json',
    'config.js',
    'windows',
    'css',
    'img'
)

# Fresh staging dir
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

foreach ($item in $include) {
    $src = Join-Path $root $item
    if (-not (Test-Path $src)) { throw "Missing required item: $item" }
    Copy-Item $src -Destination $stage -Recurse -Force
}

# Guard: config.js must point at a real backend, not the placeholder.
$cfg = Get-Content (Join-Path $stage 'config.js') -Raw
if ($cfg -match 'YOURDOMAIN' -or $cfg -match 'CHANGE_ME') {
    Write-Warning 'config.js still contains placeholder values (YOURDOMAIN / CHANGE_ME). Set your real backend URL + token before publishing.'
}

if (Test-Path $opk) { Remove-Item $opk -Force }
$zip = Join-Path $dist 'apex-swag.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Rename-Item $zip $opk
Remove-Item $stage -Recurse -Force

Write-Host "Built $opk"
Get-ChildItem $opk | Select-Object Name, Length
