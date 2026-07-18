[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$CheckpointDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $output = & $FilePath @ArgumentList 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE.`n$($output -join "`n")"
  }
  return $output
}

function Get-CheckedScalar {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Label
  )
  return ((Invoke-Checked -FilePath $FilePath -ArgumentList $ArgumentList -Label $Label) -join "`n").Trim()
}

function Write-Utf8File {
  param([string]$Path, [string]$Value)
  [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

function Assert-RegularFile {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path
  if ($item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw "Rollback checkpoint file must be a regular file: $Path"
  }
}

function Assert-FileHash {
  param([string]$Path, [string]$Expected, [string]$Label)
  if ($Expected -notmatch '^[a-f0-9]{64}$') { throw "$Label SHA-256 is invalid." }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected) { throw "$Label SHA-256 verification failed." }
}

function Get-RunningServiceEvidence {
  param([string]$Service)
  $containerId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('compose', 'ps', '-q', $Service) -Label "$Service container lookup"
  if ($containerId -notmatch '^[a-f0-9]{12,64}$') {
    throw "The current $Service service must be running before rollback so automatic compensation remains possible."
  }
  $status = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.State.Status}}') -Label "$Service container status"
  $health = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}') -Label "$Service container health"
  if ($status -ne 'running' -or $health -ne 'healthy') {
    throw "The current $Service service must be running and healthy before rollback."
  }
  $imageId = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.Image}}') -Label "$Service image capture").ToLowerInvariant()
  $revision = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $imageId, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}') -Label "$Service image revision").ToLowerInvariant()
  if ($imageId -notmatch '^sha256:[a-f0-9]{64}$' -or $revision -notmatch '^[a-f0-9]{40}$') {
    throw "The current $Service image lacks immutable ID or revision evidence."
  }
  return [ordered]@{ image_id = $imageId; revision = $revision }
}

