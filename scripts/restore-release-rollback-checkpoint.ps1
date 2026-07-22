[CmdletBinding()]
param(
  [string]$CheckpointDirectory
)

. (Join-Path $PSScriptRoot 'rollback-path-identity.ps1')
. (Join-Path $PSScriptRoot 'rollback-powershell-support.ps1')

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
    throw 'The rollback checkpoint and live data directory must be physically separate.'
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

function Assert-CurrentRollbackRoot {
  param(
    [Parameter(Mandatory = $true)][string]$CheckpointDirectory,
    [Parameter(Mandatory = $true)][string]$DataDirectory,
    [Parameter(Mandatory = $true)][object]$RetainedIdentity,
    [Parameter(Mandatory = $true)][object]$MetadataIdentity,
    [Parameter(Mandatory = $true)][string]$Label
  )
  Assert-SafeRollbackPaths -CheckpointDirectory $CheckpointDirectory -DataDirectory $DataDirectory
  if ($RetainedIdentity -isnot [string] -or
      $MetadataIdentity -isnot [string] -or
      $RetainedIdentity -cnotmatch '^[a-f0-9]{8}:[a-f0-9]{16}$' -or
      $MetadataIdentity -cnotmatch '^[a-f0-9]{8}:[a-f0-9]{16}$' -or
      $RetainedIdentity -cne $MetadataIdentity) {
    throw "$Label retained root identity does not match checkpoint metadata."
  }
  $actualIdentity = Assert-RollbackPathIdentity -Path $DataDirectory -ExpectedIdentity $RetainedIdentity -Label $Label
  if ($actualIdentity -cne $MetadataIdentity) {
    throw "$Label current root identity does not match checkpoint metadata."
  }
}

function Assert-RegularFile {
  param([string]$Path)
  Assert-NoReparsePathComponents -Path $Path -Label 'Rollback checkpoint file' | Out-Null
  $item = Get-Item -LiteralPath $Path
  if ($item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw "Rollback checkpoint file must be a regular file: $Path"
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
    throw "$Label path does not match the checkpoint data bind source."
  }
}

function Assert-FileHash {
  param([string]$Path, [string]$Expected, [string]$Label)
  if ($Expected -cnotmatch '^[a-f0-9]{64}$') { throw "$Label SHA-256 is invalid." }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -cne $Expected) { throw "$Label SHA-256 verification failed." }
}

function Assert-RollbackFileAuthorityHash {
  param(
    [Parameter(Mandatory = $true)][object]$Authority,
    [Parameter(Mandatory = $true)][object]$Expected,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Expected -isnot [string] -or $Expected -cnotmatch '^[a-f0-9]{64}$') {
    throw "$Label SHA-256 is invalid."
  }
  $actual = Get-RollbackFileAuthoritySha256 -Authority $Authority
  if ($actual -cne $Expected) { throw "$Label SHA-256 verification failed." }
  return $actual
}

function Get-RollbackEvidenceProperty {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Context
  )
  if ($null -eq $Object -or $Object -is [System.Collections.IList] -or $Object -is [System.Collections.IDictionary]) {
    throw "$Context must be a JSON object."
  }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { throw "$Context.$Name is required." }
  return $property
}

