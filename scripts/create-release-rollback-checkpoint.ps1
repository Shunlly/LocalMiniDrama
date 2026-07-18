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

function Assert-RegularFile {
  param([Parameter(Mandatory = $true)][string]$Path)
  $item = Get-Item -LiteralPath $Path
  if ($item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw "Rollback checkpoint source must be a regular file: $Path"
  }
}

function Get-ContainerBindSource {
  param(
    [Parameter(Mandatory = $true)][string]$ContainerId,
    [Parameter(Mandatory = $true)][string]$Destination
  )
  $mountJson = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $ContainerId, '--format', '{{json .Mounts}}') -Label "${Destination} mount capture"
  $mounts = @((ConvertFrom-Json -InputObject $mountJson) | ForEach-Object { $_ })
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

function Write-Utf8File {
  param([string]$Path, [string]$Value)
  [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

function Assert-OutsideRepository {
  param([string]$RepositoryRoot, [string]$Candidate)
  $separator = [System.IO.Path]::DirectorySeparatorChar
  $prefix = $RepositoryRoot.TrimEnd($separator) + $separator
  if ($Candidate.Equals($RepositoryRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $Candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The rollback checkpoint must be outside the repository and live data directory.'
  }
}

function Get-RunningServiceEvidence {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [Parameter(Mandatory = $true)][string]$ExpectedRevision
  )
  $containerId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('compose', 'ps', '-q', $Service) -Label "$Service container lookup"
  if ($containerId -notmatch '^[a-f0-9]{12,64}$') {
    throw "The $Service service must be running before a rollback checkpoint is created."
  }

  $status = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.State.Status}}') -Label "$Service container status"
  $health = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}') -Label "$Service container health"
  if ($status -ne 'running' -or $health -ne 'healthy') {
    throw "The $Service service must be running and healthy before a rollback checkpoint is created."
  }

  $imageId = (Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.Image}}') -Label "$Service running image capture").ToLowerInvariant()
  if ($imageId -notmatch '^sha256:[a-f0-9]{64}$') {
    throw "Docker did not return an immutable image ID for $Service."
  }
  $revision = Get-ImageRevision -ImageReference $imageId -Label "$Service image revision capture"
  if ($revision -ne $ExpectedRevision) {
    throw "The running $Service image revision $revision does not match Git commit $ExpectedRevision. Rebuild with npm run docker:up before creating a checkpoint."
  }

  return [ordered]@{
    container_id = $containerId
    image_id = $imageId
    revision = $revision
    health = $health
  }
}

function Start-CapturedDeployment {
  param(
    [Parameter(Mandatory = $true)]$Backend,
    [Parameter(Mandatory = $true)]$Frontend,
    [Parameter(Mandatory = $true)][string]$Revision
  )
  $recoveryTag = "checkpoint-recovery-$($Revision.Substring(0, 12))"
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $Backend.image_id, "localminidrama-backend:$recoveryTag") -Label 'Backend recovery image tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $Frontend.image_id, "localminidrama-frontend:$recoveryTag") -Label 'Frontend recovery image tag' | Out-Null
  $env:LOCALMINIDRAMA_IMAGE_TAG = $recoveryTag
  $env:LOCALMINIDRAMA_BUILD_REVISION = $Revision
  Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'up', '-d', '--no-build', '--wait') -Label 'Captured deployment recovery' | Out-Null
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$checkpoint = [System.IO.Path]::GetFullPath($CheckpointDirectory)
Assert-OutsideRepository -RepositoryRoot $repoRoot -Candidate $checkpoint
if (Test-Path -LiteralPath $checkpoint) {
  throw "Rollback checkpoint already exists: $checkpoint"
}

