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

function Confirm-RollbackContainerBindAuthority {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$ContainerId,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$HostDirectory,
    [Parameter(Mandatory = $true)]
    [Microsoft.Win32.SafeHandles.SafeFileHandle]$DirectoryHandle
  )
  $markerName = ".localminidrama-bind-proof-$([Guid]::NewGuid().ToString('N')).tmp"
  $markerPath = Join-Path $HostDirectory $markerName
  $containerMarkerPath = "$($Destination.TrimEnd('/'))/$markerName"
  $reader = "const fs=require('node:fs');const actual=fs.readFileSync(process.argv[1]);const expected=Buffer.from(process.argv[2],'hex');if(expected.length!==32)process.exit(51);if(actual.length!==expected.length)process.exit(52);if(!actual.equals(expected))process.exit(53);"
  $markerStream = $null
  $markerOwned = $false
  $randomNumberGenerator = $null
  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  try {
    $retainedIdentity = Get-RollbackPathIdentity -Handle $DirectoryHandle
    Assert-RollbackPathIdentity -Path $HostDirectory -ExpectedIdentity $retainedIdentity -Label 'Rollback data root retained container bind proof' | Out-Null

    $randomBytes = [byte[]]::new(32)
    $randomNumberGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $randomNumberGenerator.GetBytes($randomBytes)
    $randomNumberGenerator.Dispose()
    $randomNumberGenerator = $null
    $expectedHex = ([BitConverter]::ToString($randomBytes)).Replace('-', '').ToLowerInvariant()

    $markerStream = [System.IO.FileStream]::new(
      $markerPath,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::Read
    )
    $markerOwned = $true
    $markerStream.Write($randomBytes, 0, $randomBytes.Length)
    $markerStream.Flush($true)

    $proofError = $null
    for ($attempt = 1; $attempt -le 3; $attempt += 1) {
      try {
        Invoke-Checked -FilePath 'docker' -ArgumentList @('exec', $ContainerId, 'node', '-e', $reader, '--', $containerMarkerPath, $expectedHex) -Label 'Running container data bind byte proof' | Out-Null
        $proofError = $null
        break
      } catch {
        $proofError = $_
        if ($attempt -lt 3) { Start-Sleep -Milliseconds 100 }
      }
    }
    if ($null -ne $proofError) {
      $primaryError = $proofError
    }

    if ($null -eq $primaryError) {
      $containerJson = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $ContainerId, '--format', '{{json .}}') -Label 'Running container data bind reinspection'
      try {
        $container = ConvertFrom-Json -InputObject $containerJson
      } catch {
        throw 'Running container data bind reinspection returned invalid Docker JSON.'
      }
      $idProperty = $container.PSObject.Properties['Id']
      if ($null -eq $idProperty -or $idProperty.Value -isnot [string] -or $idProperty.Value -cne $ContainerId) {
        throw 'Running container data bind reinspection no longer represents the captured container.'
      }
      $mountsProperty = $container.PSObject.Properties['Mounts']
      if ($null -eq $mountsProperty) {
        throw 'Running container data bind reinspection did not contain mounts.'
      }
      $mounts = @($mountsProperty.Value | ForEach-Object { $_ })
      $destinationMounts = @($mounts | Where-Object { Test-ContainerPathEqual -Expected ([string]$_.Destination) -Actual $Destination })
      if ($destinationMounts.Count -ne 1) {
        throw "The captured container must still have exactly one mount at $Destination."
      }
      $mount = $destinationMounts[0]
      if ($mount.Type -cne 'bind' -or [string]::IsNullOrWhiteSpace([string]$mount.Source)) {
        throw "The captured container mount at $Destination must remain a bind mount with a host source."
      }
      if ($mount.RW -isnot [bool] -or $mount.RW -ne $true) {
        throw "The captured container bind mount at $Destination must remain read-write."
      }
      $reinspectedSource = Assert-RealDirectory -Path ([string]$mount.Source)
      Assert-SamePath -Expected $HostDirectory -Actual $reinspectedSource -Label 'Captured container data bind reinspection'
      Assert-RollbackPathIdentity -Path $HostDirectory -ExpectedIdentity $retainedIdentity -Label 'Rollback data root retained container bind proof' | Out-Null
    }
  } catch {
    $primaryError = $_
  } finally {
    try {
      if ($null -ne $randomNumberGenerator) { $randomNumberGenerator.Dispose() }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
    try {
      if ($null -ne $markerStream) { $markerStream.Dispose() }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
    try {
      if ($markerOwned -and (Test-Path -LiteralPath $markerPath)) {
        Remove-Item -LiteralPath $markerPath -Force -ErrorAction Stop
      }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
  }
  Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
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

function Publish-Utf8FileAtomically {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Value
  )
  $directory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($Path))
  $metadataPath = [System.IO.Path]::GetFullPath($Path)
  $metadataTemporaryPath = Join-Path $directory ('.metadata.{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
  $stream = $null
  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  try {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Value)
    $stream = [System.IO.FileStream]::new(
      $metadataTemporaryPath,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::Write,
      [System.IO.FileShare]::None
    )
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
    $stream.Dispose()
    $stream = $null
    [System.IO.File]::Move($metadataTemporaryPath, $metadataPath)
  } catch {
    $primaryError = $_
  } finally {
    try {
      if ($null -ne $stream) { $stream.Dispose() }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
    try {
      if (Test-Path -LiteralPath $metadataTemporaryPath) {
        Remove-Item -LiteralPath $metadataTemporaryPath -Force
      }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
  }
  Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
}

function Get-CheckpointEvidenceProperty {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Context
  )
  if ($null -eq $Object) { throw "$Context is missing." }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { throw "$Context.$Name is required." }
  return $property
}

function Assert-CheckpointEvidenceExactString {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][string]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if ($Value -isnot [string] -or $Value -cne $Expected) { throw $Message }
}

function Assert-CheckpointEvidenceStringPattern {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if ($Value -isnot [string] -or $Value -cnotmatch $Pattern) { throw $Message }
}

function Assert-CheckpointEvidenceBoolean {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][bool]$Expected,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if ($Value -isnot [bool] -or $Value -ne $Expected) { throw $Message }
}