function Assert-RollbackEvidenceExactString {
  param(
    [Parameter(Mandatory = $true)][AllowNull()][object]$Value,
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if ($Value -isnot [string] -or $Value -cne $Expected) { throw $Message }
}

function Assert-RollbackEvidenceJsonObject {
  param(
    [Parameter(Mandatory = $true)][AllowNull()][object]$Value,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if ($Value -isnot [pscustomobject]) { throw $Message }
}

function Assert-RollbackEvidenceStringPattern {
  param(
    [Parameter(Mandatory = $true)][AllowNull()][object]$Value,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if ($Value -isnot [string] -or $Value -cnotmatch $Pattern) { throw $Message }
}

function Assert-RollbackEvidenceBoolean {
  param(
    [Parameter(Mandatory = $true)][AllowNull()][object]$Value,
    [Parameter(Mandatory = $true)][bool]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if ($Value -isnot [bool] -or $Value -ne $Expected) { throw $Message }
}

function Assert-RollbackCheckpointMetadata {
  param([Parameter(Mandatory = $true)][object]$Metadata)

  $schemaProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'schema' -Context 'metadata'
  $versionProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'version' -Context 'metadata'
  $commitProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'previous_commit' -Context 'metadata'
  Assert-RollbackEvidenceExactString -Value $schemaProperty.Value -Expected 'localminidrama.release-rollback-checkpoint.v5' -Message 'Rollback checkpoint schema is invalid.'
  Assert-RollbackEvidenceStringPattern -Value $versionProperty.Value -Pattern '^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$' -Message 'Rollback checkpoint version is invalid.'
  Assert-RollbackEvidenceStringPattern -Value $commitProperty.Value -Pattern '^[a-f0-9]{40}$' -Message 'Rollback checkpoint commit is invalid.'

  foreach ($booleanContract in @(
    @('runtime_config_sanitized', 'Rollback checkpoint runtime config is not declared sanitized.'),
    @('runtime_config_credentials_excluded', 'Rollback checkpoint does not prove that runtime config credentials were excluded.'),
    @('credential_reconfiguration_required', 'Rollback checkpoint does not require Provider credential reconfiguration.')
  )) {
    $property = Get-RollbackEvidenceProperty -Object $Metadata -Name $booleanContract[0] -Context 'metadata'
    Assert-RollbackEvidenceBoolean -Value $property.Value -Expected $true -Message $booleanContract[1]
  }

  foreach ($digestName in @(
    'backup_sha256',
    'compose_sha256',
    'runtime_config_sha256',
    'data_bind_source_sha256',
    'image_archive_sha256',
    'rollback_evidence_sha256',
    'data_root_sha256'
  )) {
    $property = Get-RollbackEvidenceProperty -Object $Metadata -Name $digestName -Context 'metadata'
    Assert-RollbackEvidenceStringPattern -Value $property.Value -Pattern '^[a-f0-9]{64}$' -Message "Rollback checkpoint $digestName is invalid."
  }
  $identityProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'data_root_identity' -Context 'metadata'
  Assert-RollbackEvidenceStringPattern -Value $identityProperty.Value -Pattern '^[a-f0-9]{8}:[a-f0-9]{16}$' -Message 'Rollback checkpoint data root identity is invalid.'

  $bindTypeProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'data_bind_type' -Context 'metadata'
  $bindDestinationProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'data_bind_destination' -Context 'metadata'
  $bindReadWriteProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'data_bind_read_write' -Context 'metadata'
  $bindSourceProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'data_bind_source' -Context 'metadata'
  $bindSourceFileProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'data_bind_source_file' -Context 'metadata'
  Assert-RollbackEvidenceExactString -Value $bindTypeProperty.Value -Expected 'bind' -Message 'Rollback checkpoint data bind type is invalid.'
  Assert-RollbackEvidenceExactString -Value $bindDestinationProperty.Value -Expected '/app/data' -Message 'Rollback checkpoint data bind destination is invalid.'
  Assert-RollbackEvidenceBoolean -Value $bindReadWriteProperty.Value -Expected $true -Message 'Rollback checkpoint data bind must be boolean read-write.'
  Assert-RollbackEvidenceExactString -Value $bindSourceFileProperty.Value -Expected 'data-bind-source.txt' -Message 'Rollback checkpoint data bind source record is invalid.'
  if ($bindSourceProperty.Value -isnot [string] -or [string]::IsNullOrWhiteSpace($bindSourceProperty.Value)) {
    throw 'Rollback checkpoint data bind source is invalid.'
  }

  $backendProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'backend' -Context 'metadata'
  $frontendProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'frontend' -Context 'metadata'
  Assert-RollbackEvidenceJsonObject -Value $backendProperty.Value -Message 'Rollback checkpoint backend evidence must be an object.'
  Assert-RollbackEvidenceJsonObject -Value $frontendProperty.Value -Message 'Rollback checkpoint frontend evidence must be an object.'
  $rollbackTag = "rollback-checkpoint-$($commitProperty.Value.Substring(0, 12))"
  foreach ($imageContract in @(
    @('backend', $backendProperty.Value, "localminidrama-backend:$rollbackTag"),
    @('frontend', $frontendProperty.Value, "localminidrama-frontend:$rollbackTag")
  )) {
    $context = "metadata.$($imageContract[0])"
    $imageIdProperty = Get-RollbackEvidenceProperty -Object $imageContract[1] -Name 'image_id' -Context $context
    $revisionProperty = Get-RollbackEvidenceProperty -Object $imageContract[1] -Name 'revision' -Context $context
    $rollbackRefProperty = Get-RollbackEvidenceProperty -Object $imageContract[1] -Name 'rollback_ref' -Context $context
    Assert-RollbackEvidenceStringPattern -Value $imageIdProperty.Value -Pattern '^sha256:[a-f0-9]{64}$' -Message "$context image ID is invalid."
    Assert-RollbackEvidenceExactString -Value $revisionProperty.Value -Expected $commitProperty.Value -Message "$context revision does not match the recorded commit."
    Assert-RollbackEvidenceExactString -Value $rollbackRefProperty.Value -Expected $imageContract[2] -Message "$context rollback reference is invalid."
  }
}

function Assert-RollbackEvidenceBinding {
  param(
    [Parameter(Mandatory = $true)][object]$Metadata,
    [Parameter(Mandatory = $true)][object]$Summary,
    [Parameter(Mandatory = $true)][AllowNull()][object]$ActualBackupHash,
    [Parameter(Mandatory = $true)][AllowNull()][object]$ActualDataRootIdentity
  )
  $metadataSchemaProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'schema' -Context 'metadata'
  $metadataCommitProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'previous_commit' -Context 'metadata'
  $metadataVersionProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'version' -Context 'metadata'
  $metadataBackupHashProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'backup_sha256' -Context 'metadata'
  $metadataDataRootHashProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'data_root_sha256' -Context 'metadata'
  $metadataDataRootIdentityProperty = Get-RollbackEvidenceProperty -Object $Metadata -Name 'data_root_identity' -Context 'metadata'

  Assert-RollbackEvidenceExactString -Value $metadataSchemaProperty.Value -Expected 'localminidrama.release-rollback-checkpoint.v5' -Message 'Rollback checkpoint schema must be the exact v5 schema.'
  $commitPattern = '^[a-f0-9]{40}$'
  $versionPattern = '^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
  $hashPattern = '^[a-f0-9]{64}$'
  $identityPattern = '^[a-f0-9]{8}:[a-f0-9]{16}$'
  Assert-RollbackEvidenceStringPattern -Value $metadataCommitProperty.Value -Pattern $commitPattern -Message 'Rollback checkpoint commit must be a lowercase full SHA.'
  Assert-RollbackEvidenceStringPattern -Value $metadataVersionProperty.Value -Pattern $versionPattern -Message 'Rollback checkpoint version is malformed.'
  Assert-RollbackEvidenceStringPattern -Value $metadataBackupHashProperty.Value -Pattern $hashPattern -Message 'Rollback checkpoint archive digest must be lowercase SHA-256.'
  Assert-RollbackEvidenceStringPattern -Value $metadataDataRootHashProperty.Value -Pattern $hashPattern -Message 'Rollback checkpoint data root digest must be lowercase SHA-256.'
  Assert-RollbackEvidenceStringPattern -Value $metadataDataRootIdentityProperty.Value -Pattern $identityPattern -Message 'Rollback checkpoint data root identity must use the native lowercase format.'

  $summarySchemaProperty = Get-RollbackEvidenceProperty -Object $Summary -Name 'schema' -Context 'summary'
  $summaryStatusProperty = Get-RollbackEvidenceProperty -Object $Summary -Name 'status' -Context 'summary'
  $summaryInputModeProperty = Get-RollbackEvidenceProperty -Object $Summary -Name 'input_mode' -Context 'summary'
  $summarySourceProperty = Get-RollbackEvidenceProperty -Object $Summary -Name 'source' -Context 'summary'
  $summaryBackupProperty = Get-RollbackEvidenceProperty -Object $Summary -Name 'backup' -Context 'summary'
  $summaryOperationsProperty = Get-RollbackEvidenceProperty -Object $Summary -Name 'operations' -Context 'summary'
  Assert-RollbackEvidenceExactString -Value $summarySchemaProperty.Value -Expected 'localminidrama.rollback-drill.v3' -Message 'Rollback drill schema must be the exact v3 schema.'
  Assert-RollbackEvidenceExactString -Value $summaryStatusProperty.Value -Expected 'passed' -Message 'Rollback drill status must be the exact string passed.'
  Assert-RollbackEvidenceExactString -Value $summaryInputModeProperty.Value -Expected 'checkpoint-bound' -Message 'Rollback drill input mode must be checkpoint-bound.'

  $sourceCommitProperty = Get-RollbackEvidenceProperty -Object $summarySourceProperty.Value -Name 'commit' -Context 'summary.source'
  $sourceVersionProperty = Get-RollbackEvidenceProperty -Object $summarySourceProperty.Value -Name 'version' -Context 'summary.source'
  $sourceWorkingTreeDirtyProperty = Get-RollbackEvidenceProperty -Object $summarySourceProperty.Value -Name 'working_tree_dirty' -Context 'summary.source'
  $sourceDataRootHashProperty = Get-RollbackEvidenceProperty -Object $summarySourceProperty.Value -Name 'data_root_sha256' -Context 'summary.source'
  Assert-RollbackEvidenceStringPattern -Value $sourceCommitProperty.Value -Pattern $commitPattern -Message 'Rollback drill source commit must be a lowercase full SHA.'
  Assert-RollbackEvidenceExactString -Value $sourceCommitProperty.Value -Expected $metadataCommitProperty.Value -Message 'Rollback drill commit does not match checkpoint metadata.'
  Assert-RollbackEvidenceStringPattern -Value $sourceVersionProperty.Value -Pattern $versionPattern -Message 'Rollback drill source version is malformed.'
  Assert-RollbackEvidenceExactString -Value $sourceVersionProperty.Value -Expected $metadataVersionProperty.Value -Message 'Rollback drill version does not match checkpoint metadata.'
  Assert-RollbackEvidenceBoolean -Value $sourceWorkingTreeDirtyProperty.Value -Expected $false -Message 'Rollback drill working tree evidence must be boolean false.'
  Assert-RollbackEvidenceStringPattern -Value $sourceDataRootHashProperty.Value -Pattern $hashPattern -Message 'Rollback drill data root digest must be lowercase SHA-256.'
  if ($sourceDataRootHashProperty.Value -cne $metadataDataRootHashProperty.Value) {
    throw 'Rollback drill and checkpoint data root digests do not match.'
  }

  $archiveRetainedProperty = Get-RollbackEvidenceProperty -Object $summaryBackupProperty.Value -Name 'archive_retained' -Context 'summary.backup'
  $summaryBackupHashProperty = Get-RollbackEvidenceProperty -Object $summaryBackupProperty.Value -Name 'archive_sha256' -Context 'summary.backup'
  Assert-RollbackEvidenceBoolean -Value $archiveRetainedProperty.Value -Expected $true -Message 'Rollback drill archive retention evidence must be boolean true.'
  Assert-RollbackEvidenceStringPattern -Value $summaryBackupHashProperty.Value -Pattern $hashPattern -Message 'Rollback drill archive digest must be lowercase SHA-256.'
  Assert-RollbackEvidenceStringPattern -Value $ActualBackupHash -Pattern $hashPattern -Message 'Current rollback archive digest must be lowercase SHA-256.'
  if ($summaryBackupHashProperty.Value -cne $metadataBackupHashProperty.Value -or
      $summaryBackupHashProperty.Value -cne $ActualBackupHash) {
    throw 'Rollback drill, checkpoint, and current archive digests must match.'
  }

  $sourceDataRootUnchangedProperty = Get-RollbackEvidenceProperty -Object $summaryOperationsProperty.Value -Name 'source_data_root_unchanged' -Context 'summary.operations'
  Assert-RollbackEvidenceBoolean -Value $sourceDataRootUnchangedProperty.Value -Expected $true -Message 'Rollback drill root retention evidence must be boolean true.'
  Assert-RollbackEvidenceStringPattern -Value $ActualDataRootIdentity -Pattern $identityPattern -Message 'Current rollback data root identity must use the native lowercase format.'
  if ($metadataDataRootIdentityProperty.Value -cne $ActualDataRootIdentity) {
    throw 'Current rollback data root identity does not match checkpoint metadata.'
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
  $validatedMounts = @($mounts | ForEach-Object {
    Assert-RollbackEvidenceJsonObject -Value $_ -Message "${Destination} mount capture entries must be objects."
    $typeProperty = Get-RollbackEvidenceProperty -Object $_ -Name 'Type' -Context "${Destination} mount capture entry"
    $sourceProperty = Get-RollbackEvidenceProperty -Object $_ -Name 'Source' -Context "${Destination} mount capture entry"
    $destinationProperty = Get-RollbackEvidenceProperty -Object $_ -Name 'Destination' -Context "${Destination} mount capture entry"
    $readWriteProperty = Get-RollbackEvidenceProperty -Object $_ -Name 'RW' -Context "${Destination} mount capture entry"
    if ($typeProperty.Value -isnot [string] -or
        $sourceProperty.Value -isnot [string] -or
        [string]::IsNullOrWhiteSpace($sourceProperty.Value) -or
        $destinationProperty.Value -isnot [string] -or
        $readWriteProperty.Value -isnot [bool]) {
      throw "${Destination} mount capture fields have invalid JSON types."
    }
    [pscustomobject][ordered]@{
      Type = $typeProperty.Value
      Source = $sourceProperty.Value
      Destination = $destinationProperty.Value
      RW = $readWriteProperty.Value
    }
  })
  $destinationMounts = @($validatedMounts | Where-Object {
    Test-ContainerPathEqual -Expected $_.Destination -Actual $Destination
  })
  if ($destinationMounts.Count -ne 1) {
    throw "The running backend must have exactly one mount at $Destination."
  }
  $mount = $destinationMounts[0]
  if ($mount.Type -cne 'bind') {
    throw "The running backend mount at $Destination must be a bind mount with a host source."
  }
  if ($RequireReadWrite -and $mount.RW -ne $true) {
    throw "The running backend bind mount at $Destination must be read-write."
  }
  return Assert-RealDirectory -Path $mount.Source
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
  Assert-RollbackEvidenceJsonObject -Value $labels -Message "$Label returned invalid Docker labels JSON."
  $property = Get-RollbackEvidenceProperty -Object $labels -Name 'org.opencontainers.image.revision' -Context $Label
  Assert-RollbackEvidenceStringPattern -Value $property.Value -Pattern '^[a-f0-9]{40}$' -Message "$Label did not contain an exact lowercase revision."
  return $property.Value
}

function Get-RunningServiceEvidence {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [Parameter(Mandatory = $true)][string[]]$ComposePrefix
  )
  $containerId = Get-CheckedScalar -FilePath 'docker' -ArgumentList (@($ComposePrefix) + @('ps', '-a', '-q', $Service)) -Label "$Service container lookup"
  if ($containerId -cnotmatch '^[a-f0-9]{12,64}$') {
    throw "The current $Service container must still exist before rollback so immutable compensation evidence can be captured."
  }
  $status = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.State.Status}}') -Label "$Service container status"
  $health = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}') -Label "$Service container health"
  if ($status -cne 'running' -or $health -cne 'healthy') {
    Write-Warning "The current $Service container is $status with health $health; rollback will continue using its immutable image and configuration evidence."
  }
  $imageId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.Image}}') -Label "$Service image capture"
  $revision = Get-ImageRevision -ImageReference $imageId -Label "$Service image revision"
  if ($imageId -cnotmatch '^sha256:[a-f0-9]{64}$' -or $revision -cnotmatch '^[a-f0-9]{40}$') {
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

function Assert-RunningBackendDataSource {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedDataDirectory,
    [Parameter(Mandatory = $true)][string[]]$ComposePrefix,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$CheckpointDirectory,
    [Parameter(Mandatory = $true)][object]$RetainedDataRootIdentity,
    [Parameter(Mandatory = $true)][object]$MetadataDataRootIdentity
  )
  $arguments = @($ComposePrefix) + @('ps', '-q', 'backend')
  $containerId = Get-CheckedScalar -FilePath 'docker' -ArgumentList $arguments -Label "$Label container lookup"
  if ($containerId -cnotmatch '^[a-f0-9]{12,64}$') {
    throw "$Label container could not be identified for data bind verification."
  }
  $actualDataDirectory = Get-ContainerBindSource -ContainerId $containerId -Destination '/app/data' -RequireReadWrite
  Assert-SamePath -Expected $ExpectedDataDirectory -Actual $actualDataDirectory -Label "$Label data bind"
  Assert-CurrentRollbackRoot -CheckpointDirectory $CheckpointDirectory -DataDirectory $actualDataDirectory -RetainedIdentity $RetainedDataRootIdentity -MetadataIdentity $MetadataDataRootIdentity -Label "$Label data root"
}

