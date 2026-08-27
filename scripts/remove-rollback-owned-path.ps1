[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{8}:[a-f0-9]{16}$')]
  [string]$ExpectedIdentity,
  [Parameter(Mandatory = $true)]
  [ValidateSet('file', 'directory')]
  [string]$ExpectedType,
  [ValidateRange(1, 1600001)][int]$MaximumEntries = 1600001,
  [ValidateRange(1, 300000)][int]$TimeoutMilliseconds = 120000
)

$ErrorActionPreference = 'Stop'

if ($null -eq ('LocalMiniDrama.RollbackOwnedPathDeletion' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace LocalMiniDrama
{
    public static class RollbackOwnedPathDeletion
    {
        const uint DELETE = 0x00010000;
        const uint FILE_READ_ATTRIBUTES = 0x00000080;
        const uint FILE_SHARE_READ = 0x00000001;
        const uint FILE_SHARE_WRITE = 0x00000002;
        const uint OPEN_EXISTING = 3;
        const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
        const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
        const int FileDispositionInfoEx = 21;
        const int FILE_DISPOSITION_FLAG_DELETE = 0x00000001;
        const int FILE_DISPOSITION_FLAG_POSIX_SEMANTICS = 0x00000002;
        const int FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE = 0x00000010;

        [StructLayout(LayoutKind.Sequential)]
        struct NativeFileTime
        {
            public uint Low;
            public uint High;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ByHandleFileInformation
        {
            public uint FileAttributes;
            public NativeFileTime CreationTime;
            public NativeFileTime LastAccessTime;
            public NativeFileTime LastWriteTime;
            public uint VolumeSerialNumber;
            public uint FileSizeHigh;
            public uint FileSizeLow;
            public uint NumberOfLinks;
            public uint FileIndexHigh;
            public uint FileIndexLow;
        }

        sealed class DeleteState
        {
            public readonly Stopwatch Stopwatch = Stopwatch.StartNew();
            public readonly int TimeoutMilliseconds;
            public readonly int MaximumEntries;
            public int Entries;

            public DeleteState(int maximumEntries, int timeoutMilliseconds)
            {
                MaximumEntries = maximumEntries;
                TimeoutMilliseconds = timeoutMilliseconds;
            }

            public void BeforeEntry()
            {
                if (Stopwatch.ElapsedMilliseconds >= TimeoutMilliseconds)
                    throw new TimeoutException("Rollback owned-path cleanup exceeded its deadline.");
                Entries += 1;
                if (Entries > MaximumEntries)
                    throw new InvalidOperationException("Rollback owned-path cleanup exceeded its entry limit.");
            }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFileW(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetFileInformationByHandle(
            SafeFileHandle file,
            out ByHandleFileInformation information);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool SetFileInformationByHandle(
            SafeFileHandle file,
            int informationClass,
            IntPtr information,
            uint bufferSize);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetVolumePathNameW(
            string fileName,
            StringBuilder volumePathName,
            uint bufferLength);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool GetVolumeInformationW(
            string rootPathName,
            StringBuilder volumeNameBuffer,
            uint volumeNameSize,
            out uint volumeSerialNumber,
            out uint maximumComponentLength,
            out uint fileSystemFlags,
            StringBuilder fileSystemNameBuffer,
            uint fileSystemNameSize);

        static string ExtendedPath(string path)
        {
            if (string.IsNullOrEmpty(path))
                throw new ArgumentException("Rollback path is required.", "path");
            if (path.StartsWith(@"\\?\", StringComparison.Ordinal))
                return path;
            string full = Path.GetFullPath(path);
            if (full.StartsWith(@"\\", StringComparison.Ordinal))
                return @"\\?\UNC\" + full.Substring(2);
            return @"\\?\" + full;
        }

        static Win32Exception LastError(string operation, string path)
        {
            int error = Marshal.GetLastWin32Error();
            return new Win32Exception(error, operation + " failed for rollback path " + path + ".");
        }

        static SafeFileHandle OpenLocked(string path)
        {
            SafeFileHandle handle = CreateFileW(
                ExtendedPath(path),
                DELETE | FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                IntPtr.Zero,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                IntPtr.Zero);
            if (handle == null || handle.IsInvalid)
            {
                if (handle != null) handle.Dispose();
                throw LastError("CreateFileW", path);
            }
            return handle;
        }

        static ByHandleFileInformation Information(SafeFileHandle handle, string path)
        {
            ByHandleFileInformation information;
            if (!GetFileInformationByHandle(handle, out information))
                throw LastError("GetFileInformationByHandle", path);
            return information;
        }

        static string Identity(ByHandleFileInformation information)
        {
            ulong fileIndex = ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
            return information.VolumeSerialNumber.ToString("x8", CultureInfo.InvariantCulture) + ":" +
                fileIndex.ToString("x16", CultureInfo.InvariantCulture);
        }

        static bool IsDirectory(ByHandleFileInformation information)
        {
            return (((FileAttributes)information.FileAttributes) & FileAttributes.Directory) != 0;
        }

        static bool IsReparsePoint(ByHandleFileInformation information)
        {
            return (((FileAttributes)information.FileAttributes) & FileAttributes.ReparsePoint) != 0;
        }

        static void AssertSupportedFileSystem(string path)
        {
            StringBuilder volumePath = new StringBuilder(1024);
            if (!GetVolumePathNameW(ExtendedPath(path), volumePath, (uint)volumePath.Capacity))
                throw LastError("GetVolumePathNameW", path);
            StringBuilder fileSystem = new StringBuilder(64);
            uint serial, maximumComponentLength, flags;
            if (!GetVolumeInformationW(
                volumePath.ToString(),
                null,
                0,
                out serial,
                out maximumComponentLength,
                out flags,
                fileSystem,
                (uint)fileSystem.Capacity))
                throw LastError("GetVolumeInformationW", path);
            string name = fileSystem.ToString();
            if (!String.Equals(name, "NTFS", StringComparison.OrdinalIgnoreCase) &&
                !String.Equals(name, "ReFS", StringComparison.OrdinalIgnoreCase))
                throw new NotSupportedException("Rollback handle-bound cleanup requires NTFS or ReFS; found " + name + ".");
        }

        static void MarkDeleted(SafeFileHandle handle, string path)
        {
            IntPtr buffer = Marshal.AllocHGlobal(sizeof(int));
            try
            {
                Marshal.WriteInt32(
                    buffer,
                    FILE_DISPOSITION_FLAG_DELETE |
                    FILE_DISPOSITION_FLAG_POSIX_SEMANTICS |
                    FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE);
                if (!SetFileInformationByHandle(handle, FileDispositionInfoEx, buffer, sizeof(int)))
                    throw LastError("SetFileInformationByHandle(FileDispositionInfoEx)", path);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        static void DeleteEntry(string path, DeleteState state)
        {
            state.BeforeEntry();
            using (SafeFileHandle handle = OpenLocked(path))
            {
                ByHandleFileInformation information = Information(handle, path);
                if (IsDirectory(information) && !IsReparsePoint(information))
                    DeleteChildren(path, state);
                MarkDeleted(handle, path);
            }
        }

        static void DeleteChildren(string directoryPath, DeleteState state)
        {
            while (true)
            {
                if (state.Stopwatch.ElapsedMilliseconds >= state.TimeoutMilliseconds)
                    throw new TimeoutException("Rollback owned-path cleanup exceeded its deadline.");
                string[] entries = Directory.GetFileSystemEntries(ExtendedPath(directoryPath));
                if (entries.Length == 0) return;
                foreach (string entry in entries) DeleteEntry(entry, state);
            }
        }

        public static void Remove(
            string path,
            string expectedIdentity,
            bool expectedDirectory,
            int maximumEntries,
            int timeoutMilliseconds)
        {
            string fullPath = Path.GetFullPath(path);
            AssertSupportedFileSystem(fullPath);
            DeleteState state = new DeleteState(maximumEntries, timeoutMilliseconds);
            using (SafeFileHandle handle = OpenLocked(fullPath))
            {
                ByHandleFileInformation information = Information(handle, fullPath);
                string actualIdentity = Identity(information);
                if (!String.Equals(actualIdentity, expectedIdentity, StringComparison.Ordinal))
                    throw new InvalidOperationException("Rollback owned-path identity no longer matches the retained filesystem object.");
                if (IsReparsePoint(information) || IsDirectory(information) != expectedDirectory)
                    throw new InvalidOperationException("Rollback owned-path type no longer matches the retained filesystem object.");
                if (expectedDirectory) DeleteChildren(fullPath, state);
                MarkDeleted(handle, fullPath);
            }
        }
    }
}
'@ -ErrorAction Stop
}

[LocalMiniDrama.RollbackOwnedPathDeletion]::Remove(
  [System.IO.Path]::GetFullPath($Path),
  $ExpectedIdentity,
  ($ExpectedType -ceq 'directory'),
  $MaximumEntries,
  $TimeoutMilliseconds
)