function Test-ApplicationHealth {
  foreach ($url in @('http://127.0.0.1:5679/health', 'http://127.0.0.1:5679/ready', 'http://127.0.0.1:3013/')) {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
    if ($response.StatusCode -ne 200) { throw "Application health check failed: $url" }
  }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$checkpointItem = Get-Item -LiteralPath (Resolve-Path -LiteralPath $CheckpointDirectory).Path
if (-not $checkpointItem.PSIsContainer -or (($checkpointItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
  throw 'Rollback checkpoint must be a real directory.'
}
$checkpoint = $checkpointItem.FullName
$metadataPath = Join-Path $checkpoint 'metadata.json'
$backupPath = Join-Path $checkpoint 'data.zip'
$hashPath = Join-Path $checkpoint 'data.sha256.txt'
$composePath = Join-Path $checkpoint 'docker-compose.yml'
$configPath = Join-Path $checkpoint 'configs\config.yaml'
$imageArchivePath = Join-Path $checkpoint 'images.tar'
$summaryPath = Join-Path $checkpoint 'rollback-drill-summary.json'
foreach ($requiredPath in @($metadataPath, $backupPath, $hashPath, $composePath, $configPath, $imageArchivePath, $summaryPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Rollback checkpoint is incomplete: $requiredPath"
  }
  Assert-RegularFile -Path $requiredPath
}

$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ($metadata.schema -ne 'localminidrama.release-rollback-checkpoint.v3') { throw 'Rollback checkpoint schema is invalid.' }
if ($metadata.previous_commit -notmatch '^[a-f0-9]{40}$') { throw 'Rollback checkpoint commit is invalid.' }
if ($metadata.backend.image_id -notmatch '^sha256:[a-f0-9]{64}$' -or $metadata.frontend.image_id -notmatch '^sha256:[a-f0-9]{64}$') {
  throw 'Rollback checkpoint image IDs are invalid.'
}
if ($metadata.backend.revision -ne $metadata.previous_commit -or $metadata.frontend.revision -ne $metadata.previous_commit) {
  throw 'Rollback checkpoint image revisions do not match the recorded commit.'
}
$rollbackTag = "rollback-checkpoint-$($metadata.previous_commit.Substring(0, 12))"
$expectedBackendRef = "localminidrama-backend:$rollbackTag"
$expectedFrontendRef = "localminidrama-frontend:$rollbackTag"
if ($metadata.backend.rollback_ref -ne $expectedBackendRef -or $metadata.frontend.rollback_ref -ne $expectedFrontendRef) {
  throw 'Rollback checkpoint image references do not match the captured commit.'
}

$expectedBackupHash = (Get-Content -LiteralPath $hashPath -Raw).Trim().ToLowerInvariant()
if ($metadata.backup_sha256 -ne $expectedBackupHash) { throw 'Rollback backup hash records disagree.' }
Assert-FileHash -Path $backupPath -Expected $expectedBackupHash -Label 'Rollback data backup'
Assert-FileHash -Path $composePath -Expected $metadata.compose_sha256 -Label 'Archived Compose file'
Assert-FileHash -Path $configPath -Expected $metadata.runtime_config_sha256 -Label 'Archived runtime config'
Assert-FileHash -Path $imageArchivePath -Expected $metadata.image_archive_sha256 -Label 'Archived Docker images'
Assert-FileHash -Path $summaryPath -Expected $metadata.rollback_evidence_sha256 -Label 'Rollback drill evidence'

$summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
if ($summary.schema -ne 'localminidrama.rollback-drill.v2' -or
    $summary.status -ne 'passed' -or
    $summary.source.commit -ne $metadata.previous_commit -or
    $summary.source.version -ne $metadata.version -or
    $summary.source.working_tree_dirty -ne $false) {
  throw 'Rollback drill evidence does not bind this version, commit, and clean source state.'
}

Push-Location $repoRoot
try {
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'load', '--input', $imageArchivePath) -Label 'Rollback image archive load' | Out-Null
  $loadedBackendId = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $expectedBackendRef, '--format', '{{.Id}}') -Label 'Backend rollback image load verification').ToLowerInvariant()
  $loadedFrontendId = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $expectedFrontendRef, '--format', '{{.Id}}') -Label 'Frontend rollback image load verification').ToLowerInvariant()
  if ($loadedBackendId -ne $metadata.backend.image_id -or $loadedFrontendId -ne $metadata.frontend.image_id) {
    throw 'Loaded rollback image IDs do not match the checkpoint.'
  }
  $backendRevision = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $expectedBackendRef, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}') -Label 'Backend rollback image verification').ToLowerInvariant()
  $frontendRevision = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $expectedFrontendRef, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}') -Label 'Frontend rollback image verification').ToLowerInvariant()
  if ($backendRevision -ne $metadata.previous_commit -or $frontendRevision -ne $metadata.previous_commit) {
    throw 'Rollback image labels do not match the checkpoint commit.'
  }

  Remove-Item Env:LOCALMINIDRAMA_CONFIG_DIR -ErrorAction SilentlyContinue
  $currentBackend = Get-RunningServiceEvidence -Service 'backend'
  $currentFrontend = Get-RunningServiceEvidence -Service 'frontend'
  if ($currentBackend.revision -ne $currentFrontend.revision) {
    throw 'Current backend and frontend image revisions do not match; rollback compensation would be ambiguous.'
  }
  $configDirectory = Split-Path -Parent $configPath
  $env:LOCALMINIDRAMA_IMAGE_TAG = $rollbackTag
  $env:LOCALMINIDRAMA_BUILD_REVISION = $metadata.previous_commit
  $env:LOCALMINIDRAMA_CONFIG_DIR = $configDirectory
  Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', '--project-directory', $repoRoot, '-f', $composePath, 'config', '--quiet') -Label 'Archived Docker Compose validation' | Out-Null
  Remove-Item Env:LOCALMINIDRAMA_CONFIG_DIR -ErrorAction SilentlyContinue

  $forwardTag = "rollback-forward-$($currentBackend.revision.Substring(0, 12))"
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $currentBackend.image_id, "localminidrama-backend:$forwardTag") -Label 'Current backend compensation tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $currentFrontend.image_id, "localminidrama-frontend:$forwardTag") -Label 'Current frontend compensation tag' | Out-Null

  $compensationRoot = Join-Path $checkpoint ("compensation-" + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
  New-Item -ItemType Directory -Path $compensationRoot | Out-Null
  $probePath = Join-Path $compensationRoot '.write-probe'
  Write-Utf8File -Path $probePath -Value "probe`n"
  Remove-Item -LiteralPath $probePath

  Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'down') -Label 'Current Docker shutdown' | Out-Null
  $compensationBackup = Join-Path $compensationRoot 'data.zip'
  Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'backup:data', '--', '--output', $compensationBackup) -Label 'Pre-rollback compensation backup' | Out-Null
  $compensationHash = (Get-FileHash -LiteralPath $compensationBackup -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-Utf8File -Path (Join-Path $compensationRoot 'data.sha256.txt') -Value "$compensationHash`n"

  Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'restore:data', '--', '--input', $backupPath, '--yes') -Label 'Rollback data restore' | Out-Null

  $rollbackStartError = $null
  try {
    $env:LOCALMINIDRAMA_IMAGE_TAG = $rollbackTag
    $env:LOCALMINIDRAMA_BUILD_REVISION = $metadata.previous_commit
    $env:LOCALMINIDRAMA_CONFIG_DIR = $configDirectory
    Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', '--project-directory', $repoRoot, '-f', $composePath, 'up', '-d', '--no-build', '--wait') -Label 'Rollback container startup' | Out-Null
    Test-ApplicationHealth
  } catch {
    $rollbackStartError = $_
  }

  if ($rollbackStartError) {
    try {
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', '--project-directory', $repoRoot, '-f', $composePath, 'down') -Label 'Failed rollback shutdown' | Out-Null
      Remove-Item Env:LOCALMINIDRAMA_CONFIG_DIR -ErrorAction SilentlyContinue
      Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'restore:data', '--', '--input', $compensationBackup, '--yes') -Label 'Compensation data restore' | Out-Null
      $env:LOCALMINIDRAMA_IMAGE_TAG = $forwardTag
      $env:LOCALMINIDRAMA_BUILD_REVISION = $currentBackend.revision
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'up', '-d', '--no-build', '--wait') -Label 'Forward deployment recovery' | Out-Null
      Test-ApplicationHealth
    } catch {
      throw "Rollback startup failed and automatic compensation also failed. Rollback error: $rollbackStartError Compensation error: $_"
    }
    throw "Rollback startup failed; the pre-rollback data and forward deployment were restored automatically. Error: $rollbackStartError"
  }

  $compensationMetadata = [ordered]@{
    schema = 'localminidrama.rollback-compensation.v1'
    created_at = [DateTime]::UtcNow.ToString('o')
    forward_revision = $currentBackend.revision
    backup_file = 'data.zip'
    backup_sha256 = $compensationHash
    credentials_excluded = $true
  }
  Write-Utf8File -Path (Join-Path $compensationRoot 'metadata.json') -Value "$(ConvertTo-Json $compensationMetadata -Depth 4)`n"
  Write-Output "Rollback started from commit $($metadata.previous_commit) with tag $rollbackTag."
  Write-Output "Pre-rollback compensation backup retained at $compensationRoot."
  Write-Output 'Provider credentials are excluded from data backups and must be configured and tested again.'
} finally {
  Pop-Location
}
