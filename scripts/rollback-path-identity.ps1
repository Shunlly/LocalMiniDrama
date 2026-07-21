function Initialize-RollbackPathNative {
  if ($null -ne ([System.Management.Automation.PSTypeName]'LocalMiniDrama.Rollback.NativeMethods').Type) {
    return
  }

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace LocalMiniDrama.Rollback
{
    [StructLayout(LayoutKind.Sequential)]
    public struct NativeFileTime
    {
        public UInt32 Low;
        public UInt32 High;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ByHandleFileInformation
    {
        public UInt32 FileAttributes;
        public NativeFileTime CreationTime;
        public NativeFileTime LastAccessTime;
        public NativeFileTime LastWriteTime;
        public UInt32 VolumeSerialNumber;
        public UInt32 FileSizeHigh;
        public UInt32 FileSizeLow;
        public UInt32 NumberOfLinks;
        public UInt32 FileIndexHigh;
        public UInt32 FileIndexLow;
    }

    public static class NativeMethods
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern SafeFileHandle CreateFileW(
            string fileName,
            UInt32 desiredAccess,
            UInt32 shareMode,
            IntPtr securityAttributes,
            UInt32 creationDisposition,
            UInt32 flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetFileInformationByHandle(
            SafeFileHandle file,
            out ByHandleFileInformation information);
    }
}
'@ | Out-Null
}

function Get-RollbackPathIdentity {
  [CmdletBinding(DefaultParameterSetName = 'Path')]
  param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Path')][string]$Path,
    [Parameter(Mandatory = $true, ParameterSetName = 'Handle')]
    [Microsoft.Win32.SafeHandles.SafeFileHandle]$Handle
  )
  Initialize-RollbackPathNative

  $ownedHandle = $null
  try {
    if ($PSCmdlet.ParameterSetName -eq 'Path') {
      $ownedHandle = [LocalMiniDrama.Rollback.NativeMethods]::CreateFileW(
        [System.IO.Path]::GetFullPath($Path),
        [uint32]0,
        [uint32]7,
        [IntPtr]::Zero,
        [uint32]3,
        [uint32]0x02000000,
        [IntPtr]::Zero
      )
      if ($null -eq $ownedHandle -or $ownedHandle.IsInvalid) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($null -ne $ownedHandle) { $ownedHandle.Dispose() }
        $ownedHandle = $null
        throw [ComponentModel.Win32Exception]::new($errorCode, "Could not open rollback path identity handle: $Path")
      }
      $Handle = $ownedHandle
    }
    if ($null -eq $Handle -or $Handle.IsInvalid -or $Handle.IsClosed) {
      throw 'Rollback path identity requires an open valid handle.'
    }

    $information = [LocalMiniDrama.Rollback.ByHandleFileInformation]::new()
    if (-not [LocalMiniDrama.Rollback.NativeMethods]::GetFileInformationByHandle($Handle, [ref]$information)) {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw [ComponentModel.Win32Exception]::new($errorCode, 'Could not read rollback path identity.')
    }
    $fileIndex = (([uint64]$information.FileIndexHigh) -shl 32) -bor ([uint64]$information.FileIndexLow)
    return ('{0:x8}:{1:x16}' -f ([uint64]$information.VolumeSerialNumber), $fileIndex)
  } finally {
    if ($null -ne $ownedHandle) { $ownedHandle.Dispose() }
  }
}

function Assert-RollbackPathIdentity {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$ExpectedIdentity,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($ExpectedIdentity -isnot [string] -or $ExpectedIdentity -cnotmatch '^[a-f0-9]{8}:[a-f0-9]{16}$') {
    throw "$Label retained identity is malformed."
  }
  $actualIdentity = Get-RollbackPathIdentity -Path $Path
  if ($actualIdentity -cne $ExpectedIdentity) {
    throw "$Label path no longer refers to the retained filesystem object."
  }
  return $actualIdentity
}

function Open-RollbackArchiveReadLock {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = $null
  try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $stream = [System.IO.FileStream]::new(
      $fullPath,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::Read
    )
    $item = Get-Item -LiteralPath $fullPath -Force
    if ($item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw "Rollback archive must be a regular non-reparse file: $fullPath"
    }
    $identity = Get-RollbackPathIdentity -Handle $stream.SafeFileHandle
    Assert-RollbackPathIdentity -Path $fullPath -ExpectedIdentity $identity -Label 'Rollback archive' | Out-Null
    return $stream
  } catch {
    if ($null -ne $stream) { $stream.Dispose() }
    throw
  }
}

function Open-RollbackDirectoryIdentityLock {
  param([Parameter(Mandatory = $true)][string]$Path)
  $handle = $null
  try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $item = Get-Item -LiteralPath $fullPath -Force
    if (-not $item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw "Rollback data root must be a real non-reparse directory: $fullPath"
    }
    Initialize-RollbackPathNative
    # FILE_LIST_DIRECTORY is the narrowest access that makes the no-delete share effective for directories.
    $fileListDirectory = [uint32]1
    $fileShareReadWrite = [uint32]3
    $openExisting = [uint32]3
    $backupSemantics = [uint32]0x02000000
    $handle = [LocalMiniDrama.Rollback.NativeMethods]::CreateFileW(
      $fullPath,
      $fileListDirectory,
      $fileShareReadWrite,
      [IntPtr]::Zero,
      $openExisting,
      $backupSemantics,
      [IntPtr]::Zero
    )
    if ($null -eq $handle -or $handle.IsInvalid) {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($null -ne $handle) { $handle.Dispose() }
      $handle = $null
      throw [ComponentModel.Win32Exception]::new($errorCode, "Could not open rollback directory identity lock: $fullPath")
    }
    $identity = Get-RollbackPathIdentity -Handle $handle
    Assert-RollbackPathIdentity -Path $fullPath -ExpectedIdentity $identity -Label 'Rollback data root' | Out-Null
    return $handle
  } catch {
    if ($null -ne $handle) { $handle.Dispose() }
    throw
  }
}
