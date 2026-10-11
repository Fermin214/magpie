param([string]$Go = 'go', [switch]$SkipResources)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$previousGoEnv = @{ GOOS=$env:GOOS; GOARCH=$env:GOARCH; CGO_ENABLED=$env:CGO_ENABLED }
$env:GOOS='windows'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
Push-Location $repoRoot
try {
  if ((Get-Content go.mod -First 1) -ne 'module github.com/yetone/magpie') { throw 'Run from the magpie fork.' }
  $source = (& git rev-parse --short=12 HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot identify source commit.' }
  $dirty = [bool](& git status --porcelain --untracked-files=normal)
  # Deliberately not semver: upstream Released() refuses both GUI and CLI replacement.
  $version = 'agenthub-' + $source
  if ($dirty) { $version += '-dirty' }
  New-Item -ItemType Directory -Force dist | Out-Null
  $resource = Join-Path $repoRoot 'rsrc_windows_amd64.syso'
  if (-not $SkipResources -and (Test-Path $resource)) { throw 'An existing Windows resource must be preserved; use -SkipResources.' }
  $madeResource = $false
  try {
    if (-not $SkipResources) {
      & $Go run github.com/tc-hib/go-winres@v0.3.3 make --in build/windows/winres.json --arch amd64 --out rsrc --file-version '0.0.0' --product-version '0.0.0'
      if ($LASTEXITCODE -ne 0) { throw 'Windows resources failed.' }
      $madeResource = $true
    }
    & $Go build -tags production -trimpath -ldflags "-s -w -H windowsgui -X main.version=$version" -o dist/magpie-agenthub.exe .
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
  } finally { if ($madeResource -and (Test-Path $resource)) { Remove-Item -LiteralPath $resource } }
  $manifest = [ordered]@{ version=$version; commit=(& git rev-parse HEAD).Trim(); dirty=$dirty; sha256=(Get-FileHash dist/magpie-agenthub.exe -Algorithm SHA256).Hash.ToLowerInvariant(); automaticUpstreamReplacement=$false }
  $manifest | ConvertTo-Json | Set-Content dist/agenthub-build.json -Encoding utf8
  $manifest | ConvertTo-Json
} finally {
  Pop-Location
  foreach ($key in $previousGoEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $previousGoEnv[$key], 'Process') }
}