function Assert-ComposeDataSource {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedDataDirectory,
    [Parameter(Mandatory = $true)][string[]]$ComposePrefix,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $arguments = @($ComposePrefix) + @('config', '--format', 'json')
  $configJson = Get-CheckedScalar -FilePath 'docker' -ArgumentList $arguments -Label "$Label data bind resolution"
  try {
    $config = ConvertFrom-Json -InputObject $configJson
  } catch {
    throw "$Label data bind resolution returned invalid Docker JSON."
  }
  Assert-RollbackEvidenceJsonObject -Value $config -Message "$Label data bind resolution must be a JSON object."
  $servicesProperty = Get-RollbackEvidenceProperty -Object $config -Name 'services' -Context "$Label Compose config"
  Assert-RollbackEvidenceJsonObject -Value $servicesProperty.Value -Message "$Label Compose services must be an object."
  $backendProperty = Get-RollbackEvidenceProperty -Object $servicesProperty.Value -Name 'backend' -Context "$Label Compose services"
  Assert-RollbackEvidenceJsonObject -Value $backendProperty.Value -Message "$Label Compose backend must be an object."
  $volumesProperty = Get-RollbackEvidenceProperty -Object $backendProperty.Value -Name 'volumes' -Context "$Label Compose backend"
  if ($volumesProperty.Value -isnot [System.Collections.IList]) {
    throw "$Label Compose backend volumes must be an array."
  }
  $validatedMounts = @($volumesProperty.Value | ForEach-Object {
    Assert-RollbackEvidenceJsonObject -Value $_ -Message "$Label Compose volume entries must be objects."
    $typeProperty = Get-RollbackEvidenceProperty -Object $_ -Name 'type' -Context "$Label Compose volume"
    $sourceProperty = Get-RollbackEvidenceProperty -Object $_ -Name 'source' -Context "$Label Compose volume"
    $targetProperty = Get-RollbackEvidenceProperty -Object $_ -Name 'target' -Context "$Label Compose volume"
    if ($typeProperty.Value -isnot [string] -or
        $sourceProperty.Value -isnot [string] -or
        [string]::IsNullOrWhiteSpace($sourceProperty.Value) -or
        $targetProperty.Value -isnot [string]) {
      throw "$Label Compose volume fields have invalid JSON types."
    }
    $readOnly = $false
    $readOnlyProperty = $_.PSObject.Properties['read_only']
    if ($null -ne $readOnlyProperty) {
      if ($readOnlyProperty.Value -isnot [bool]) {
        throw "$Label Compose volume read_only must be a Boolean."
      }
      $readOnly = $readOnlyProperty.Value
    }
    [pscustomobject][ordered]@{
      type = $typeProperty.Value
      source = $sourceProperty.Value
      target = $targetProperty.Value
      read_only = $readOnly
    }
  })
  $dataMounts = @($validatedMounts | Where-Object {
    Test-ContainerPathEqual -Expected $_.target -Actual '/app/data'
  })
  if ($dataMounts.Count -ne 1) {
    throw "$Label must resolve exactly one mount at /app/data."
  }
  $dataMount = $dataMounts[0]
  if ($dataMount.type -cne 'bind') {
    throw "$Label /app/data mount must resolve to a bind source."
  }
  if ($dataMount.read_only -eq $true) {
    throw "$Label /app/data bind must be read-write."
  }
  $composeDataDirectory = Assert-RealDirectory -Path $dataMount.source
  Assert-SamePath -Expected $ExpectedDataDirectory -Actual $composeDataDirectory -Label "$Label data bind"
}