function Assert-CheckpointDrillEvidence {
  param(
    [Parameter(Mandatory = $true)][object]$Summary,
    [Parameter(Mandatory = $true)][object]$ExpectedCommit,
    [Parameter(Mandatory = $true)][object]$ExpectedVersion,
    [Parameter(Mandatory = $true)][object]$ExpectedBackupHash,
    [Parameter(Mandatory = $true)][object]$ActualBackupHash,
    [Parameter(Mandatory = $true)][object]$ExpectedDataRootIdentity,
    [Parameter(Mandatory = $true)][object]$ActualDataRootIdentity
  )
  $schemaProperty = Get-CheckpointEvidenceProperty -Object $Summary -Name 'schema' -Context 'summary'
  $statusProperty = Get-CheckpointEvidenceProperty -Object $Summary -Name 'status' -Context 'summary'
  $inputModeProperty = Get-CheckpointEvidenceProperty -Object $Summary -Name 'input_mode' -Context 'summary'
  $sourceProperty = Get-CheckpointEvidenceProperty -Object $Summary -Name 'source' -Context 'summary'
  $backupProperty = Get-CheckpointEvidenceProperty -Object $Summary -Name 'backup' -Context 'summary'
  $operationsProperty = Get-CheckpointEvidenceProperty -Object $Summary -Name 'operations' -Context 'summary'

  Assert-CheckpointEvidenceExactString -Value $schemaProperty.Value -Expected 'localminidrama.rollback-drill.v3' -Message 'Rollback drill schema must be the exact v3 schema.'
  Assert-CheckpointEvidenceExactString -Value $statusProperty.Value -Expected 'passed' -Message 'Rollback drill status must be the exact string passed.'
  Assert-CheckpointEvidenceExactString -Value $inputModeProperty.Value -Expected 'checkpoint-bound' -Message 'Rollback drill input mode must be checkpoint-bound.'

  $sourceCommitProperty = Get-CheckpointEvidenceProperty -Object $sourceProperty.Value -Name 'commit' -Context 'summary.source'
  $sourceVersionProperty = Get-CheckpointEvidenceProperty -Object $sourceProperty.Value -Name 'version' -Context 'summary.source'
  $workingTreeDirtyProperty = Get-CheckpointEvidenceProperty -Object $sourceProperty.Value -Name 'working_tree_dirty' -Context 'summary.source'
  $dataRootHashProperty = Get-CheckpointEvidenceProperty -Object $sourceProperty.Value -Name 'data_root_sha256' -Context 'summary.source'
  $commitPattern = '^[a-f0-9]{40}$'
  Assert-CheckpointEvidenceStringPattern -Value $ExpectedCommit -Pattern $commitPattern -Message 'Captured rollback commit must be a lowercase full SHA.'
  Assert-CheckpointEvidenceStringPattern -Value $sourceCommitProperty.Value -Pattern $commitPattern -Message 'Rollback drill source commit must be a lowercase full SHA.'
  Assert-CheckpointEvidenceExactString -Value $sourceCommitProperty.Value -Expected $ExpectedCommit -Message 'Rollback drill commit does not match the captured commit.'
  $versionPattern = '^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$'
  Assert-CheckpointEvidenceStringPattern -Value $ExpectedVersion -Pattern $versionPattern -Message 'Captured rollback version is malformed.'
  Assert-CheckpointEvidenceStringPattern -Value $sourceVersionProperty.Value -Pattern $versionPattern -Message 'Rollback drill source version is malformed.'
  Assert-CheckpointEvidenceExactString -Value $sourceVersionProperty.Value -Expected $ExpectedVersion -Message 'Rollback drill version does not match the captured version.'
  Assert-CheckpointEvidenceBoolean -Value $workingTreeDirtyProperty.Value -Expected $false -Message 'Rollback drill working tree evidence must be boolean false.'
  $hashPattern = '^[a-f0-9]{64}$'
  Assert-CheckpointEvidenceStringPattern -Value $dataRootHashProperty.Value -Pattern $hashPattern -Message 'Rollback drill data root digest must be lowercase SHA-256.'

  $archiveRetainedProperty = Get-CheckpointEvidenceProperty -Object $backupProperty.Value -Name 'archive_retained' -Context 'summary.backup'
  $summaryBackupHashProperty = Get-CheckpointEvidenceProperty -Object $backupProperty.Value -Name 'archive_sha256' -Context 'summary.backup'
  Assert-CheckpointEvidenceBoolean -Value $archiveRetainedProperty.Value -Expected $true -Message 'Rollback drill archive retention evidence must be boolean true.'
  Assert-CheckpointEvidenceStringPattern -Value $summaryBackupHashProperty.Value -Pattern $hashPattern -Message 'Rollback drill archive digest must be lowercase SHA-256.'
  Assert-CheckpointEvidenceStringPattern -Value $ExpectedBackupHash -Pattern $hashPattern -Message 'Captured rollback archive digest must be lowercase SHA-256.'
  Assert-CheckpointEvidenceStringPattern -Value $ActualBackupHash -Pattern $hashPattern -Message 'Current rollback archive digest must be lowercase SHA-256.'
  if ($summaryBackupHashProperty.Value -cne $ExpectedBackupHash -or $summaryBackupHashProperty.Value -cne $ActualBackupHash) {
    throw 'Rollback drill, captured, and current archive digests must match.'
  }

  $sourceDataRootUnchangedProperty = Get-CheckpointEvidenceProperty -Object $operationsProperty.Value -Name 'source_data_root_unchanged' -Context 'summary.operations'
  Assert-CheckpointEvidenceBoolean -Value $sourceDataRootUnchangedProperty.Value -Expected $true -Message 'Rollback drill root retention evidence must be boolean true.'
  $identityPattern = '^[a-f0-9]{8}:[a-f0-9]{16}$'
  Assert-CheckpointEvidenceStringPattern -Value $ExpectedDataRootIdentity -Pattern $identityPattern -Message 'Captured rollback data root identity must use the native lowercase format.'
  Assert-CheckpointEvidenceStringPattern -Value $ActualDataRootIdentity -Pattern $identityPattern -Message 'Current rollback data root identity must use the native lowercase format.'
  if ($ExpectedDataRootIdentity -cne $ActualDataRootIdentity) {
    throw 'Rollback data root identity changed during checkpoint creation.'
  }

  return [pscustomobject][ordered]@{
    data_root_sha256 = $dataRootHashProperty.Value
    data_root_identity = $ExpectedDataRootIdentity
  }
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

function Invoke-ReleaseRollbackCheckpoint {
param([Parameter(Mandatory = $true)][string]$CheckpointDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$directoryLock = $null
$checkpointDirectoryLock = $null
$configDirectoryLock = $null
$archiveLock = $null
$locationPushed = $false
$primaryError = $null
$cleanupErrors = [System.Collections.ArrayList]::new()
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$checkpoint = Get-NormalizedPath -Path $CheckpointDirectory
Assert-NoReparsePathComponents -Path $checkpoint -Label 'Rollback checkpoint' | Out-Null
Assert-OutsideRepository -RepositoryRoot $repoRoot -Candidate $checkpoint
if (Test-Path -LiteralPath $checkpoint) {
  throw "Rollback checkpoint already exists: $checkpoint"
}

Push-Location $repoRoot
$locationPushed = $true
try {
  $dirty = Get-CheckedScalar -FilePath 'git' -ArgumentList @('status', '--porcelain', '--untracked-files=normal') -Label 'Git status'
  if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    throw 'Rollback checkpoint requires a clean Git working tree.'
  }
  $commit = (Get-CheckedScalar -FilePath 'git' -ArgumentList @('rev-parse', 'HEAD') -Label 'Commit capture').ToLowerInvariant()
  if ($commit -notmatch '^[a-f0-9]{40}$') { throw 'Git did not return a full commit SHA.' }
  $version = Get-CheckedScalar -FilePath 'node' -ArgumentList @('-p', "require('./backend-node/package.json').version") -Label 'Version capture'
  if ($version -cnotmatch '^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$') {
    throw 'Version capture did not return a valid release version.'
  }

  $env:LOCALMINIDRAMA_BUILD_REVISION = $commit
  Invoke-Checked -FilePath 'docker' -ArgumentList @('compose', 'config', '--quiet') -Label 'Docker Compose validation' | Out-Null
  $backend = Get-RunningServiceEvidence -Service 'backend' -ExpectedRevision $commit
  $frontend = Get-RunningServiceEvidence -Service 'frontend' -ExpectedRevision $commit
  $runtimeDataDirectory = Get-ContainerBindSource -ContainerId $backend.container_id -Destination '/app/data' -RequireReadWrite
  Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory -CheckpointMayNotExist
  $directoryLock = Open-RollbackDirectoryIdentityLock -Path $runtimeDataDirectory
  $capturedDataRootIdentity = Get-RollbackPathIdentity -Handle $directoryLock
  Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Captured rollback data root' | Out-Null
  Confirm-RollbackContainerBindAuthority -ContainerId $backend.container_id -Destination '/app/data' -HostDirectory $runtimeDataDirectory -DirectoryHandle $directoryLock
  Set-DataSourceEnvironment -DataDirectory $runtimeDataDirectory
  $runtimeConfigDirectory = Get-ContainerBindSource -ContainerId $backend.container_id -Destination '/app/config-source'
  $runtimeConfigSource = Join-Path $runtimeConfigDirectory 'config.yaml'
  Assert-RegularFile -Path $runtimeConfigSource
  Set-RuntimeConfigEnvironment -ConfigDirectory $runtimeConfigDirectory -ConfigPath $runtimeConfigSource

  New-Item -ItemType Directory -Path $checkpoint | Out-Null
  $checkpointDirectoryLock = Open-RollbackDirectoryIdentityLock -Path $checkpoint -Label 'Rollback checkpoint'
  Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory
  $configArchiveRoot = Join-Path $checkpoint 'configs'
  New-Item -ItemType Directory -Path $configArchiveRoot | Out-Null
  $configDirectoryLock = Open-RollbackDirectoryIdentityLock -Path $configArchiveRoot -Label 'Rollback checkpoint config directory'
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
    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root after shutdown' | Out-Null

    $backupPath = Join-Path $checkpoint 'data.zip'
    Set-RuntimeConfigEnvironment -ConfigDirectory $runtimeConfigDirectory -ConfigPath $runtimeConfigSource
    Set-DataSourceEnvironment -DataDirectory $runtimeDataDirectory
    Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory
    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root before backup' | Out-Null
    Invoke-Checked -FilePath 'npm' -ArgumentList @('--prefix', 'backend-node', 'run', 'backup:data', '--', '--output', $backupPath, '--data-root', $runtimeDataDirectory) -Label 'Data backup' | Out-Null
    $archiveLock = Open-RollbackArchiveReadLock -Path $backupPath
    $capturedArchiveIdentity = Get-RollbackPathIdentity -Handle $archiveLock.SafeFileHandle
    Assert-RollbackPathIdentity -Path $backupPath -ExpectedIdentity $capturedArchiveIdentity -Label 'Rollback archive after backup' | Out-Null
    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root after backup' | Out-Null
    $backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Utf8File -Path (Join-Path $checkpoint 'data.sha256.txt') -Value "$backupHash`n"

    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root before drill' | Out-Null
    Invoke-Checked -FilePath 'npm' -ArgumentList @(
      'run', 'verify:rollback', '--',
      '--archive', $backupPath,
      '--data-root', $runtimeDataDirectory
    ) -Label 'Rollback drill' | Out-Null
    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root after drill' | Out-Null
    Assert-RollbackPathIdentity -Path $backupPath -ExpectedIdentity $capturedArchiveIdentity -Label 'Rollback archive after drill' | Out-Null
    $actualBackupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $summaryPath = Join-Path $repoRoot 'artifacts\rollback-drill\summary.json'
    $summaryJson = Get-Content -LiteralPath $summaryPath -Raw
    $summary = $summaryJson | ConvertFrom-Json
    $actualDataRootIdentity = Get-RollbackPathIdentity -Path $runtimeDataDirectory
    $validatedEvidence = Assert-CheckpointDrillEvidence -Summary $summary -ExpectedCommit $commit -ExpectedVersion $version -ExpectedBackupHash $backupHash -ActualBackupHash $actualBackupHash -ExpectedDataRootIdentity $capturedDataRootIdentity -ActualDataRootIdentity $actualDataRootIdentity
    $summaryArchive = Join-Path $checkpoint 'rollback-drill-summary.json'
    Write-Utf8File -Path $summaryArchive -Value $summaryJson
    $summaryHash = (Get-FileHash -LiteralPath $summaryArchive -Algorithm SHA256).Hash.ToLowerInvariant()

    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root before metadata publication' | Out-Null
    Assert-RollbackPathIdentity -Path $backupPath -ExpectedIdentity $capturedArchiveIdentity -Label 'Rollback archive before metadata publication' | Out-Null
    $publishedBackupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($publishedBackupHash -cne $backupHash -or $publishedBackupHash -cne $actualBackupHash) {
      throw 'Rollback archive changed before metadata publication.'
    }
    $metadata = [ordered]@{
      schema = 'localminidrama.release-rollback-checkpoint.v5'
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
      data_root_sha256 = $validatedEvidence.data_root_sha256
      data_root_identity = $validatedEvidence.data_root_identity
    }
    Publish-Utf8FileAtomically -Path (Join-Path $checkpoint 'metadata.json') -Value "$(ConvertTo-Json $metadata -Depth 6)`n"
    Write-Output "Rollback checkpoint ready: $checkpoint"
    Write-Output 'Provider credentials were excluded from the archived runtime config and must be configured and tested again after restore.'
  } catch {
    $checkpointError = $_
    if ($dockerStopped) {
      try {
        Start-CapturedDeployment -Backend $backend -Frontend $frontend -Revision $commit -ConfigDirectory $runtimeConfigDirectory -ConfigPath $runtimeConfigSource -DataDirectory $runtimeDataDirectory -CheckpointDirectory $checkpoint
      } catch {
        [void]$cleanupErrors.Add($_)
      }
    }
    throw $checkpointError
  }
} catch {
  $primaryError = $_
} finally {
  try {
    if ($null -ne $archiveLock) { $archiveLock.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $configDirectoryLock) { $configDirectoryLock.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $checkpointDirectoryLock) { $checkpointDirectoryLock.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $directoryLock) { $directoryLock.Dispose() }
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
  Invoke-ReleaseRollbackCheckpoint -CheckpointDirectory $CheckpointDirectory
}
