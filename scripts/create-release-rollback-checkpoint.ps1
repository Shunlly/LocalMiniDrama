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
  Assert-NoReparsePathComponents -Path $Path -Label 'Rollback checkpoint file'
  $item = Get-Item -LiteralPath $Path
  if ($item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw "Rollback checkpoint source must be a regular file: $Path"
  }
}

function Get-HostPathComparison {
  param(
    [ValidateSet('Auto', 'Windows', 'Posix')]
    [string]$Platform = 'Auto'
  )
  if ($Platform -eq 'Auto') {
    $Platform = if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) { 'Windows' } else { 'Posix' }
  }
  if ($Platform -eq 'Windows') {
    return [System.StringComparison]::OrdinalIgnoreCase
  }
  return [System.StringComparison]::Ordinal
}

function Get-NormalizedPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [ValidateSet('Auto', 'Windows', 'Posix')][string]$Platform = 'Auto'
  )
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'A required path is empty.' }
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($fullPath)
  $comparison = Get-HostPathComparison -Platform $Platform
  if (-not $fullPath.Equals($root, $comparison)) {
    $fullPath = $fullPath.TrimEnd([char[]]@(
      [System.IO.Path]::DirectorySeparatorChar,
      [System.IO.Path]::AltDirectorySeparatorChar
    ))
  }
  return $fullPath
}

function Test-ContainerPathEqual {
  param(
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Actual
  )
  return $Expected.Equals($Actual, [System.StringComparison]::Ordinal)
}

function Test-HostPathEqual {
  param(
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Actual,
    [ValidateSet('Auto', 'Windows', 'Posix')][string]$Platform = 'Auto'
  )
  $comparison = Get-HostPathComparison -Platform $Platform
  $expectedPath = Get-NormalizedPath -Path $Expected -Platform $Platform
  $actualPath = Get-NormalizedPath -Path $Actual -Platform $Platform
  return $expectedPath.Equals($actualPath, $comparison)
}

function Assert-NoReparsePathComponents {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $normalizedPath = Get-NormalizedPath -Path $Path
  $current = [System.IO.DirectoryInfo]::new($normalizedPath)
  while ($null -ne $current) {
    $item = $null
    try {
      $item = Get-Item -LiteralPath $current.FullName -Force -ErrorAction Stop
    } catch [System.Management.Automation.ItemNotFoundException] {
      $item = $null
    }
    if ($null -ne $item) {
      $linkTypeProperty = $item.PSObject.Properties['LinkType']
      $isLink = (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) -or
        ($null -ne $linkTypeProperty -and -not [string]::IsNullOrWhiteSpace([string]$linkTypeProperty.Value))
      if ($isLink) {
        throw "$Label must not pass through a symbolic link, junction, or reparse point: $($current.FullName)"
      }
    }
    $current = $current.Parent
  }
  return $normalizedPath
}

function Assert-RealDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Label = 'Rollback data source'
  )
  $normalizedPath = Get-NormalizedPath -Path $Path
  Assert-NoReparsePathComponents -Path $normalizedPath -Label $Label | Out-Null
  $item = Get-Item -LiteralPath $normalizedPath -Force
  if (-not $item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw "$Label must be a real directory: $normalizedPath"
  }
  return Get-NormalizedPath -Path $item.FullName
}

function Assert-SamePath {
  param(
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Actual,
    [Parameter(Mandatory = $true)][string]$Label,
    [ValidateSet('Auto', 'Windows', 'Posix')][string]$Platform = 'Auto'
  )
  if (-not (Test-HostPathEqual -Expected $Expected -Actual $Actual -Platform $Platform)) {
    throw "$Label path does not match the captured data bind source."
  }
}