function Test-ApplicationHealth {
  foreach ($url in @('http://127.0.0.1:5679/health', 'http://127.0.0.1:5679/ready', 'http://127.0.0.1:3013/')) {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 15
    if ($response.StatusCode -ne 200) { throw "Application health check failed: $url" }
  }
}

function Invoke-ReleaseRollbackCheckpointRestore {
param([Parameter(Mandatory = $true)][string]$CheckpointDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$checkpointIdentityLock = $null
$configDirectoryIdentityLock = $null
$metadataAuthority = $null
$backupAuthority = $null
$hashAuthority = $null
$composeAuthority = $null
$configAuthority = $null
$dataBindSourceAuthority = $null
$imageArchiveAuthority = $null
$summaryAuthority = $null
$rootIdentityLock = $null
$compensationDirectoryLock = $null
$compensationBackupAuthority = $null
$locationPushed = $false
$primaryError = $null
$cleanupErrors = [System.Collections.ArrayList]::new()
try {
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$checkpoint = Assert-RealDirectory -Path $CheckpointDirectory -Label 'Rollback checkpoint'
$checkpointIdentityLock = Open-RollbackDirectoryIdentityLock -Path $checkpoint -Label 'Rollback checkpoint'
$configDirectory = Join-Path $checkpoint 'configs'
$metadataPath = Join-Path $checkpoint 'metadata.json'
$backupPath = Join-Path $checkpoint 'data.zip'
$hashPath = Join-Path $checkpoint 'data.sha256.txt'
$composePath = Join-Path $checkpoint 'docker-compose.yml'
$configPath = Join-Path $configDirectory 'config.yaml'
$dataBindSourcePath = Join-Path $checkpoint 'data-bind-source.txt'
$imageArchivePath = Join-Path $checkpoint 'images.tar'
$summaryPath = Join-Path $checkpoint 'rollback-drill-summary.json'
$configDirectoryIdentityLock = Open-RollbackDirectoryIdentityLock -Path $configDirectory -Label 'Rollback checkpoint config directory'
$metadataAuthority = Open-RollbackFileAuthority -Path $metadataPath -Label 'Rollback checkpoint metadata'
$backupAuthority = Open-RollbackFileAuthority -Path $backupPath -Label 'Rollback data backup'
$hashAuthority = Open-RollbackFileAuthority -Path $hashPath -Label 'Rollback data backup hash'
$composeAuthority = Open-RollbackFileAuthority -Path $composePath -Label 'Archived Compose file'
$configAuthority = Open-RollbackFileAuthority -Path $configPath -Label 'Archived runtime config'
$dataBindSourceAuthority = Open-RollbackFileAuthority -Path $dataBindSourcePath -Label 'Archived data bind source'
$imageArchiveAuthority = Open-RollbackFileAuthority -Path $imageArchivePath -Label 'Archived Docker images'
$summaryAuthority = Open-RollbackFileAuthority -Path $summaryPath -Label 'Rollback drill evidence'

$metadata = Read-StrictRollbackJson -Authority $metadataAuthority -Label 'Rollback checkpoint metadata'
Assert-RollbackCheckpointMetadata -Metadata $metadata
$rollbackTag = "rollback-checkpoint-$($metadata.previous_commit.Substring(0, 12))"
$expectedBackendRef = "localminidrama-backend:$rollbackTag"
$expectedFrontendRef = "localminidrama-frontend:$rollbackTag"

$expectedBackupHash = (Read-RollbackFileAuthorityUtf8 -Authority $hashAuthority).Trim()
if ($expectedBackupHash -cnotmatch '^[a-f0-9]{64}$') { throw 'Rollback backup hash record is invalid.' }
if ($metadata.backup_sha256 -cne $expectedBackupHash) { throw 'Rollback backup hash records disagree.' }
Assert-RollbackFileAuthorityHash -Authority $composeAuthority -Expected $metadata.compose_sha256 -Label 'Archived Compose file' | Out-Null
Assert-RollbackFileAuthorityHash -Authority $configAuthority -Expected $metadata.runtime_config_sha256 -Label 'Archived runtime config' | Out-Null
Assert-RollbackFileAuthorityHash -Authority $dataBindSourceAuthority -Expected $metadata.data_bind_source_sha256 -Label 'Archived data bind source' | Out-Null
Assert-RollbackFileAuthorityHash -Authority $imageArchiveAuthority -Expected $metadata.image_archive_sha256 -Label 'Archived Docker images' | Out-Null
Assert-RollbackFileAuthorityHash -Authority $summaryAuthority -Expected $metadata.rollback_evidence_sha256 -Label 'Rollback drill evidence' | Out-Null

$recordedDataBindSourceText = Read-RollbackFileAuthorityUtf8 -Authority $dataBindSourceAuthority
$recordedDataBindSource = $recordedDataBindSourceText.TrimEnd([char[]]@("`r", "`n"))
if ([string]::IsNullOrWhiteSpace($recordedDataBindSource) -or
    $recordedDataBindSource.Contains("`r") -or
    $recordedDataBindSource.Contains("`n")) {
  throw 'Archived data bind source must contain exactly one path.'
}
$recordedDataBindSource = Assert-RealDirectory -Path $recordedDataBindSource -Label 'Rollback checkpoint data bind source'
if ($metadata.data_bind_source -cne $recordedDataBindSource) {
  throw 'Rollback checkpoint data bind source record does not match exactly.'
}
Assert-SamePath -Expected $metadata.data_bind_source -Actual $recordedDataBindSource -Label 'Rollback checkpoint data bind source record'
Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $recordedDataBindSource

$summary = Read-StrictRollbackJson -Authority $summaryAuthority -Label 'Rollback drill evidence'
$currentComposePrefix = [string[]]@('compose', '--project-directory', $repoRoot)
$currentBackend = Get-RunningServiceEvidence -Service 'backend' -ComposePrefix $currentComposePrefix
$currentFrontend = Get-RunningServiceEvidence -Service 'frontend' -ComposePrefix $currentComposePrefix
  if ($currentBackend.revision -cne $currentFrontend.revision) {
    throw 'Current backend and frontend image revisions do not match; rollback compensation would be ambiguous.'
  }
  $forwardDataDirectory = Get-ContainerBindSource -ContainerId $currentBackend.container_id -Destination '/app/data' -RequireReadWrite
  Assert-SamePath -Expected $recordedDataBindSource -Actual $forwardDataDirectory -Label 'Current backend data bind'
  Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory
  $forwardConfigDirectory = Get-ContainerBindSource -ContainerId $currentBackend.container_id -Destination '/app/config-source'
  $forwardConfigPath = Join-Path $forwardConfigDirectory 'config.yaml'
  Assert-RegularFile -Path $forwardConfigPath

  $rootIdentityLock = Open-RollbackDirectoryIdentityLock -Path $forwardDataDirectory
  $retainedDataRootIdentity = Get-RollbackPathIdentity -Handle $rootIdentityLock
  $actualDataRootIdentity = Assert-RollbackPathIdentity -Path $forwardDataDirectory -ExpectedIdentity $retainedDataRootIdentity -Label 'Rollback data root evidence gate'
  $actualBackupHash = Assert-RollbackFileAuthorityHash -Authority $backupAuthority -Expected $expectedBackupHash -Label 'Rollback data backup'
  Assert-RollbackEvidenceBinding -Metadata $metadata -Summary $summary -ActualBackupHash $actualBackupHash -ActualDataRootIdentity $actualDataRootIdentity
  Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback evidence gate'

  Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
  Set-RuntimeConfigEnvironment -ConfigDirectory $configDirectory -ConfigPath $configPath
  Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
  $env:LOCALMINIDRAMA_IMAGE_TAG = $rollbackTag
  $env:LOCALMINIDRAMA_BUILD_REVISION = $metadata.previous_commit
  Assert-RollbackFileAuthority -Authority $composeAuthority | Out-Null
  Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
  Assert-ComposeDataSource -ExpectedDataDirectory $forwardDataDirectory -ComposePrefix ([string[]]@('compose', '--project-directory', $repoRoot, '-f', $composePath)) -Label 'Archived rollback Compose'
  Assert-RollbackFileAuthority -Authority $composeAuthority | Out-Null
  Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', '--project-directory', $repoRoot, '-f', $composePath, 'config', '--quiet') -Label 'Archived Docker Compose validation' | Out-Null

  Push-Location $repoRoot
  $locationPushed = $true
  Write-Warning 'Archived runtime config excludes Provider credentials. After rollback, configure credentials and test again before using AI generation.'

  Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before image load'
  Assert-RollbackFileAuthority -Authority $imageArchiveAuthority | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'load', '--input', $imageArchivePath) -Label 'Rollback image archive load' | Out-Null
  $loadedBackendId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $expectedBackendRef, '--format', '{{.Id}}') -Label 'Backend rollback image load verification'
  $loadedFrontendId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $expectedFrontendRef, '--format', '{{.Id}}') -Label 'Frontend rollback image load verification'
  if ($loadedBackendId -cnotmatch '^sha256:[a-f0-9]{64}$' -or
      $loadedFrontendId -cnotmatch '^sha256:[a-f0-9]{64}$' -or
      $loadedBackendId -cne $metadata.backend.image_id -or
      $loadedFrontendId -cne $metadata.frontend.image_id) {
    throw 'Loaded rollback image IDs do not match the checkpoint.'
  }
  $backendRevision = Get-ImageRevision -ImageReference $expectedBackendRef -Label 'Backend rollback image verification'
  $frontendRevision = Get-ImageRevision -ImageReference $expectedFrontendRef -Label 'Frontend rollback image verification'
  if ($backendRevision -cne $metadata.previous_commit -or $frontendRevision -cne $metadata.previous_commit) {
    throw 'Rollback image labels do not match the checkpoint commit.'
  }

  $forwardTag = "rollback-forward-$($currentBackend.revision.Substring(0, 12))"
  Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before backend compensation tag'
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $currentBackend.image_id, "localminidrama-backend:$forwardTag") -Label 'Current backend compensation tag' | Out-Null
  Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before frontend compensation tag'
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $currentFrontend.image_id, "localminidrama-frontend:$forwardTag") -Label 'Current frontend compensation tag' | Out-Null

  Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before compensation publication'
  $compensationRoot = Join-Path $checkpoint ("compensation-" + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + "-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $compensationRoot | Out-Null
  $compensationDirectoryLock = Open-RollbackDirectoryIdentityLock -Path $compensationRoot -Label 'Rollback compensation directory'
  $probePath = Join-Path $compensationRoot '.write-probe'
  Write-Utf8File -Path $probePath -Value "probe`n"
  Remove-Item -LiteralPath $probePath
  $compensationDataBindSourcePath = Join-Path $compensationRoot 'data-bind-source.txt'
  Assert-RollbackFileAuthority -Authority $dataBindSourceAuthority | Out-Null
  Copy-Item -LiteralPath $dataBindSourcePath -Destination $compensationDataBindSourcePath
  Assert-RegularFile -Path $compensationDataBindSourcePath
  Assert-FileHash -Path $compensationDataBindSourcePath -Expected $metadata.data_bind_source_sha256 -Label 'Compensation data bind source'

  $compensationBackup = Join-Path $compensationRoot 'data.zip'
  $compensationHash = $null
  $preRollbackError = $null
  try {
    Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
    Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
    Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before current shutdown'
    Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'down') -Label 'Current Docker shutdown' | Out-Null
    Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
    Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
    Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before compensation backup'
    Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'backup:data', '--', '--output', $compensationBackup, '--data-root', $forwardDataDirectory) -Label 'Pre-rollback compensation backup' | Out-Null
    $compensationBackupAuthority = Open-RollbackFileAuthority -Path $compensationBackup -Label 'Pre-rollback compensation backup'
    $compensationHash = Get-RollbackFileAuthoritySha256 -Authority $compensationBackupAuthority
    Write-Utf8File -Path (Join-Path $compensationRoot 'data.sha256.txt') -Value "$compensationHash`n"
    $compensationMetadata = [ordered]@{
      schema = 'localminidrama.rollback-compensation.v2'
      created_at = [DateTime]::UtcNow.ToString('o')
      forward_revision = $currentBackend.revision
      backup_file = 'data.zip'
      backup_sha256 = $compensationHash
      data_bind_type = 'bind'
      data_bind_destination = '/app/data'
      data_bind_read_write = $true
      data_bind_source = $forwardDataDirectory
      data_bind_source_file = 'data-bind-source.txt'
      data_bind_source_sha256 = $metadata.data_bind_source_sha256
      credentials_excluded = $true
    }
    Write-Utf8File -Path (Join-Path $compensationRoot 'metadata.json') -Value "$(ConvertTo-Json $compensationMetadata -Depth 4)`n"

    Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
    Set-RuntimeConfigEnvironment -ConfigDirectory $configDirectory -ConfigPath $configPath
    Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
    Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before rollback restore'
    Assert-RollbackFileAuthority -Authority $backupAuthority | Out-Null
    Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
    Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'restore:data', '--', '--input', $backupPath, '--yes', '--data-root', $forwardDataDirectory) -Label 'Rollback data restore' | Out-Null
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
      Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
      Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before preparation shutdown'
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'down') -Label 'Failed rollback preparation shutdown' | Out-Null
      if ($null -ne $compensationBackupAuthority -and $compensationHash) {
        Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
        Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
        Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before preparation compensation restore'
        Assert-RollbackFileAuthorityHash -Authority $compensationBackupAuthority -Expected $compensationHash -Label 'Preparation compensation data backup' | Out-Null
        Assert-RollbackFileAuthority -Authority $compensationBackupAuthority | Out-Null
        Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'restore:data', '--', '--input', $compensationBackupAuthority.Path, '--yes', '--data-root', $forwardDataDirectory) -Label 'Preparation compensation data restore' | Out-Null
      }
      $env:LOCALMINIDRAMA_IMAGE_TAG = $forwardTag
      $env:LOCALMINIDRAMA_BUILD_REVISION = $currentBackend.revision
      Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
      Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
      Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before preparation forward Compose'
      Assert-ComposeDataSource -ExpectedDataDirectory $forwardDataDirectory -ComposePrefix ([string[]]@('compose')) -Label 'Preparation forward Compose'
      Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before preparation forward startup'
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'up', '-d', '--no-build', '--wait') -Label 'Preparation forward deployment recovery' | Out-Null
      Assert-RunningBackendDataSource -ExpectedDataDirectory $forwardDataDirectory -ComposePrefix ([string[]]@('compose')) -Label 'Preparation forward backend' -CheckpointDirectory $checkpoint -RetainedDataRootIdentity $retainedDataRootIdentity -MetadataDataRootIdentity $metadata.data_root_identity
      Test-ApplicationHealth
    } catch {
      $preRollbackCompensationError = $_
    }
    if ($preRollbackCompensationError) {
      try {
        Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
        Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
        Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before preparation terminal shutdown'
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
    Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
    Set-RuntimeConfigEnvironment -ConfigDirectory $configDirectory -ConfigPath $configPath
    Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
    Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before rollback Compose'
    Assert-RollbackFileAuthority -Authority $composeAuthority | Out-Null
    Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
    Assert-ComposeDataSource -ExpectedDataDirectory $forwardDataDirectory -ComposePrefix ([string[]]@('compose', '--project-directory', $repoRoot, '-f', $composePath)) -Label 'Rollback Compose'
    Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before rollback startup'
    Assert-RollbackFileAuthority -Authority $composeAuthority | Out-Null
    Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
    Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', '--project-directory', $repoRoot, '-f', $composePath, 'up', '-d', '--no-build', '--wait') -Label 'Rollback container startup' | Out-Null
    Assert-RollbackFileAuthority -Authority $composeAuthority | Out-Null
    Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
    Assert-RunningBackendDataSource -ExpectedDataDirectory $forwardDataDirectory -ComposePrefix ([string[]]@('compose', '--project-directory', $repoRoot, '-f', $composePath)) -Label 'Rollback backend' -CheckpointDirectory $checkpoint -RetainedDataRootIdentity $retainedDataRootIdentity -MetadataDataRootIdentity $metadata.data_root_identity
    Test-ApplicationHealth
  } catch {
    $rollbackStartError = $_
  }

  if ($rollbackStartError) {
    $rollbackShutdownError = $null
    $compensationError = $null
    $compensationShutdownError = $null
    try {
      Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
      Set-RuntimeConfigEnvironment -ConfigDirectory $configDirectory -ConfigPath $configPath
      Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
      Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before failed rollback shutdown'
      Assert-RollbackFileAuthority -Authority $composeAuthority | Out-Null
      Assert-RollbackFileAuthority -Authority $configAuthority | Out-Null
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', '--project-directory', $repoRoot, '-f', $composePath, 'down') -Label 'Failed rollback shutdown' | Out-Null
    } catch {
      $rollbackShutdownError = $_
    }
    try {
      Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
      Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
      Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before compensation restore'
      Assert-RollbackFileAuthorityHash -Authority $compensationBackupAuthority -Expected $compensationHash -Label 'Compensation data backup' | Out-Null
      Assert-RollbackFileAuthority -Authority $compensationBackupAuthority | Out-Null
      Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'restore:data', '--', '--input', $compensationBackupAuthority.Path, '--yes', '--data-root', $forwardDataDirectory) -Label 'Compensation data restore' | Out-Null
      $env:LOCALMINIDRAMA_IMAGE_TAG = $forwardTag
      $env:LOCALMINIDRAMA_BUILD_REVISION = $currentBackend.revision
      Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
      Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
      Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before forward Compose'
      Assert-ComposeDataSource -ExpectedDataDirectory $forwardDataDirectory -ComposePrefix ([string[]]@('compose')) -Label 'Forward Compose'
      Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before forward startup'
      Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'up', '-d', '--no-build', '--wait') -Label 'Forward deployment recovery' | Out-Null
      Assert-RunningBackendDataSource -ExpectedDataDirectory $forwardDataDirectory -ComposePrefix ([string[]]@('compose')) -Label 'Forward backend' -CheckpointDirectory $checkpoint -RetainedDataRootIdentity $retainedDataRootIdentity -MetadataDataRootIdentity $metadata.data_root_identity
      Test-ApplicationHealth
    } catch {
      $compensationError = $_
    }
    if ($compensationError) {
      try {
        Set-RuntimeConfigEnvironment -ConfigDirectory $forwardConfigDirectory -ConfigPath $forwardConfigPath
        Set-DataSourceEnvironment -DataDirectory $forwardDataDirectory
        Assert-CurrentRollbackRoot -CheckpointDirectory $checkpoint -DataDirectory $forwardDataDirectory -RetainedIdentity $retainedDataRootIdentity -MetadataIdentity $metadata.data_root_identity -Label 'Rollback data root before compensation terminal shutdown'
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

  Write-Output "Rollback started from commit $($metadata.previous_commit) with tag $rollbackTag."
  Write-Output "Pre-rollback compensation backup retained at $compensationRoot."
  Write-Output 'Provider credentials are excluded from the checkpoint and data backups; configure credentials and test again before using AI generation.'
} catch {
  $primaryError = $_
} finally {
  try {
    if ($null -ne $compensationBackupAuthority) { $compensationBackupAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $compensationDirectoryLock) { $compensationDirectoryLock.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $rootIdentityLock) { $rootIdentityLock.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $summaryAuthority) { $summaryAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $imageArchiveAuthority) { $imageArchiveAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $dataBindSourceAuthority) { $dataBindSourceAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $configAuthority) { $configAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $composeAuthority) { $composeAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $hashAuthority) { $hashAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $backupAuthority) { $backupAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $metadataAuthority) { $metadataAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $configDirectoryIdentityLock) { $configDirectoryIdentityLock.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $checkpointIdentityLock) { $checkpointIdentityLock.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    Clear-DataSourceEnvironment
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    Clear-RuntimeConfigEnvironment
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($locationPushed) { Pop-Location }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
}
Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
}

if ($MyInvocation.InvocationName -ne '.') {
  if ([string]::IsNullOrWhiteSpace($CheckpointDirectory)) {
    throw 'CheckpointDirectory is required.'
  }
  Invoke-ReleaseRollbackCheckpointRestore -CheckpointDirectory $CheckpointDirectory
}
