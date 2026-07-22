$script:RollbackJsonContractScriptPath = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot 'rollback-json-contract.cjs')
)

function Read-StrictRollbackJson {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][object]$Authority,
    [Parameter(Mandatory = $true)][string]$Label
  )

  Assert-RollbackFileAuthority -Authority $Authority | Out-Null
  if (-not [System.IO.File]::Exists($script:RollbackJsonContractScriptPath)) {
    throw 'Rollback JSON contract checker is missing.'
  }
  $nodeExecutable = if ([string]::IsNullOrWhiteSpace($env:LMD_NODE_EXE)) {
    'node'
  } else {
    $env:LMD_NODE_EXE
  }
  $previousErrorActionPreference = $ErrorActionPreference
  $output = @()
  $exitCode = 0
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $nodeExecutable $script:RollbackJsonContractScriptPath '--check' $Authority.Path 2>&1)
    $exitCode = [int]$LASTEXITCODE
  } catch {
    throw "$Label strict JSON check could not execute: $($_.Exception.Message)"
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    $diagnostic = (($output | ForEach-Object { $_.ToString() }) -join ' ').Trim()
    if ($diagnostic.Length -gt 2048) { $diagnostic = $diagnostic.Substring(0, 2048) + ' [truncated]' }
    if ([string]::IsNullOrWhiteSpace($diagnostic)) { $diagnostic = "checker exit code $exitCode" }
    throw "$Label contains invalid or ambiguous JSON: $diagnostic"
  }

  Assert-RollbackFileAuthority -Authority $Authority | Out-Null
  $text = Read-RollbackFileAuthorityUtf8 -Authority $Authority
  try {
    return ConvertFrom-Json -InputObject $text
  } catch {
    throw "$Label contains invalid JSON."
  }
}

function Complete-RollbackInvocation {
  [CmdletBinding()]
  param(
    [AllowNull()][System.Management.Automation.ErrorRecord]$PrimaryError,
    [Parameter(Mandatory = $true)][System.Collections.IList]$CleanupErrors
  )

  $mergedCleanupErrors = [System.Collections.ArrayList]::new()
  if ($null -ne $PrimaryError) {
    $attachedCleanupErrors = $PrimaryError.Exception.Data['RollbackCleanupErrors']
    if ($null -ne $attachedCleanupErrors) {
      foreach ($cleanupError in @($attachedCleanupErrors)) {
        [void]$mergedCleanupErrors.Add($cleanupError)
      }
    }
  }
  foreach ($cleanupError in @($CleanupErrors)) {
    [void]$mergedCleanupErrors.Add($cleanupError)
  }
  $retainedCleanupErrors = [object[]]@($mergedCleanupErrors)
  if ($null -ne $PrimaryError) {
    if ($retainedCleanupErrors.Count -gt 0) {
      $PrimaryError.Exception.Data['RollbackCleanupErrors'] = $retainedCleanupErrors
    }
    $PSCmdlet.ThrowTerminatingError($PrimaryError)
  }

  if ($retainedCleanupErrors.Count -gt 0) {
    $messages = @($retainedCleanupErrors | ForEach-Object { $_.Exception.Message })
    $exception = [System.InvalidOperationException]::new(
      "Rollback cleanup failed: $($messages -join ' | ')"
    )
    $exception.Data['RollbackCleanupErrors'] = $retainedCleanupErrors
    $errorRecord = [System.Management.Automation.ErrorRecord]::new(
      $exception,
      'RollbackCleanupFailed',
      [System.Management.Automation.ErrorCategory]::CloseError,
      $null
    )
    $PSCmdlet.ThrowTerminatingError($errorRecord)
  }
}