function Get-ContainerBindSource {
  param(
    [Parameter(Mandatory = $true)][string]$ContainerId,
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$RequireReadWrite
  )
  $mountJson = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $ContainerId, '--format', '{{json .Mounts}}') -Label "${Destination} mount capture"
  try {
    $mounts = @((ConvertFrom-Json -InputObject $mountJson) | ForEach-Object { $_ })
  } catch {
    throw "${Destination} mount capture returned invalid Docker JSON."
  }
  $destinationMounts = @($mounts | Where-Object { Test-ContainerPathEqual -Expected ([string]$_.Destination) -Actual $Destination })
  if ($destinationMounts.Count -ne 1) {
    throw "The running backend must have exactly one mount at $Destination."
  }
  $mount = $destinationMounts[0]
  if ($mount.Type -ne 'bind' -or [string]::IsNullOrWhiteSpace([string]$mount.Source)) {
    throw "The running backend mount at $Destination must be a bind mount with a host source."
  }
  if ($RequireReadWrite -and $mount.RW -ne $true) {
    throw "The running backend bind mount at $Destination must be read-write."
  }
  return Assert-RealDirectory -Path ([string]$mount.Source)
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

function Set-RuntimeConfigEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$ConfigDirectory,
    [Parameter(Mandatory = $true)][string]$ConfigPath
  )
  $env:LOCALMINIDRAMA_CONFIG_DIR = $ConfigDirectory
  $env:LOCALMINIDRAMA_CONFIG_PATH = $ConfigPath
}

function Set-DataSourceEnvironment {
  param([Parameter(Mandatory = $true)][string]$DataDirectory)
  $env:LOCALMINIDRAMA_DATA_DIR = $DataDirectory
}

function Clear-RuntimeConfigEnvironment {
  Remove-Item Env:LOCALMINIDRAMA_CONFIG_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:LOCALMINIDRAMA_CONFIG_PATH -ErrorAction SilentlyContinue
}

function Clear-DataSourceEnvironment {
  Remove-Item Env:LOCALMINIDRAMA_DATA_DIR -ErrorAction SilentlyContinue
}

function Assert-OutsideDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][string]$Candidate,
    [ValidateSet('Auto', 'Windows', 'Posix')][string]$Platform = 'Auto'
  )
  Assert-SeparateDirectories -First $Directory -Second $Candidate -Platform $Platform
}

function Assert-SeparateDirectories {
  param(
    [Parameter(Mandatory = $true)][string]$First,
    [Parameter(Mandatory = $true)][string]$Second,
    [ValidateSet('Auto', 'Windows', 'Posix')][string]$Platform = 'Auto'
  )
  $firstPath = Get-NormalizedPath -Path $First -Platform $Platform
  $secondPath = Get-NormalizedPath -Path $Second -Platform $Platform
  $comparison = Get-HostPathComparison -Platform $Platform
  $separator = [System.IO.Path]::DirectorySeparatorChar
  $firstPrefix = $firstPath.TrimEnd($separator) + $separator
  $secondPrefix = $secondPath.TrimEnd($separator) + $separator
  if ($firstPath.Equals($secondPath, $comparison) -or
      $secondPath.StartsWith($firstPrefix, $comparison) -or
      $firstPath.StartsWith($secondPrefix, $comparison)) {
    throw 'The rollback checkpoint and protected directory must be physically separate.'
  }
}

function Assert-SafeRollbackPaths {
  param(
    [Parameter(Mandatory = $true)][string]$CheckpointDirectory,
    [Parameter(Mandatory = $true)][string]$DataDirectory,
    [switch]$CheckpointMayNotExist
  )
  if ($CheckpointMayNotExist) {
    Assert-NoReparsePathComponents -Path $CheckpointDirectory -Label 'Rollback checkpoint' | Out-Null
  } else {
    Assert-RealDirectory -Path $CheckpointDirectory -Label 'Rollback checkpoint' | Out-Null
  }
  Assert-RealDirectory -Path $DataDirectory -Label 'Rollback data source' | Out-Null
  Assert-SeparateDirectories -First $CheckpointDirectory -Second $DataDirectory
}

function Assert-OutsideRepository {
  param([string]$RepositoryRoot, [string]$Candidate)
  Assert-OutsideDirectory -Directory $RepositoryRoot -Candidate $Candidate
}

function Assert-RunningBackendDataSource {
  param([Parameter(Mandatory = $true)][string]$ExpectedDataDirectory)
  $containerId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('compose', 'ps', '-q', 'backend') -Label 'Recovered backend container lookup'
  if ($containerId -notmatch '^[a-f0-9]{12,64}$') {
    throw 'The recovered backend container could not be identified for data bind verification.'
  }
  $actualDataDirectory = Get-ContainerBindSource -ContainerId $containerId -Destination '/app/data' -RequireReadWrite
  Assert-SamePath -Expected $ExpectedDataDirectory -Actual $actualDataDirectory -Label 'Recovered backend data bind'
}

