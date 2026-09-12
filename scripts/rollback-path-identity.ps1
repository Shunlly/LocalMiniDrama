function Initialize-RollbackPathNative {
  if ($null -ne ([System.Management.Automation.PSTypeName]'LocalMiniDrama.Rollback.NativeMethods').Type) {
    return
  }

  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
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

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetVolumeInformationByHandleW(
            SafeFileHandle file,
            StringBuilder volumeName,
            UInt32 volumeNameSize,
            out UInt32 volumeSerialNumber,
            out UInt32 maximumComponentLength,
            out UInt32 fileSystemFlags,
            StringBuilder fileSystemName,
            UInt32 fileSystemNameSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool FlushFileBuffers(SafeFileHandle file);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetFileInformationByHandle(
            SafeFileHandle file,
            Int32 fileInformationClass,
            IntPtr fileInformation,
            UInt32 bufferSize);

        static Win32Exception LastError(string operation)
        {
            int error = Marshal.GetLastWin32Error();
            return new Win32Exception(error, operation + " failed (Win32 error " + error + ").");
        }

        public static string ToExtendedPath(string path)
        {
            if (String.IsNullOrWhiteSpace(path)) throw new ArgumentException("A path is required.", "path");
            string fullPath = System.IO.Path.GetFullPath(path);
            if (fullPath.StartsWith(@"\\?\", StringComparison.Ordinal)) return fullPath;
            if (fullPath.StartsWith(@"\\", StringComparison.Ordinal)) return @"\\?\UNC\" + fullPath.Substring(2);
            return @"\\?\" + fullPath;
        }

        public static string GetFileSystemName(SafeFileHandle file)
        {
            if (file == null || file.IsInvalid || file.IsClosed) throw new ArgumentException("An open directory handle is required.", "file");
            StringBuilder volumeName = new StringBuilder(261);
            StringBuilder fileSystemName = new StringBuilder(261);
            UInt32 serial;
            UInt32 maximumComponentLength;
            UInt32 flags;
            if (!GetVolumeInformationByHandleW(file, volumeName, (UInt32)volumeName.Capacity, out serial, out maximumComponentLength, out flags, fileSystemName, (UInt32)fileSystemName.Capacity)) {
                throw LastError("GetVolumeInformationByHandleW");
            }
            return fileSystemName.ToString();
        }

        public static void RenameNoReplace(SafeFileHandle file, string destinationPath)
        {
            if (file == null || file.IsInvalid || file.IsClosed) throw new ArgumentException("An open file handle is required.", "file");
            if (String.IsNullOrWhiteSpace(destinationPath) || !System.IO.Path.IsPathRooted(destinationPath)) {
                throw new ArgumentException("The destination path must be absolute.", "destinationPath");
            }

            byte[] fileName = Encoding.Unicode.GetBytes(ToExtendedPath(destinationPath));
            int rootOffset = IntPtr.Size == 8 ? 8 : 4;
            int lengthOffset = IntPtr.Size == 8 ? 16 : 8;
            int nameOffset = IntPtr.Size == 8 ? 20 : 12;
            int bufferSize = checked(nameOffset + fileName.Length + sizeof(char));
            IntPtr buffer = Marshal.AllocHGlobal(bufferSize);
            try {
                for (int index = 0; index < bufferSize; index++) Marshal.WriteByte(buffer, index, 0);
                Marshal.WriteByte(buffer, 0, 0);
                Marshal.WriteIntPtr(buffer, rootOffset, IntPtr.Zero);
                Marshal.WriteInt32(buffer, lengthOffset, fileName.Length);
                Marshal.Copy(fileName, 0, IntPtr.Add(buffer, nameOffset), fileName.Length);
                const int FileRenameInfo = 3;
                if (!SetFileInformationByHandle(file, FileRenameInfo, buffer, checked((UInt32)bufferSize))) {
                    throw LastError("SetFileInformationByHandle(FILE_RENAME_INFO)");
                }
            }
            finally {
                Marshal.FreeHGlobal(buffer);
            }
        }

        public static void MarkDelete(SafeFileHandle file)
        {
            if (file == null || file.IsInvalid || file.IsClosed) throw new ArgumentException("An open file handle is required.", "file");
            IntPtr disposition = Marshal.AllocHGlobal(1);
            try {
                Marshal.WriteByte(disposition, 0, 1);
                const int FileDispositionInfo = 4;
                if (!SetFileInformationByHandle(file, FileDispositionInfo, disposition, 1)) {
                    throw LastError("SetFileInformationByHandle(FILE_DISPOSITION_INFO)");
                }
            }
            finally {
                Marshal.FreeHGlobal(disposition);
            }
        }
    }
}
'@ | Out-Null
}

function Get-RollbackPathInformation {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Label = 'Rollback path'
  )
  Initialize-RollbackPathNative
  $handle = $null
  try {
    $backupSemantics = [uint32]0x02000000
    $openReparsePoint = [uint32]0x00200000
    $handle = [LocalMiniDrama.Rollback.NativeMethods]::CreateFileW(
      [LocalMiniDrama.Rollback.NativeMethods]::ToExtendedPath([System.IO.Path]::GetFullPath($Path)),
      [uint32]0,
      [uint32]7,
      [IntPtr]::Zero,
      [uint32]3,
      ($backupSemantics -bor $openReparsePoint),
      [IntPtr]::Zero
    )
    if ($null -eq $handle -or $handle.IsInvalid) {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($null -ne $handle) { $handle.Dispose() }
      $handle = $null
      throw [ComponentModel.Win32Exception]::new($errorCode, "Could not open $Label information handle: $Path")
    }
    return Get-RollbackHandleInformation -Handle $handle
  } finally {
    if ($null -ne $handle) { $handle.Dispose() }
  }
}

