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
  $previousErrorActionPreference = $ErrorActionPreference
  $output = @()
  $exitCode = 0
  try {
    # Docker Compose writes normal progress to stderr on Windows; the native exit code is authoritative.
    $ErrorActionPreference = 'Continue'
    $output = @(& $FilePath @ArgumentList 2>&1)
    $exitCode = [int]$LASTEXITCODE
  } catch {
    throw "$Label could not execute: $($_.Exception.Message)"
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "$Label failed with exit code $exitCode.`n$($output -join "`n")"
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

function Set-RuntimeConfigEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$ConfigDirectory,
    [Parameter(Mandatory = $true)][string]$ConfigPath
  )
  $env:LOCALMINIDRAMA_CONFIG_DIR = $ConfigDirectory
  $env:LOCALMINIDRAMA_CONFIG_PATH = $ConfigPath
}

function Clear-RuntimeConfigEnvironment {
  Remove-Item Env:LOCALMINIDRAMA_CONFIG_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:LOCALMINIDRAMA_CONFIG_PATH -ErrorAction SilentlyContinue
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

function Get-ContainerBindSource {
  param(
    [Parameter(Mandatory = $true)][string]$ContainerId,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  $mountJson = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $ContainerId, '--format', '{{json .Mounts}}') -Label "${Destination} mount capture"
  try {
    $mounts = @((ConvertFrom-Json -InputObject $mountJson) | ForEach-Object { $_ })
  } catch {
    throw "${Destination} mount capture returned invalid Docker JSON."
  }
  $mount = $mounts | Where-Object { $_.Type -eq 'bind' -and $_.Destination -eq $Destination } | Select-Object -First 1
  if ($null -eq $mount -or [string]::IsNullOrWhiteSpace($mount.Source)) {
    throw "The running backend has no regular bind mount at $Destination."
  }
  return [System.IO.Path]::GetFullPath([string]$mount.Source)
}

function Get-ImageRevision {
  param(
    [Parameter(Mandatory = $true)][string]$ImageReference,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $labelsJson = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $ImageReference, '--format', '{{json .Config.Labels}}') -Label $Label
  try {
    $labels = $labelsJson | ConvertFrom-Json
  } catch {
    throw "$Label returned invalid Docker labels JSON."
  }
  $property = $labels.PSObject.Properties['org.opencontainers.image.revision']
  if ($null -eq $property -or [string]::IsNullOrWhiteSpace([string]$property.Value)) {
    throw "$Label did not contain org.opencontainers.image.revision."
  }
  return ([string]$property.Value).ToLowerInvariant()
}

function Get-RunningServiceEvidence {
  param([string]$Service)
  $containerId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('compose', 'ps', '-a', '-q', $Service) -Label "$Service container lookup"
  if ($containerId -notmatch '^[a-f0-9]{12,64}$') {
    throw "The current $Service container must still exist before rollback so immutable compensation evidence can be captured."
  }
  $status = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.State.Status}}') -Label "$Service container status"
  $health = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}') -Label "$Service container health"
  if ($status -ne 'running' -or $health -ne 'healthy') {
    Write-Warning "The current $Service container is $status with health $health; rollback will continue using its immutable image and configuration evidence."
  }
  $imageId = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.Image}}') -Label "$Service image capture").ToLowerInvariant()
  $revision = Get-ImageRevision -ImageReference $imageId -Label "$Service image revision"
  if ($imageId -notmatch '^sha256:[a-f0-9]{64}$' -or $revision -notmatch '^[a-f0-9]{40}$') {
    throw "The current $Service image lacks immutable ID or revision evidence."
  }
  return [ordered]@{
    container_id = $containerId
    image_id = $imageId
    revision = $revision
    status = $status
    health = $health
  }
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
if ($null -eq $metadata.PSObject.Properties['runtime_config_sanitized'] -or
    $metadata.runtime_config_sanitized -isnot [bool] -or
    $metadata.runtime_config_sanitized -ne $true) {
  throw 'Rollback checkpoint runtime config is not declared sanitized.'
}
if ($null -eq $metadata.PSObject.Properties['runtime_config_credentials_excluded'] -or
    $metadata.runtime_config_credentials_excluded -isnot [bool] -or
    $metadata.runtime_config_credentials_excluded -ne $true) {
  throw 'Rollback checkpoint does not prove that runtime config credentials were excluded.'
}
if ($null -eq $metadata.PSObject.Properties['credential_reconfiguration_required'] -or
    $metadata.credential_reconfiguration_required -isnot [bool] -or
    $metadata.credential_reconfiguration_required -ne $true) {
  throw 'Rollback checkpoint does not require Provider credential reconfiguration.'
}
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
  Write-Warning 'Archived runtime config excludes Provider credentials. After rollback, configure credentials and test again before using AI generation.'
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'load', '--input', $imageArchivePath) -Label 'Rollback image archive load' | Out-Null
  $loadedBackendId = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $expectedBackendRef, '--format', '{{.Id}}') -Label 'Backend rollback image load verification').ToLowerInvariant()
  $loadedFrontendId = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $expectedFrontendRef, '--format', '{{.Id}}') -Label 'Frontend rollback image load verification').ToLowerInvariant()
  if ($loadedBackendId -ne $metadata.backend.image_id -or $loadedFrontendId -ne $metadata.frontend.image_id) {
    throw 'Loaded rollback image IDs do not match the checkpoint.'
  }
  $backendRevision = Get-ImageRevision -ImageReference $expectedBackendRef -Label 'Backend rollback image verification'
  $frontendRevision = Get-ImageRevision -ImageReference $expectedFrontendRef -Label 'Frontend rollback image verification'
  if ($backendRevision -ne $metadata.previous_commit -or $frontendRevision -ne $metadata.previous_commit) {
    throw 'Rollback image labels do not match the checkpoint commit.'
  }

  $currentBackend = Get-RunningServiceEvidence -Service 'backend'
  $currentFrontend = Get-RunningServiceEvidence -Service 'frontend'
  if ($currentBackend.revision -ne $currentFrontend.revision) {
    throw 'Current backend and frontend image revisions do not match; rollback compensation would be ambiguous.'
  }
  $forwardConfigDirectory = Get-ContainerBindSource -ContainerId $currentBackend.container_id -Destination '/app/config-source'
  $forwardConfigPath = Join-Path $forwardConfigDirectory 'config.yaml'
  Assert-RegularFile -Path $forwardConfigPath
  $configDirectory = Split-Path -Parent $configPath
  Set-RuntimeConfigEnvironment -ConfigDirectory $configDirectory -ConfigPath $configPath
  $env:LOCALMINIDRAMA_IMAGE_TAG = $rollbackTag
  $env:LOCALMINIDRAMA_BUILD_REVISION = $metadata.previous_commit
  Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', '--project-directory', $repoRoot, '-f', $composePath, 'config', '--quiet') -Label 'Archived Docker Compose validation' | Out-Null

  $forwardTag = "rollback-forward-$($currentBackend.revision.Substring(0, 12))"
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $currentBackend.image_id, "localminidrama-backend:$forwardTag") -Label 'Current backend compensation tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $currentFrontend.image_id, "localminidrama-frontend:$forwardTag") -Label 'Current frontend compensation tag' | Out-Null

  $compensationRoot = Join-Path $checkpoint ("compensation-" + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
  New-Item -ItemType Directory -Path $compensationRoot | Out-Null
  $probePath = Join-Path $compensationRoot '.write-probe'
  Write-Utf8File -Path $probePath -Value "probe`n"
  Remove-Item -LiteralPath $probePath

  $compensationBackup = Join-Path $compensationRoot 'data.zip'
  $compensationHash = $null
  $preRollbackError = $null
  try {
    Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
    Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'down') -Label 'Current Docker shutdown' | Out-Null
    Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
    Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'backup:data', '--', '--output', $compensationBackup) -Label 'Pre-rollback compensation backup' | Out-Null
    $compensationHash = (Get-FileHash -LiteralPath $compensationBackup -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Utf8File -Path (Join-Path $compensationRoot 'data.sha256.txt') -Value "$compensationHash`n"

    Set-RuntimeConfigEnvironment -ConfigDirectory $configDirectory -ConfigPath $configPath
    Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'restore:data', '--', '--input', $backupPath, '--yes') -Label 'Rollback data restore' | Out-Null
  } catch {
    $preRollbackError = $_
  }

  if ($preRollbackError) {
    $preRollbackCompensationError = $null
    $preRollbackCompensationShutdownError = $null
    try {
      # A failed shutdown can leave only part of the stack stopped. Normalize it
      # before restoring the forward data and starting the captured deployment.
      Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'down') -Label 'Failed rollback preparation shutdown' | Out-Null
      if ($compensationHash -and (Test-Path -LiteralPath $compensationBackup -PathType Leaf)) {
        Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
        Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'restore:data', '--', '--input', $compensationBackup, '--yes') -Label 'Preparation compensation data restore' | Out-Null
      }
      $env:LOCALMINIDRAMA_IMAGE_TAG = $forwardTag
      $env:LOCALMINIDRAMA_BUILD_REVISION = $currentBackend.revision
      Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'up', '-d', '--no-build', '--wait') -Label 'Preparation forward deployment recovery' | Out-Null
      Test-ApplicationHealth
    } catch {
      $preRollbackCompensationError = $_
    }
    if ($preRollbackCompensationError) {
      try {
        Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
        Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'down') -Label 'Preparation compensation failure shutdown' | Out-Null
      } catch {
        $preRollbackCompensationShutdownError = $_
      }
      $preRollbackShutdownDetails = @($preRollbackCompensationShutdownError) | Where-Object { $null -ne $_ } | ForEach-Object { $_.ToString() }
      $preRollbackShutdownMessage = if ($preRollbackShutdownDetails.Count -gt 0) { " Shutdown attempt: $($preRollbackShutdownDetails -join ' | ')" } else { '' }
      throw "Rollback preparation failed and automatic forward recovery also failed; service may remain stopped. Preparation error: $preRollbackError Compensation error: $preRollbackCompensationError.$preRollbackShutdownMessage"
    }
    throw "Rollback preparation failed; the forward deployment and data were restored automatically. Error: $preRollbackError"
  }

  $rollbackStartError = $null
  try {
    $env:LOCALMINIDRAMA_IMAGE_TAG = $rollbackTag
    $env:LOCALMINIDRAMA_BUILD_REVISION = $metadata.previous_commit
    Set-RuntimeConfigEnvironment -ConfigDirectory $configDirectory -ConfigPath $configPath
    Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', '--project-directory', $repoRoot, '-f', $composePath, 'up', '-d', '--no-build', '--wait') -Label 'Rollback container startup' | Out-Null
    Test-ApplicationHealth
  } catch {
    $rollbackStartError = $_
  }

  if ($rollbackStartError) {
    $rollbackShutdownError = $null
    $compensationError = $null
    $compensationShutdownError = $null
    try {
      Set-RuntimeConfigEnvironment -ConfigDirectory $configDirectory -ConfigPath $configPath
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', '--project-directory', $repoRoot, '-f', $composePath, 'down') -Label 'Failed rollback shutdown' | Out-Null
    } catch {
      $rollbackShutdownError = $_
    }
    try {
      Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
      Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'restore:data', '--', '--input', $compensationBackup, '--yes') -Label 'Compensation data restore' | Out-Null
      $env:LOCALMINIDRAMA_IMAGE_TAG = $forwardTag
      $env:LOCALMINIDRAMA_BUILD_REVISION = $currentBackend.revision
      Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'up', '-d', '--no-build', '--wait') -Label 'Forward deployment recovery' | Out-Null
      Test-ApplicationHealth
    } catch {
      $compensationError = $_
    }
    if ($compensationError) {
      try {
        Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
        Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'down') -Label 'Compensation failure shutdown' | Out-Null
      } catch {
        $compensationShutdownError = $_
      }
      $shutdownDetails = @($rollbackShutdownError, $compensationShutdownError) | Where-Object { $null -ne $_ } | ForEach-Object { $_.ToString() }
      $shutdownMessage = if ($shutdownDetails.Count -gt 0) { " Shutdown attempts: $($shutdownDetails -join ' | ')" } else { '' }
      throw "Rollback startup failed and automatic compensation also failed; service may remain stopped. Rollback error: $rollbackStartError Compensation error: $compensationError.$shutdownMessage"
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
  Write-Output 'Provider credentials are excluded from the checkpoint and data backups; configure credentials and test again before using AI generation.'
} finally {
  Clear-RuntimeConfigEnvironment
  Pop-Location
}