Push-Location $repoRoot
try {
  $dirty = Get-CheckedScalar -FilePath 'git' -ArgumentList @('status', '--porcelain', '--untracked-files=normal') -Label 'Git status'
  if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    throw 'Rollback checkpoint requires a clean Git working tree.'
  }
  $commit = (Get-CheckedScalar -FilePath 'git' -ArgumentList @('rev-parse', 'HEAD') -Label 'Commit capture').ToLowerInvariant()
  if ($commit -notmatch '^[a-f0-9]{40}$') { throw 'Git did not return a full commit SHA.' }

  $env:LOCALMINIDRAMA_BUILD_REVISION = $commit
  Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'config', '--quiet') -Label 'Docker Compose validation' | Out-Null
  $backend = Get-RunningServiceEvidence -Service 'backend' -ExpectedRevision $commit
  $frontend = Get-RunningServiceEvidence -Service 'frontend' -ExpectedRevision $commit
  $runtimeConfigDirectory = Get-ContainerBindSource -ContainerId $backend.container_id -Destination '/app/config-source'
  $runtimeConfigSource = Join-Path $runtimeConfigDirectory 'config.yaml'
  Assert-RegularFile -Path $runtimeConfigSource

  New-Item -ItemType Directory -Path $checkpoint | Out-Null
  $configArchiveRoot = Join-Path $checkpoint 'configs'
  New-Item -ItemType Directory -Path $configArchiveRoot | Out-Null
  $composeArchive = Join-Path $checkpoint 'docker-compose.yml'
  $configArchive = Join-Path $configArchiveRoot 'config.yaml'
  Copy-Item -LiteralPath (Join-Path $repoRoot 'docker-compose.yml') -Destination $composeArchive
  Copy-Item -LiteralPath $runtimeConfigSource -Destination $configArchive
  $composeHash = (Get-FileHash -LiteralPath $composeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $configHash = (Get-FileHash -LiteralPath $configArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $imageArchive = Join-Path $checkpoint 'images.tar'
  $rollbackTag = "rollback-checkpoint-$($commit.Substring(0, 12))"
  $backendRollbackRef = "localminidrama-backend:$rollbackTag"
  $frontendRollbackRef = "localminidrama-frontend:$rollbackTag"
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $backend.image_id, $backendRollbackRef) -Label 'Backend checkpoint image tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $frontend.image_id, $frontendRollbackRef) -Label 'Frontend checkpoint image tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'save', '--output', $imageArchive, $backendRollbackRef, $frontendRollbackRef) -Label 'Checkpoint image archive' | Out-Null
  $imageArchiveHash = (Get-FileHash -LiteralPath $imageArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $backend['rollback_ref'] = $backendRollbackRef
  $frontend['rollback_ref'] = $frontendRollbackRef

  $dockerStopped = $false
  try {
    Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'down') -Label 'Docker shutdown' | Out-Null
    $dockerStopped = $true

    $backupPath = Join-Path $checkpoint 'data.zip'
    Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'backup:data', '--', '--output', $backupPath) -Label 'Data backup' | Out-Null
    $backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Utf8File -Path (Join-Path $checkpoint 'data.sha256.txt') -Value "$backupHash`n"

    Invoke-Checked -FilePath 'npm' -ArgumentList @('run', 'verify:rollback') -Label 'Rollback drill' | Out-Null
    $summaryPath = Join-Path $repoRoot 'artifacts\rollback-drill\summary.json'
    $summary = Get-Content -LiteralPath $summaryPath -Raw | ConvertFrom-Json
    if ($summary.schema -ne 'localminidrama.rollback-drill.v2' -or
        $summary.status -ne 'passed' -or
        $summary.source.commit -ne $commit -or
        $summary.source.working_tree_dirty -ne $false) {
      throw 'Rollback drill evidence is not a clean v2 PASS for the captured commit.'
    }
    $summaryArchive = Join-Path $checkpoint 'rollback-drill-summary.json'
    Copy-Item -LiteralPath $summaryPath -Destination $summaryArchive
    $summaryHash = (Get-FileHash -LiteralPath $summaryArchive -Algorithm SHA256).Hash.ToLowerInvariant()

    $version = Get-CheckedScalar -FilePath 'node' -ArgumentList @('-p', "require('./backend-node/package.json').version") -Label 'Version capture'
    $metadata = [ordered]@{
      schema = 'localminidrama.release-rollback-checkpoint.v3'
      created_at = [DateTime]::UtcNow.ToString('o')
      version = $version
      previous_commit = $commit
      backend = $backend
      frontend = $frontend
      backup_file = 'data.zip'
      backup_sha256 = $backupHash
      compose_file = 'docker-compose.yml'
      compose_sha256 = $composeHash
      runtime_config_file = 'configs/config.yaml'
      runtime_config_sha256 = $configHash
      image_archive_file = 'images.tar'
      image_archive_sha256 = $imageArchiveHash
      rollback_evidence_file = 'rollback-drill-summary.json'
      rollback_evidence_sha256 = $summaryHash
    }
    Write-Utf8File -Path (Join-Path $checkpoint 'metadata.json') -Value "$(ConvertTo-Json $metadata -Depth 6)`n"
    Write-Output "Rollback checkpoint ready: $checkpoint"
  } catch {
    $checkpointError = $_
    if ($dockerStopped) {
      try {
        Start-CapturedDeployment -Backend $backend -Frontend $frontend -Revision $commit
      } catch {
        throw "Rollback checkpoint failed and the captured deployment could not be restarted. Original error: $checkpointError Recovery error: $_"
      }
    }
    throw $checkpointError
  }
} finally {
  Pop-Location
}