function Test-RollbackPathExists {
  param([Parameter(Mandatory = $true)][string]$Path)
  try {
    Get-RollbackPathInformation -Path $Path -Label 'rollback path existence' | Out-Null
    return $true
  } catch {
    if ($_.Exception -is [ComponentModel.Win32Exception] -and $_.Exception.NativeErrorCode -in @(2, 3)) {
      return $false
    }
    throw
  }
}

function Get-RollbackPathIdentity {
  [CmdletBinding(DefaultParameterSetName = 'Path')]
  param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Path')][string]$Path,
    [Parameter(Mandatory = $true, ParameterSetName = 'Handle')]
    [Microsoft.Win32.SafeHandles.SafeFileHandle]$Handle
  )
  if ($PSCmdlet.ParameterSetName -eq 'Path') {
    return (Get-RollbackPathInformation -Path $Path -Label 'rollback path identity').Identity
  }
  if ($null -eq $Handle -or $Handle.IsInvalid -or $Handle.IsClosed) {
    throw 'Rollback path identity requires an open valid handle.'
  }
  return (Get-RollbackHandleInformation -Handle $Handle).Identity
}

function Get-RollbackHandleInformation {
  param(
    [Parameter(Mandatory = $true)]
    [Microsoft.Win32.SafeHandles.SafeFileHandle]$Handle
  )
  Initialize-RollbackPathNative
  if ($null -eq $Handle -or $Handle.IsInvalid -or $Handle.IsClosed) {
    throw 'Rollback path information requires an open valid handle.'
  }

  $information = [LocalMiniDrama.Rollback.ByHandleFileInformation]::new()
  if (-not [LocalMiniDrama.Rollback.NativeMethods]::GetFileInformationByHandle($Handle, [ref]$information)) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw [ComponentModel.Win32Exception]::new($errorCode, 'Could not read rollback path information.')
  }
  $fileIndex = (([uint64]$information.FileIndexHigh) -shl 32) -bor ([uint64]$information.FileIndexLow)
  return [pscustomobject][ordered]@{
    Identity = ('{0:x8}:{1:x16}' -f ([uint64]$information.VolumeSerialNumber), $fileIndex)
    Attributes = [System.IO.FileAttributes]$information.FileAttributes
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

function Open-RollbackFileAuthority {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $handle = $null
  $stream = $null
  try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    Initialize-RollbackPathNative
    $genericRead = [uint32]2147483648
    $fileShareRead = [uint32][System.IO.FileShare]::Read
    $openExisting = [uint32]3
    $openReparsePoint = [uint32]0x00200000
    $handle = [LocalMiniDrama.Rollback.NativeMethods]::CreateFileW(
      [LocalMiniDrama.Rollback.NativeMethods]::ToExtendedPath($fullPath),
      $genericRead,
      $fileShareRead,
      [IntPtr]::Zero,
      $openExisting,
      $openReparsePoint,
      [IntPtr]::Zero
    )
    if ($null -eq $handle -or $handle.IsInvalid) {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($null -ne $handle) { $handle.Dispose() }
      $handle = $null
      throw [ComponentModel.Win32Exception]::new($errorCode, "Could not open $Label authority: $fullPath")
    }
    $information = Get-RollbackHandleInformation -Handle $handle
    if ((($information.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0) -or
        (($information.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw "$Label must be a regular non-reparse file: $fullPath"
    }
    Assert-RollbackPathIdentity -Path $fullPath -ExpectedIdentity $information.Identity -Label $Label | Out-Null
    $stream = [System.IO.FileStream]::new($handle, [System.IO.FileAccess]::Read)
    $handle = $null
    return [pscustomobject][ordered]@{
      Path = $fullPath
      Label = $Label
      Identity = $information.Identity
      Stream = $stream
    }
  } catch {
    if ($null -ne $stream) { $stream.Dispose() }
    if ($null -ne $handle) { $handle.Dispose() }
    throw
  }
}

function Assert-RollbackFileAuthority {
  param([Parameter(Mandatory = $true)][object]$Authority)
  foreach ($member in @('Path', 'Label', 'Identity', 'Stream')) {
    if ($null -eq $Authority.PSObject.Properties[$member]) {
      throw "Rollback file authority is missing $member."
    }
  }
  if ($Authority.Path -isnot [string] -or
      $Authority.Label -isnot [string] -or
      $Authority.Identity -isnot [string] -or
      $null -eq $Authority.Stream -or
      -not $Authority.Stream.CanRead) {
    throw 'Rollback file authority is invalid or closed.'
  }
  $handleIdentity = Get-RollbackPathIdentity -Handle $Authority.Stream.SafeFileHandle
  if ($handleIdentity -cne $Authority.Identity) {
    throw "$($Authority.Label) retained handle identity changed."
  }
  return Assert-RollbackPathIdentity -Path $Authority.Path -ExpectedIdentity $handleIdentity -Label $Authority.Label
}

function Get-RollbackFileAuthoritySha256 {
  param([Parameter(Mandatory = $true)][object]$Authority)
  Assert-RollbackFileAuthority -Authority $Authority | Out-Null
  if (-not $Authority.Stream.CanSeek) {
    throw "$($Authority.Label) authority stream must be seekable."
  }
  $originalPosition = $Authority.Stream.Position
  $sha256 = $null
  try {
    $Authority.Stream.Position = 0
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $hash = $sha256.ComputeHash($Authority.Stream)
    return [BitConverter]::ToString($hash).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($null -ne $sha256) { $sha256.Dispose() }
    $Authority.Stream.Position = $originalPosition
  }
}

function Read-RollbackFileAuthorityUtf8 {
  param([Parameter(Mandatory = $true)][object]$Authority)
  Assert-RollbackFileAuthority -Authority $Authority | Out-Null
  if (-not $Authority.Stream.CanSeek) {
    throw "$($Authority.Label) authority stream must be seekable."
  }
  $originalPosition = $Authority.Stream.Position
  $reader = $null
  try {
    $Authority.Stream.Position = 0
    $encoding = [System.Text.UTF8Encoding]::new($false, $true)
    $reader = [System.IO.StreamReader]::new($Authority.Stream, $encoding, $false, 1024, $true)
    return $reader.ReadToEnd()
  } finally {
    if ($null -ne $reader) { $reader.Dispose() }
    $Authority.Stream.Position = $originalPosition
  }
}

function Open-RollbackArchiveReadLock {
  param([Parameter(Mandatory = $true)][string]$Path)
  $authority = Open-RollbackFileAuthority -Path $Path -Label 'Rollback archive'
  return $authority.Stream
}

function Assert-RollbackAbsolutePublicationPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if (-not [System.IO.Path]::IsPathRooted($Path)) {
    throw "$Label path must be absolute."
  }
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $parentPath = [System.IO.Path]::GetDirectoryName($fullPath)
  if ([string]::IsNullOrWhiteSpace($parentPath)) {
    throw "$Label path must have a parent directory."
  }
  $rootPath = [System.IO.Path]::GetPathRoot($parentPath)
  $drive = [System.IO.DriveInfo]::new($rootPath)
  if (-not $drive.IsReady -or $drive.DriveType -ne [System.IO.DriveType]::Fixed) {
    throw "$Label parent must be on a ready local fixed volume."
  }
  $currentPath = $rootPath
  $relativeParent = $parentPath.Substring($rootPath.Length).TrimStart([char[]]@('\', '/'))
  foreach ($segment in @($relativeParent -split '[\\/]' | Where-Object { $_.Length -gt 0 })) {
    $currentPath = Join-Path $currentPath $segment
    $information = Get-RollbackPathInformation -Path $currentPath -Label "$Label parent component"
    if ((($information.Attributes -band [System.IO.FileAttributes]::Directory) -eq 0) -or
        (($information.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw "$Label parent must have only real non-reparse directory components."
    }
  }
  return [pscustomobject][ordered]@{
    Path = $fullPath
    ParentPath = [System.IO.Path]::GetFullPath($parentPath)
  }
}

function Open-RollbackWritableDirectoryHandle {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  Initialize-RollbackPathNative
  $genericReadWriteDelete = [uint32]3221291008
  $fileShareReadWrite = [uint32]3
  $openExisting = [uint32]3
  $backupSemantics = [uint32]0x02000000
  $openReparsePoint = [uint32]0x00200000
  $handle = [LocalMiniDrama.Rollback.NativeMethods]::CreateFileW(
    [LocalMiniDrama.Rollback.NativeMethods]::ToExtendedPath([System.IO.Path]::GetFullPath($Path)),
    $genericReadWriteDelete,
    $fileShareReadWrite,
    [IntPtr]::Zero,
    $openExisting,
    ($backupSemantics -bor $openReparsePoint),
    [IntPtr]::Zero
  )
  if ($null -eq $handle -or $handle.IsInvalid) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($null -ne $handle) { $handle.Dispose() }
    throw [ComponentModel.Win32Exception]::new($errorCode, "Could not open $Label writable directory authority: $Path")
  }
  $information = Get-RollbackHandleInformation -Handle $handle
  if ((($information.Attributes -band [System.IO.FileAttributes]::Directory) -eq 0) -or
      (($information.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
    $handle.Dispose()
    throw "$Label writable authority must refer to a real non-reparse directory."
  }
  $fileSystemName = [LocalMiniDrama.Rollback.NativeMethods]::GetFileSystemName($handle)
  if ($fileSystemName -cne 'NTFS' -and $fileSystemName -cne 'ReFS') {
    $handle.Dispose()
    throw "$Label writable authority requires NTFS or ReFS."
  }
  return $handle
}

function Flush-RollbackHandle {
  param(
    [Parameter(Mandatory = $true)][Microsoft.Win32.SafeHandles.SafeFileHandle]$Handle,
    [Parameter(Mandatory = $true)][string]$Label
  )
  Initialize-RollbackPathNative
  if ($null -eq $Handle -or $Handle.IsInvalid -or $Handle.IsClosed) {
    throw "$Label flush requires an open handle."
  }
  if (-not [LocalMiniDrama.Rollback.NativeMethods]::FlushFileBuffers($Handle)) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw [ComponentModel.Win32Exception]::new($errorCode, "Could not flush $Label")
  }
}

function Invoke-RollbackHandleRename {
  param(
    [Parameter(Mandatory = $true)][Microsoft.Win32.SafeHandles.SafeFileHandle]$Handle,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  Initialize-RollbackPathNative
  try {
    [LocalMiniDrama.Rollback.NativeMethods]::RenameNoReplace($Handle, [System.IO.Path]::GetFullPath($Path))
  } catch {
    throw "$Label could not be published without overwrite: $($_.Exception.Message)"
  }
}

function Set-RollbackHandleDeleteDisposition {
  param(
    [Parameter(Mandatory = $true)][Microsoft.Win32.SafeHandles.SafeFileHandle]$Handle,
    [Parameter(Mandatory = $true)][string]$Label
  )
  Initialize-RollbackPathNative
  try {
    [LocalMiniDrama.Rollback.NativeMethods]::MarkDelete($Handle)
  } catch {
    throw "$Label owned handle could not be marked for deletion: $($_.Exception.Message)"
  }
}

function New-RollbackFilePublicationAuthority {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label,
    [AllowNull()][object]$ParentDirectoryAuthority = $null
  )
  $resolved = Assert-RollbackAbsolutePublicationPath -Path $Path -Label $Label
  $temporaryPath = Join-Path $resolved.ParentPath (
    ".$([System.IO.Path]::GetFileName($resolved.Path)).localminidrama-publish-$([Guid]::NewGuid().ToString('N')).tmp"
  )
  $parentHandle = $null
  $fileHandle = $null
  $stream = $null
  $created = $false
  $ownsParentDirectoryHandle = $true
  $parentDirectoryIdentity = $null
  $primaryError = $null
  try {
    if ($null -ne $ParentDirectoryAuthority) {
      foreach ($member in @('Path', 'Identity', 'Handle')) {
        if ($null -eq $ParentDirectoryAuthority.PSObject.Properties[$member]) {
          throw "$Label parent directory authority is missing $member."
        }
      }
      if ($ParentDirectoryAuthority.Path -isnot [string] -or
          -not ([System.IO.Path]::GetFullPath($ParentDirectoryAuthority.Path)).Equals($resolved.ParentPath, [StringComparison]::OrdinalIgnoreCase) -or
          $ParentDirectoryAuthority.Handle -isnot [Microsoft.Win32.SafeHandles.SafeFileHandle] -or
          $ParentDirectoryAuthority.Handle.IsInvalid -or
          $ParentDirectoryAuthority.Handle.IsClosed) {
        throw "$Label parent directory authority is invalid."
      }
      $parentHandle = $ParentDirectoryAuthority.Handle
      $parentDirectoryIdentity = Get-RollbackPathIdentity -Handle $parentHandle
      if ($parentDirectoryIdentity -cne $ParentDirectoryAuthority.Identity) {
        throw "$Label parent directory handle does not match its retained identity."
      }
      Assert-RollbackPathIdentity -Path $resolved.ParentPath -ExpectedIdentity $parentDirectoryIdentity -Label "$Label parent directory" | Out-Null
      $fileSystemName = [LocalMiniDrama.Rollback.NativeMethods]::GetFileSystemName($parentHandle)
      if ($fileSystemName -cne 'NTFS' -and $fileSystemName -cne 'ReFS') {
        throw "$Label parent directory authority requires NTFS or ReFS."
      }
      $ownsParentDirectoryHandle = $false
    } else {
      $parentHandle = Open-RollbackWritableDirectoryHandle -Path $resolved.ParentPath -Label "$Label parent"
      $parentDirectoryIdentity = Get-RollbackPathIdentity -Handle $parentHandle
      Assert-RollbackPathIdentity -Path $resolved.ParentPath -ExpectedIdentity $parentDirectoryIdentity -Label "$Label parent directory" | Out-Null
    }
    Initialize-RollbackPathNative
    $genericReadWriteDelete = [uint32]3221291008
    $fileShareRead = [uint32]1
    $createNew = [uint32]1
    $normal = [uint32]0x80
    $fileHandle = [LocalMiniDrama.Rollback.NativeMethods]::CreateFileW(
      [LocalMiniDrama.Rollback.NativeMethods]::ToExtendedPath($temporaryPath),
      $genericReadWriteDelete,
      $fileShareRead,
      [IntPtr]::Zero,
      $createNew,
      $normal,
      [IntPtr]::Zero
    )
    if ($null -eq $fileHandle -or $fileHandle.IsInvalid) {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($null -ne $fileHandle) { $fileHandle.Dispose() }
      $fileHandle = $null
      throw [ComponentModel.Win32Exception]::new($errorCode, "Could not create $Label publication authority")
    }
    $created = $true
    $information = Get-RollbackHandleInformation -Handle $fileHandle
    if ((($information.Attributes -band [System.IO.FileAttributes]::Directory) -ne 0) -or
        (($information.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw "$Label publication authority must be a regular non-reparse file."
    }
    Assert-RollbackPathIdentity -Path $temporaryPath -ExpectedIdentity $information.Identity -Label "$Label temporary publication" | Out-Null
    $stream = [System.IO.FileStream]::new($fileHandle, [System.IO.FileAccess]::ReadWrite)
    $fileHandle = $null
    return [pscustomobject][ordered]@{
      Path = $temporaryPath
      TemporaryPath = $temporaryPath
      DestinationPath = $resolved.Path
      ParentDirectoryPath = $resolved.ParentPath
      ParentDirectoryIdentity = $parentDirectoryIdentity
      Label = $Label
      Identity = $information.Identity
      Stream = $stream
      ParentDirectoryHandle = $parentHandle
      OwnsParentDirectoryHandle = $ownsParentDirectoryHandle
      Renamed = $false
      Published = $false
    }
  } catch {
    $primaryError = $_
  }

  $cleanupErrors = [System.Collections.ArrayList]::new()
  if ($created) {
    try {
      $cleanupHandle = if ($null -ne $stream) { $stream.SafeFileHandle } else { $fileHandle }
      if ($null -ne $cleanupHandle -and -not $cleanupHandle.IsInvalid -and -not $cleanupHandle.IsClosed) {
        Set-RollbackHandleDeleteDisposition -Handle $cleanupHandle -Label $Label
      }
    } catch { [void]$cleanupErrors.Add($_) }
  }
  try {
    if ($null -ne $stream) { $stream.Dispose() }
    elseif ($null -ne $fileHandle) { $fileHandle.Dispose() }
  } catch { [void]$cleanupErrors.Add($_) }
  try {
    if ($ownsParentDirectoryHandle -and $null -ne $parentHandle) { $parentHandle.Dispose() }
  } catch { [void]$cleanupErrors.Add($_) }
  if ($cleanupErrors.Count -gt 0) { $primaryError.Exception.Data['RollbackCleanupErrors'] = [object[]]@($cleanupErrors) }
  throw $primaryError
}

function Publish-RollbackFileAuthority {
  param([Parameter(Mandatory = $true)][object]$Authority)
  foreach ($member in @('Path', 'TemporaryPath', 'DestinationPath', 'ParentDirectoryPath', 'ParentDirectoryIdentity', 'Label', 'Identity', 'Stream', 'ParentDirectoryHandle', 'OwnsParentDirectoryHandle', 'Renamed', 'Published')) {
    if ($null -eq $Authority.PSObject.Properties[$member]) { throw "Rollback publication authority is missing $member." }
  }
  if ($Authority.Published -eq $true -or $Authority.Renamed -eq $true) {
    throw "$($Authority.Label) publication authority was already renamed."
  }
  if ($Authority.Stream -isnot [System.IO.FileStream] -or -not $Authority.Stream.CanRead -or -not $Authority.Stream.CanWrite) {
    throw "$($Authority.Label) publication stream is invalid or closed."
  }
  $resolved = Assert-RollbackAbsolutePublicationPath -Path $Authority.DestinationPath -Label $Authority.Label
  if (-not $resolved.ParentPath.Equals($Authority.ParentDirectoryPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$($Authority.Label) publication destination left its retained parent directory."
  }
  $parentHandleIdentity = Get-RollbackPathIdentity -Handle $Authority.ParentDirectoryHandle
  if ($parentHandleIdentity -cne $Authority.ParentDirectoryIdentity) {
    throw "$($Authority.Label) retained parent directory handle identity changed."
  }
  Assert-RollbackPathIdentity -Path $Authority.ParentDirectoryPath -ExpectedIdentity $parentHandleIdentity -Label "$($Authority.Label) parent directory" | Out-Null
  Assert-RollbackPathIdentity -Path $Authority.TemporaryPath -ExpectedIdentity $Authority.Identity -Label "$($Authority.Label) temporary publication" | Out-Null
  $Authority.Stream.Flush($true)
  $expectedLength = $Authority.Stream.Length
  $expectedSha256 = Get-RollbackFileAuthoritySha256 -Authority $Authority
  Invoke-RollbackHandleRename -Handle $Authority.Stream.SafeFileHandle -Path $Authority.DestinationPath -Label $Authority.Label
  $Authority.Renamed = $true
  $Authority.Path = $Authority.DestinationPath
  $Authority.Stream.Flush($true)
  if ($Authority.Stream.Length -ne $expectedLength -or (Get-RollbackFileAuthoritySha256 -Authority $Authority) -cne $expectedSha256) {
    throw "$($Authority.Label) bytes changed during handle-bound publication."
  }
  Assert-RollbackPathIdentity -Path $Authority.Path -ExpectedIdentity $Authority.Identity -Label $Authority.Label | Out-Null
  Flush-RollbackHandle -Handle $Authority.ParentDirectoryHandle -Label "$($Authority.Label) parent directory"
  Assert-RollbackPathIdentity -Path $Authority.ParentDirectoryPath -ExpectedIdentity $parentHandleIdentity -Label "$($Authority.Label) parent directory" | Out-Null
  Assert-RollbackPathIdentity -Path $Authority.Path -ExpectedIdentity $Authority.Identity -Label $Authority.Label | Out-Null
  $Authority.Published = $true
  return $Authority
}

function Remove-RollbackUnpublishedFileAuthority {
  param([Parameter(Mandatory = $true)][object]$Authority)
  if ($Authority.Renamed -eq $true -or $Authority.Published -eq $true) {
    throw "$($Authority.Label) published authority cannot be removed as an unpublished temporary."
  }
  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  $deleteDispositionSet = $false
  try {
    Assert-RollbackPathIdentity -Path $Authority.TemporaryPath -ExpectedIdentity $Authority.Identity -Label "$($Authority.Label) unpublished temporary" | Out-Null
    Set-RollbackHandleDeleteDisposition -Handle $Authority.Stream.SafeFileHandle -Label $Authority.Label
    $deleteDispositionSet = $true
  } catch { $primaryError = $_ }
  try { $Authority.Stream.Dispose() } catch { [void]$cleanupErrors.Add($_) }
  if ($Authority.OwnsParentDirectoryHandle -eq $true) {
    try { $Authority.ParentDirectoryHandle.Dispose() } catch { [void]$cleanupErrors.Add($_) }
  }
  if ($deleteDispositionSet) {
    $deleteWait = [System.Diagnostics.Stopwatch]::StartNew()
    while ([System.IO.File]::Exists($Authority.TemporaryPath) -and $deleteWait.ElapsedMilliseconds -lt 2000) {
      Start-Sleep -Milliseconds 10
    }
    if ([System.IO.File]::Exists($Authority.TemporaryPath)) {
      $deleteException = [System.InvalidOperationException]::new("$($Authority.Label) owned temporary did not disappear after handle disposition.")
      [void]$cleanupErrors.Add([System.Management.Automation.ErrorRecord]::new(
        $deleteException,
        'RollbackPublicationTemporaryRetained',
        [System.Management.Automation.ErrorCategory]::CloseError,
        $Authority.TemporaryPath
      ))
    }
  }
  if ($null -ne $primaryError) {
    if ($cleanupErrors.Count -gt 0) { $primaryError.Exception.Data['RollbackCleanupErrors'] = [object[]]@($cleanupErrors) }
    throw $primaryError
  }
  if ($cleanupErrors.Count -gt 0) {
    $messages = @($cleanupErrors | ForEach-Object { $_.Exception.Message })
    $cleanupException = [System.InvalidOperationException]::new("Rollback publication cleanup failed: $($messages -join ' | ')")
    $cleanupException.Data['RollbackCleanupErrors'] = [object[]]@($cleanupErrors)
    throw $cleanupException
  }
}

function Open-RollbackWritableDirectoryAuthority {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label,
    [AllowNull()][object]$ParentDirectoryAuthority = $null
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $resolved = Assert-RollbackAbsolutePublicationPath -Path $fullPath -Label $Label
  $information = Get-RollbackPathInformation -Path $fullPath -Label $Label
  if ((($information.Attributes -band [System.IO.FileAttributes]::Directory) -eq 0) -or
      (($information.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
    throw "$Label must be a real non-reparse directory."
  }
  $handle = $null
  $parentHandle = $null
  $parentIdentity = $null
  $ownsParentDirectoryHandle = $true
  try {
    if ($null -ne $ParentDirectoryAuthority) {
      foreach ($member in @('Path', 'Identity', 'Handle')) {
        if ($null -eq $ParentDirectoryAuthority.PSObject.Properties[$member]) {
          throw "$Label parent directory authority is missing $member."
        }
      }
      if ($ParentDirectoryAuthority.Path -isnot [string] -or
          -not ([System.IO.Path]::GetFullPath($ParentDirectoryAuthority.Path)).Equals($resolved.ParentPath, [StringComparison]::OrdinalIgnoreCase) -or
          $ParentDirectoryAuthority.Handle -isnot [Microsoft.Win32.SafeHandles.SafeFileHandle] -or
          $ParentDirectoryAuthority.Handle.IsInvalid -or
          $ParentDirectoryAuthority.Handle.IsClosed) {
        throw "$Label parent directory authority is invalid."
      }
      $parentHandle = $ParentDirectoryAuthority.Handle
      $parentIdentity = Get-RollbackPathIdentity -Handle $parentHandle
      if ($parentIdentity -cne $ParentDirectoryAuthority.Identity) {
        throw "$Label parent directory handle does not match its retained identity."
      }
      Assert-RollbackPathIdentity -Path $resolved.ParentPath -ExpectedIdentity $parentIdentity -Label "$Label parent directory" | Out-Null
      $fileSystemName = [LocalMiniDrama.Rollback.NativeMethods]::GetFileSystemName($parentHandle)
      if ($fileSystemName -cne 'NTFS' -and $fileSystemName -cne 'ReFS') {
        throw "$Label parent directory authority requires NTFS or ReFS."
      }
      $ownsParentDirectoryHandle = $false
    }
    $handle = Open-RollbackWritableDirectoryHandle -Path $fullPath -Label $Label
    if ($null -eq $parentHandle) {
      $parentHandle = Open-RollbackWritableDirectoryHandle -Path $resolved.ParentPath -Label "$Label parent"
      $parentIdentity = Get-RollbackPathIdentity -Handle $parentHandle
      Assert-RollbackPathIdentity -Path $resolved.ParentPath -ExpectedIdentity $parentIdentity -Label "$Label parent directory" | Out-Null
    }
    $identity = Get-RollbackPathIdentity -Handle $handle
    Assert-RollbackPathIdentity -Path $fullPath -ExpectedIdentity $identity -Label $Label | Out-Null
    return [pscustomobject][ordered]@{
      Path = $fullPath
      ParentDirectoryPath = $resolved.ParentPath
      ParentDirectoryIdentity = $parentIdentity
      Label = $Label
      Identity = $identity
      Handle = $handle
      ParentDirectoryHandle = $parentHandle
      OwnsParentDirectoryHandle = $ownsParentDirectoryHandle
      Published = $false
    }
  } catch {
    if ($null -ne $handle) { $handle.Dispose() }
    if ($ownsParentDirectoryHandle -and $null -ne $parentHandle) { $parentHandle.Dispose() }
    throw
  }
}

function Publish-RollbackDirectoryAuthority {
  param(
    [Parameter(Mandatory = $true)][object]$Authority,
    [Parameter(Mandatory = $true)][string]$Path
  )
  foreach ($member in @('Path', 'ParentDirectoryPath', 'ParentDirectoryIdentity', 'Label', 'Identity', 'Handle', 'ParentDirectoryHandle', 'OwnsParentDirectoryHandle', 'Published')) {
    if ($null -eq $Authority.PSObject.Properties[$member]) { throw "Rollback directory authority is missing $member." }
  }
  if ($Authority.Published -eq $true) { throw "$($Authority.Label) directory authority was already published." }
  $destinationPath = [System.IO.Path]::GetFullPath($Path)
  $resolved = Assert-RollbackAbsolutePublicationPath -Path $destinationPath -Label $Authority.Label
  if (-not $resolved.ParentPath.Equals($Authority.ParentDirectoryPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$($Authority.Label) directory publication left its retained parent."
  }
  $parentHandleIdentity = Get-RollbackPathIdentity -Handle $Authority.ParentDirectoryHandle
  if ($parentHandleIdentity -cne $Authority.ParentDirectoryIdentity) {
    throw "$($Authority.Label) retained parent directory handle identity changed."
  }
  Assert-RollbackPathIdentity -Path $Authority.ParentDirectoryPath -ExpectedIdentity $parentHandleIdentity -Label "$($Authority.Label) parent directory" | Out-Null
  Assert-RollbackPathIdentity -Path $Authority.Path -ExpectedIdentity $Authority.Identity -Label $Authority.Label | Out-Null
  Flush-RollbackHandle -Handle $Authority.Handle -Label $Authority.Label
  $incompletePath = $Authority.Path
  Invoke-RollbackHandleRename -Handle $Authority.Handle -Path $destinationPath -Label $Authority.Label
  $Authority.Path = $destinationPath
  try {
    Flush-RollbackHandle -Handle $Authority.Handle -Label $Authority.Label
    Flush-RollbackHandle -Handle $Authority.ParentDirectoryHandle -Label "$($Authority.Label) parent directory"
    Assert-RollbackPathIdentity -Path $Authority.ParentDirectoryPath -ExpectedIdentity $parentHandleIdentity -Label "$($Authority.Label) parent directory" | Out-Null
    Assert-RollbackPathIdentity -Path $Authority.Path -ExpectedIdentity $Authority.Identity -Label $Authority.Label | Out-Null
  } catch {
    $primaryError = $_
    $cleanupErrors = [System.Collections.ArrayList]::new()
    try {
      Invoke-RollbackHandleRename -Handle $Authority.Handle -Path $incompletePath -Label "$($Authority.Label) incomplete retention"
      $Authority.Path = $incompletePath
      Assert-RollbackPathIdentity -Path $Authority.Path -ExpectedIdentity $Authority.Identity -Label $Authority.Label | Out-Null
    } catch { [void]$cleanupErrors.Add($_) }
    try { Flush-RollbackHandle -Handle $Authority.Handle -Label "$($Authority.Label) retained incomplete directory" } catch { [void]$cleanupErrors.Add($_) }
    try { Flush-RollbackHandle -Handle $Authority.ParentDirectoryHandle -Label "$($Authority.Label) retained incomplete parent" } catch { [void]$cleanupErrors.Add($_) }
    if ($cleanupErrors.Count -gt 0) { $primaryError.Exception.Data['RollbackCleanupErrors'] = [object[]]@($cleanupErrors) }
    throw $primaryError
  }
  $Authority.Published = $true
  return $Authority
}

function Open-RollbackDirectoryIdentityLock {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Label = 'Rollback data root'
  )
  $handle = $null
  try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $information = Get-RollbackPathInformation -Path $fullPath -Label $Label
    if ((($information.Attributes -band [System.IO.FileAttributes]::Directory) -eq 0) -or
        (($information.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw "$Label must be a real non-reparse directory: $fullPath"
    }
    Initialize-RollbackPathNative
    # FILE_LIST_DIRECTORY is the narrowest access that makes the no-delete share effective for directories.
    $fileListDirectory = [uint32]1
    $fileShareReadWrite = [uint32]3
    $openExisting = [uint32]3
    $backupSemantics = [uint32]0x02000000
    $openReparsePoint = [uint32]0x00200000
    $handle = [LocalMiniDrama.Rollback.NativeMethods]::CreateFileW(
      [LocalMiniDrama.Rollback.NativeMethods]::ToExtendedPath($fullPath),
      $fileListDirectory,
      $fileShareReadWrite,
      [IntPtr]::Zero,
      $openExisting,
      ($backupSemantics -bor $openReparsePoint),
      [IntPtr]::Zero
    )
    if ($null -eq $handle -or $handle.IsInvalid) {
      $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      if ($null -ne $handle) { $handle.Dispose() }
      $handle = $null
      throw [ComponentModel.Win32Exception]::new($errorCode, "Could not open $Label directory identity lock: $fullPath")
    }
    $information = Get-RollbackHandleInformation -Handle $handle
    if ((($information.Attributes -band [System.IO.FileAttributes]::Directory) -eq 0) -or
        (($information.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) {
      throw "$Label retained handle must refer to a real non-reparse directory: $fullPath"
    }
    Assert-RollbackPathIdentity -Path $fullPath -ExpectedIdentity $information.Identity -Label $Label | Out-Null
    return $handle
  } catch {
    if ($null -ne $handle) { $handle.Dispose() }
    throw
  }
}