function Assert-ComposeDataSource {
  param([Parameter(Mandatory = $true)][string]$ExpectedDataDirectory)
  $configJson = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('compose', 'config', '--format', 'json') -Label 'Recovery Compose data bind resolution'
  try {
    $config = ConvertFrom-Json -InputObject $configJson
    $dataMounts = @($config.services.backend.volumes | Where-Object { Test-ContainerPathEqual -Expected ([string]$_.target) -Actual '/app/data' })
  } catch {
    throw 'Recovery Compose data bind resolution returned invalid Docker JSON.'
  }
  if ($dataMounts.Count -ne 1) {
    throw 'Recovery Compose must resolve exactly one mount at /app/data.'
  }
  $dataMount = $dataMounts[0]
  if ($dataMount.type -ne 'bind' -or [string]::IsNullOrWhiteSpace([string]$dataMount.source)) {
    throw 'Recovery Compose /app/data mount must resolve to a bind source.'
  }
  $readOnlyProperty = $dataMount.PSObject.Properties['read_only']
  if ($null -ne $readOnlyProperty -and $readOnlyProperty.Value -eq $true) {
    throw 'Recovery Compose /app/data bind must be read-write.'
  }
  $composeDataDirectory = Assert-RealDirectory -Path ([string]$dataMount.source)
  Assert-SamePath -Expected $ExpectedDataDirectory -Actual $composeDataDirectory -Label 'Recovery Compose data bind'
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
    [Parameter(Mandatory = $true)][string]$Revision,
    [Parameter(Mandatory = $true)][string]$ConfigDirectory,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$DataDirectory,
    [Parameter(Mandatory = $true)][string]$CheckpointDirectory
  )
  $recoveryTag = "checkpoint-recovery-$($Revision.Substring(0, 12))"
  Assert-SafeRollbackPaths -CheckpointDirectory $CheckpointDirectory -DataDirectory $DataDirectory
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $Backend.image_id, "localminidrama-backend:$recoveryTag") -Label 'Backend recovery image tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $Frontend.image_id, "localminidrama-frontend:$recoveryTag") -Label 'Frontend recovery image tag' | Out-Null
  $env:LOCALMINIDRAMA_IMAGE_TAG = $recoveryTag
  $env:LOCALMINIDRAMA_BUILD_REVISION = $Revision
  Set-RuntimeConfigEnvironment -ConfigDirectory $ConfigDirectory -ConfigPath $ConfigPath
  Set-DataSourceEnvironment -DataDirectory $DataDirectory
  Assert-ComposeDataSource -ExpectedDataDirectory $DataDirectory
  Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'up', '-d', '--no-build', '--wait') -Label 'Captured deployment recovery' | Out-Null
  Assert-RunningBackendDataSource -ExpectedDataDirectory $DataDirectory
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$checkpoint = Get-NormalizedPath -Path $CheckpointDirectory
Assert-NoReparsePathComponents -Path $checkpoint -Label 'Rollback checkpoint' | Out-Null
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
  $runtimeDataDirectory = Get-ContainerBindSource -ContainerId $backend.container_id -Destination '/app/data' -RequireReadWrite
  Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory -CheckpointMayNotExist
  Set-DataSourceEnvironment -DataDirectory $runtimeDataDirectory
  $runtimeConfigDirectory = Get-ContainerBindSource -ContainerId $backend.container_id -Destination '/app/config-source'
  $runtimeConfigSource = Join-Path $runtimeConfigDirectory 'config.yaml'
  Assert-RegularFile -Path $runtimeConfigSource
  Set-RuntimeConfigEnvironment -ConfigDirectory $runtimeConfigDirectory -ConfigPath $runtimeConfigSource

  New-Item -ItemType Directory -Path $checkpoint | Out-Null
  Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory
  $configArchiveRoot = Join-Path $checkpoint 'configs'
  New-Item -ItemType Directory -Path $configArchiveRoot | Out-Null
  $composeArchive = Join-Path $checkpoint 'docker-compose.yml'
  $configArchive = Join-Path $configArchiveRoot 'config.yaml'
  $dataBindSourceArchive = Join-Path $checkpoint 'data-bind-source.txt'
  Copy-Item -LiteralPath (Join-Path $repoRoot 'docker-compose.yml') -Destination $composeArchive
  Write-Utf8File -Path $dataBindSourceArchive -Value "$runtimeDataDirectory`n"
  Invoke-Checked -FilePath 'node' -ArgumentList @((Join-Path $repoRoot 'scripts\runtime-config-policy.cjs'), $runtimeConfigSource, $configArchive) -Label 'Runtime config sanitization' | Out-Null
  Assert-RegularFile -Path $configArchive
  Assert-RegularFile -Path $dataBindSourceArchive
  $composeHash = (Get-FileHash -LiteralPath $composeArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $configHash = (Get-FileHash -LiteralPath $configArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $dataBindSourceHash = (Get-FileHash -LiteralPath $dataBindSourceArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $imageArchive = Join-Path $checkpoint 'images.tar'
  $rollbackTag = "rollback-checkpoint-$($commit.Substring(0, 12))"
  $backendRollbackRef = "localminidrama-backend:$rollbackTag"
  $frontendRollbackRef = "localminidrama-frontend:$rollbackTag"
  Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $backend.image_id, $backendRollbackRef) -Label 'Backend checkpoint image tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $frontend.image_id, $frontendRollbackRef) -Label 'Frontend checkpoint image tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'save', '--output', $imageArchive, $backendRollbackRef, $frontendRollbackRef) -Label 'Checkpoint image archive' | Out-Null
  $imageArchiveHash = (Get-FileHash -LiteralPath $imageArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  $backend['rollback_ref'] = $backendRollbackRef
  $frontend['rollback_ref'] = $frontendRollbackRef

  $dockerStopped = $false
  try {
    # A failed `down` may have stopped one service before reporting an error;
    # recovery must therefore be attempted for any shutdown attempt.
    $dockerStopped = $true
    Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory
    Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'down') -Label 'Docker shutdown' | Out-Null

    $backupPath = Join-Path $checkpoint 'data.zip'
    Set-RuntimeConfigEnvironment -ConfigDirectory $runtimeConfigDirectory -ConfigPath $runtimeConfigSource
    Set-DataSourceEnvironment -DataDirectory $runtimeDataDirectory
    Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory
    Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'backup:data', '--', '--output', $backupPath, '--data-root', $runtimeDataDirectory) -Label 'Data backup' | Out-Null
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
      schema = 'localminidrama.release-rollback-checkpoint.v4'
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
      runtime_config_source_file = 'configs/config.yaml'
      runtime_config_sha256 = $configHash
      runtime_config_sanitized = $true
      runtime_config_credentials_excluded = $true
      credential_reconfiguration_required = $true
      data_bind_type = 'bind'
      data_bind_destination = '/app/data'
      data_bind_read_write = $true
      data_bind_source = $runtimeDataDirectory
      data_bind_source_file = 'data-bind-source.txt'
      data_bind_source_sha256 = $dataBindSourceHash
      image_archive_file = 'images.tar'
      image_archive_sha256 = $imageArchiveHash
      rollback_evidence_file = 'rollback-drill-summary.json'
      rollback_evidence_sha256 = $summaryHash
    }
    Write-Utf8File -Path (Join-Path $checkpoint 'metadata.json') -Value "$(ConvertTo-Json $metadata -Depth 6)`n"
    Write-Output "Rollback checkpoint ready: $checkpoint"
    Write-Output 'Provider credentials were excluded from the archived runtime config and must be configured and tested again after restore.'
  } catch {
    $checkpointError = $_
    if ($dockerStopped) {
      try {
        Start-CapturedDeployment -Backend $backend -Frontend $frontend -Revision $commit -ConfigDirectory $runtimeConfigDirectory -ConfigPath $runtimeConfigSource -DataDirectory $runtimeDataDirectory -CheckpointDirectory $checkpoint
      } catch {
        throw "Rollback checkpoint failed and the captured deployment could not be restarted. Original error: $checkpointError Recovery error: $_"
      }
    }
    throw $checkpointError
  }
} finally {
  Clear-DataSourceEnvironment
  Clear-RuntimeConfigEnvironment
  Pop-Location
}
