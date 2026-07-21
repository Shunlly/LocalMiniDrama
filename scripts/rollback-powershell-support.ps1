function Complete-RollbackInvocation {
  [CmdletBinding()]
  param(
    [AllowNull()][System.Management.Automation.ErrorRecord]$PrimaryError,
    [Parameter(Mandatory = $true)][System.Collections.IList]$CleanupErrors
  )

  $retainedCleanupErrors = [object[]]@($CleanupErrors)
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
