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

function Close-RollbackFilePublicationAuthority {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][object]$Authority)

  $cleanupErrors = [System.Collections.ArrayList]::new()
  try {
    if ($null -ne $Authority.PSObject.Properties['Stream'] -and $null -ne $Authority.Stream) {
      $Authority.Stream.Dispose()
    }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $Authority.PSObject.Properties['ParentDirectoryHandle'] -and
        $null -ne $Authority.ParentDirectoryHandle -and
        ($null -eq $Authority.PSObject.Properties['OwnsParentDirectoryHandle'] -or $Authority.OwnsParentDirectoryHandle -eq $true)) {
      $Authority.ParentDirectoryHandle.Dispose()
    }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  Complete-RollbackInvocation -PrimaryError $null -CleanupErrors $cleanupErrors
}

function Close-RollbackWritableDirectoryAuthority {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][object]$Authority)

  $cleanupErrors = [System.Collections.ArrayList]::new()
  try {
    if ($null -ne $Authority.PSObject.Properties['ParentDirectoryHandle'] -and $null -ne $Authority.ParentDirectoryHandle) {
      if ($null -eq $Authority.PSObject.Properties['OwnsParentDirectoryHandle'] -or $Authority.OwnsParentDirectoryHandle -eq $true) {
        $Authority.ParentDirectoryHandle.Dispose()
      }
    }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $Authority.PSObject.Properties['Handle'] -and $null -ne $Authority.Handle) {
      $Authority.Handle.Dispose()
    }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  Complete-RollbackInvocation -PrimaryError $null -CleanupErrors $cleanupErrors
}

function Remove-RollbackFailedFilePublicationAuthority {
  [CmdletBinding()]
  param([Parameter(Mandatory = $true)][object]$Authority)

  foreach ($member in @('Path', 'Label', 'Identity', 'Stream', 'ParentDirectoryHandle', 'OwnsParentDirectoryHandle', 'Renamed', 'Published')) {
    if ($null -eq $Authority.PSObject.Properties[$member]) {
      throw "Rollback failed publication authority is missing $member."
    }
  }
  if ($Authority.Renamed -ne $true -or $Authority.Published -eq $true) {
    throw "$($Authority.Label) failed publication cleanup requires a renamed, unpublished authority."
  }

  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  $deleteDispositionSet = $false
  try {
    Assert-RollbackPathIdentity -Path $Authority.Path -ExpectedIdentity $Authority.Identity -Label "$($Authority.Label) failed publication" | Out-Null
    Set-RollbackHandleDeleteDisposition -Handle $Authority.Stream.SafeFileHandle -Label $Authority.Label
    $deleteDispositionSet = $true
  } catch {
    $primaryError = $_
  }
  try { $Authority.Stream.Dispose() } catch { [void]$cleanupErrors.Add($_) }
  if ($deleteDispositionSet) {
    try {
      $deleteWait = [System.Diagnostics.Stopwatch]::StartNew()
      while ((Test-RollbackPathExists -Path $Authority.Path) -and $deleteWait.ElapsedMilliseconds -lt 2000) {
        Start-Sleep -Milliseconds 10
      }
      if (Test-RollbackPathExists -Path $Authority.Path) {
        throw "$($Authority.Label) failed publication did not disappear after handle disposition."
      }
    } catch { [void]$cleanupErrors.Add($_) }
    try {
      Flush-RollbackHandle -Handle $Authority.ParentDirectoryHandle -Label "$($Authority.Label) failed publication parent directory"
    } catch { [void]$cleanupErrors.Add($_) }
  }
  if ($Authority.OwnsParentDirectoryHandle -eq $true) {
    try { $Authority.ParentDirectoryHandle.Dispose() } catch { [void]$cleanupErrors.Add($_) }
  }
  Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
}

function Publish-RollbackUtf8FileAtomically {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value,
    [string]$Label = 'Rollback UTF-8 record',
    [AllowNull()][object]$ParentDirectoryAuthority = $null,
    [switch]$RemoveOnPublicationFailure
  )

  $authority = $null
  $result = $null
  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  try {
    $authority = New-RollbackFilePublicationAuthority -Path $Path -Label $Label -ParentDirectoryAuthority $ParentDirectoryAuthority
    $bytes = [System.Text.UTF8Encoding]::new($false, $true).GetBytes($Value)
    $authority.Stream.Write($bytes, 0, $bytes.Length)
    $authority.Stream.Flush($true)
    $result = Publish-RollbackFileAuthority -Authority $authority
  } catch {
    $primaryError = $_
  } finally {
    if ($null -ne $primaryError -and $null -ne $authority) {
      if ($authority.Published -eq $true) {
        try { Close-RollbackFilePublicationAuthority -Authority $authority } catch { [void]$cleanupErrors.Add($_) }
      } elseif ($authority.Renamed -eq $true -and $RemoveOnPublicationFailure) {
        try { Remove-RollbackFailedFilePublicationAuthority -Authority $authority } catch { [void]$cleanupErrors.Add($_) }
      } elseif ($authority.Renamed -eq $true) {
        try { Close-RollbackFilePublicationAuthority -Authority $authority } catch { [void]$cleanupErrors.Add($_) }
      } else {
        try { Remove-RollbackUnpublishedFileAuthority -Authority $authority } catch { [void]$cleanupErrors.Add($_) }
      }
    }
  }
  Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
  return $result
}

function Initialize-RollbackDescriptorProcessNative {
  if ($null -ne ([System.Management.Automation.PSTypeName]'LocalMiniDrama.Rollback.DescriptorProcessLauncher').Type) {
    return
  }

  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace LocalMiniDrama.Rollback
{
    public sealed class DescriptorBackupProcess : IDisposable
    {
        public SafeFileHandle Job;
        public SafeFileHandle Process;
        public SafeFileHandle MachineRead;
        public Int32 ProcessId;

        public void Dispose()
        {
            if (MachineRead != null) MachineRead.Dispose();
            if (Process != null) Process.Dispose();
            if (Job != null) Job.Dispose();
        }
    }

    public static class DescriptorProcessLauncher
    {
        const UInt32 CREATE_SUSPENDED = 0x00000004;
        const UInt32 EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
        const UInt32 CREATE_NO_WINDOW = 0x08000000;
        const UInt32 STARTF_USESTDHANDLES = 0x00000100;
        const UInt32 HANDLE_FLAG_INHERIT = 0x00000001;
        const UInt32 DUPLICATE_SAME_ACCESS = 0x00000002;
        const UInt32 JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        const UInt32 ERROR_CANCELLED = 1223;
        const UInt32 WAIT_OBJECT_0 = 0;
        const UInt32 WAIT_TIMEOUT = 258;
        const UInt32 PROC_THREAD_ATTRIBUTE_HANDLE_LIST = 0x00020002;
        const Int32 JobObjectBasicAccountingInformation = 1;
        const Int32 JobObjectExtendedLimitInformation = 9;

        [StructLayout(LayoutKind.Sequential)]
        struct SECURITY_ATTRIBUTES
        {
            public Int32 nLength;
            public IntPtr lpSecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)] public Boolean bInheritHandle;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct STARTUPINFO
        {
            public Int32 cb;
            public IntPtr lpReserved;
            public IntPtr lpDesktop;
            public IntPtr lpTitle;
            public Int32 dwX;
            public Int32 dwY;
            public Int32 dwXSize;
            public Int32 dwYSize;
            public Int32 dwXCountChars;
            public Int32 dwYCountChars;
            public Int32 dwFillAttribute;
            public UInt32 dwFlags;
            public Int16 wShowWindow;
            public Int16 cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct STARTUPINFOEX
        {
            public STARTUPINFO StartupInfo;
            public IntPtr lpAttributeList;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public Int32 dwProcessId;
            public Int32 dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public Int64 PerProcessUserTimeLimit;
            public Int64 PerJobUserTimeLimit;
            public UInt32 LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public UInt32 ActiveProcessLimit;
            public UIntPtr Affinity;
            public UInt32 PriorityClass;
            public UInt32 SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IO_COUNTERS
        {
            public UInt64 ReadOperationCount;
            public UInt64 WriteOperationCount;
            public UInt64 OtherOperationCount;
            public UInt64 ReadTransferCount;
            public UInt64 WriteTransferCount;
            public UInt64 OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
        {
            public Int64 TotalUserTime;
            public Int64 TotalKernelTime;
            public Int64 ThisPeriodTotalUserTime;
            public Int64 ThisPeriodTotalKernelTime;
            public UInt32 TotalPageFaultCount;
            public UInt32 TotalProcesses;
            public UInt32 ActiveProcesses;
            public UInt32 TotalTerminatedProcesses;
        }

        [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean DuplicateHandle(IntPtr sourceProcess, IntPtr sourceHandle, IntPtr targetProcess, out IntPtr targetHandle, UInt32 access, [MarshalAs(UnmanagedType.Bool)] Boolean inheritHandle, UInt32 options);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SECURITY_ATTRIBUTES attributes, UInt32 size);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean SetHandleInformation(IntPtr handle, UInt32 mask, UInt32 flags);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean InitializeProcThreadAttributeList(IntPtr list, Int32 count, UInt32 flags, ref UIntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean UpdateProcThreadAttribute(IntPtr list, UInt32 flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);
        [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean CreateProcess(String applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] Boolean inheritHandles, UInt32 creationFlags, IntPtr environment, String currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, String name);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean SetInformationJobObject(IntPtr job, Int32 informationClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information, Int32 length);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError = true)] static extern UInt32 ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean TerminateProcess(IntPtr process, UInt32 exitCode);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean TerminateJobObject(IntPtr job, UInt32 exitCode);
        [DllImport("kernel32.dll", SetLastError = true)] static extern UInt32 WaitForSingleObject(IntPtr handle, UInt32 milliseconds);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean GetExitCodeProcess(IntPtr process, out UInt32 exitCode);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean QueryInformationJobObject(IntPtr job, Int32 informationClass, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information, Int32 length, IntPtr returnLength);
        [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
        static extern Boolean CloseHandle(IntPtr handle);

        static Win32Exception LastError(String operation)
        {
            Int32 error = Marshal.GetLastWin32Error();
            return new Win32Exception(error, operation + " failed (Win32 error " + error + ").");
        }

        static void CloseRaw(ref IntPtr handle)
        {
            if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return;
            CloseHandle(handle);
            handle = IntPtr.Zero;
        }

        public static DescriptorBackupProcess Start(String applicationName, String commandLine, String currentDirectory, SafeFileHandle archiveHandle)
        {
            if (archiveHandle == null || archiveHandle.IsInvalid || archiveHandle.IsClosed) throw new ArgumentException("An open archive handle is required.", "archiveHandle");
            DescriptorBackupProcess result = new DescriptorBackupProcess();
            IntPtr childInput = IntPtr.Zero;
            IntPtr childOutput = IntPtr.Zero;
            IntPtr machineRead = IntPtr.Zero;
            IntPtr machineWrite = IntPtr.Zero;
            IntPtr handleList = IntPtr.Zero;
            IntPtr attributeList = IntPtr.Zero;
            IntPtr job = IntPtr.Zero;
            IntPtr process = IntPtr.Zero;
            IntPtr thread = IntPtr.Zero;
            Boolean assignedToJob = false;
            Int32 processId = 0;
            try
            {
                IntPtr currentProcess = GetCurrentProcess();
                if (!DuplicateHandle(currentProcess, archiveHandle.DangerousGetHandle(), currentProcess, out childInput, 0, true, DUPLICATE_SAME_ACCESS)) throw LastError("DuplicateHandle(stdin)");
                if (!DuplicateHandle(currentProcess, archiveHandle.DangerousGetHandle(), currentProcess, out childOutput, 0, true, DUPLICATE_SAME_ACCESS)) throw LastError("DuplicateHandle(stdout)");

                SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES();
                attributes.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
                attributes.bInheritHandle = true;
                if (!CreatePipe(out machineRead, out machineWrite, ref attributes, 4096)) throw LastError("CreatePipe(machine result)");
                if (!SetHandleInformation(machineRead, HANDLE_FLAG_INHERIT, 0)) throw LastError("SetHandleInformation(machine read)");

                UIntPtr attributeBytes = UIntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeBytes);
                if (attributeBytes == UIntPtr.Zero || attributeBytes.ToUInt64() > Int32.MaxValue) throw LastError("InitializeProcThreadAttributeList(size)");
                attributeList = Marshal.AllocHGlobal((Int32)attributeBytes.ToUInt64());
                if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeBytes)) throw LastError("InitializeProcThreadAttributeList");
                handleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
                Marshal.WriteIntPtr(handleList, 0, childInput);
                Marshal.WriteIntPtr(handleList, IntPtr.Size, childOutput);
                Marshal.WriteIntPtr(handleList, IntPtr.Size * 2, machineWrite);
                if (!UpdateProcThreadAttribute(attributeList, 0, new IntPtr((Int64)PROC_THREAD_ATTRIBUTE_HANDLE_LIST), handleList, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero)) throw LastError("UpdateProcThreadAttribute(PROC_THREAD_ATTRIBUTE_HANDLE_LIST)");

                job = CreateJobObject(IntPtr.Zero, null);
                if (job == IntPtr.Zero) throw LastError("CreateJobObjectW");
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)))) throw LastError("SetInformationJobObject");

                STARTUPINFOEX startup = new STARTUPINFOEX();
                startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
                startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
                startup.StartupInfo.hStdInput = childInput;
                startup.StartupInfo.hStdOutput = childOutput;
                startup.StartupInfo.hStdError = machineWrite;
                startup.lpAttributeList = attributeList;
                PROCESS_INFORMATION information;
                StringBuilder mutableCommandLine = new StringBuilder(commandLine);
                if (!CreateProcess(applicationName, mutableCommandLine, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, currentDirectory, ref startup, out information)) throw LastError("CreateProcessW");
                process = information.hProcess;
                thread = information.hThread;
                processId = information.dwProcessId;
                CloseRaw(ref childInput);
                CloseRaw(ref childOutput);
                CloseRaw(ref machineWrite);

                if (!AssignProcessToJobObject(job, process)) throw LastError("AssignProcessToJobObject");
                assignedToJob = true;
                if (ResumeThread(thread) == 0xffffffff) throw LastError("ResumeThread");
                CloseRaw(ref thread);

                result.Job = new SafeFileHandle(job, true);
                job = IntPtr.Zero;
                result.Process = new SafeFileHandle(process, true);
                process = IntPtr.Zero;
                result.MachineRead = new SafeFileHandle(machineRead, true);
                machineRead = IntPtr.Zero;
                result.ProcessId = processId;
                return result;
            }
            catch (Exception primaryError)
            {
                if (processId > 0) primaryError.Data["NativeProcessId"] = processId;
                if (assignedToJob && job != IntPtr.Zero) TerminateJobObject(job, ERROR_CANCELLED);
                if (!assignedToJob && process != IntPtr.Zero)
                {
                    TerminateProcess(process, ERROR_CANCELLED);
                    WaitForSingleObject(process, 2000);
                }
                result.Dispose();
                throw;
            }
            finally
            {
                if (attributeList != IntPtr.Zero) DeleteProcThreadAttributeList(attributeList);
                if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
                if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
                CloseRaw(ref childInput);
                CloseRaw(ref childOutput);
                CloseRaw(ref machineRead);
                CloseRaw(ref machineWrite);
                CloseRaw(ref thread);
                CloseRaw(ref process);
                CloseRaw(ref job);
            }
        }

        public static Boolean HasExited(DescriptorBackupProcess process)
        {
            return WaitForSingleObject(process.Process.DangerousGetHandle(), 0) == WAIT_OBJECT_0;
        }

        public static Int32 ExitCode(DescriptorBackupProcess process)
        {
            UInt32 code;
            if (!GetExitCodeProcess(process.Process.DangerousGetHandle(), out code)) throw LastError("GetExitCodeProcess");
            return unchecked((Int32)code);
        }

        public static Boolean WaitForNoActiveProcesses(DescriptorBackupProcess process, Int32 timeoutMilliseconds, out String detail)
        {
            Stopwatch stopwatch = Stopwatch.StartNew();
            do
            {
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
                if (!QueryInformationJobObject(process.Job.DangerousGetHandle(), JobObjectBasicAccountingInformation, out accounting, Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero))
                {
                    detail = LastError("QueryInformationJobObject").Message;
                    return false;
                }
                if (accounting.ActiveProcesses == 0)
                {
                    detail = "Job has no active processes.";
                    return true;
                }
                System.Threading.Thread.Sleep(10);
            }
            while (stopwatch.ElapsedMilliseconds < timeoutMilliseconds);
            detail = "Job descendants did not exit within the bounded wait.";
            return false;
        }

        public static Boolean TerminateAndWait(DescriptorBackupProcess process, Int32 timeoutMilliseconds, out String detail)
        {
            if (!TerminateJobObject(process.Job.DangerousGetHandle(), ERROR_CANCELLED))
            {
                detail = LastError("TerminateJobObject").Message;
                return false;
            }
            return WaitForNoActiveProcesses(process, timeoutMilliseconds, out detail);
        }
    }
}
'@ -ErrorAction Stop
}

function ConvertTo-RollbackWindowsCommandLineArgument {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Argument)
  if ($Argument.Length -gt 0 -and $Argument -cnotmatch '[\s"]') { return $Argument }
  $builder = [System.Text.StringBuilder]::new()
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($character in $Argument.ToCharArray()) {
    if ($character -eq '\') {
      $backslashes += 1
      continue
    }
    if ($character -eq '"') {
      if ($backslashes -gt 0) { [void]$builder.Append((('\' * (($backslashes * 2) + 1)) -join '')) }
      else { [void]$builder.Append('\') }
      [void]$builder.Append('"')
    } else {
      if ($backslashes -gt 0) { [void]$builder.Append((('\' * $backslashes) -join '')) }
      [void]$builder.Append($character)
    }
    $backslashes = 0
  }
  if ($backslashes -gt 0) { [void]$builder.Append((('\' * ($backslashes * 2)) -join '')) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Resolve-RollbackDescriptorExecutable {
  param([Parameter(Mandatory = $true)][string]$FilePath)
  $candidate = $FilePath
  if (-not [System.IO.Path]::IsPathRooted($candidate)) {
    $command = Get-Command -Name $candidate -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $candidate = if (-not [string]::IsNullOrWhiteSpace([string]$command.Path)) { [string]$command.Path } else { [string]$command.Source }
  }
  $resolved = [System.IO.Path]::GetFullPath($candidate)
  if (-not [System.IO.File]::Exists($resolved)) { throw "Descriptor backup executable does not exist: $resolved" }
  return $resolved
}

function Start-RollbackDescriptorProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][Microsoft.Win32.SafeHandles.SafeFileHandle]$ArchiveHandle
  )
  Initialize-RollbackDescriptorProcessNative
  $executable = Resolve-RollbackDescriptorExecutable -FilePath $FilePath
  $commandLine = ((@($executable) + @($ArgumentList) | ForEach-Object {
    ConvertTo-RollbackWindowsCommandLineArgument -Argument ([string]$_)
  }) -join ' ')
  return [LocalMiniDrama.Rollback.DescriptorProcessLauncher]::Start(
    $executable,
    $commandLine,
    [System.IO.Path]::GetFullPath($WorkingDirectory),
    $ArchiveHandle
  )
}

function Read-RollbackMachineChannelRecord {
  param(
    [Parameter(Mandatory = $true)][System.IO.FileStream]$Stream,
    [Parameter(Mandatory = $true)][object]$State,
    [Parameter(Mandatory = $true)][System.Diagnostics.Stopwatch]$Stopwatch,
    [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$TimeoutMilliseconds,
    [Parameter(Mandatory = $true)][string]$Label
  )
  while ($Stopwatch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
    $newlineIndex = [Array]::IndexOf($State.Pending, [byte]10)
    if ($newlineIndex -ge 0) {
      if (($newlineIndex + 1) -gt 1024) { throw "$Label machine result line exceeded 1024 bytes." }
      $lineBytes = [byte[]]::new($newlineIndex)
      if ($newlineIndex -gt 0) { [Array]::Copy($State.Pending, 0, $lineBytes, 0, $newlineIndex) }
      $remainingCount = $State.Pending.Length - $newlineIndex - 1
      $remaining = [byte[]]::new($remainingCount)
      if ($remainingCount -gt 0) { [Array]::Copy($State.Pending, $newlineIndex + 1, $remaining, 0, $remainingCount) }
      $State.Pending = $remaining
      $encoding = [System.Text.UTF8Encoding]::new($false, $true)
      try { $line = $encoding.GetString($lineBytes) } catch { throw "$Label machine result was not strict UTF-8." }
      return [pscustomobject][ordered]@{ EndOfStream = $false; Line = $line }
    }
    if ($State.Pending.Length -ge 1024) { throw "$Label machine result line exceeded 1024 bytes." }
    if ($State.Ended -eq $true) {
      if ($State.Pending.Length -ne 0) { throw "$Label machine result ended with an unterminated line." }
      return [pscustomobject][ordered]@{ EndOfStream = $true; Line = $null }
    }
    if ($null -eq $State.ReadTask) {
      $State.ReadBuffer = [byte[]]::new(256)
      $State.ReadTask = $Stream.ReadAsync($State.ReadBuffer, 0, $State.ReadBuffer.Length)
    }
    if ($State.ReadTask.IsCompleted) {
      $readCount = [int]$State.ReadTask.GetAwaiter().GetResult()
      $State.ReadTask = $null
      if ($readCount -eq 0) {
        $State.Ended = $true
      } else {
        $combined = [byte[]]::new($State.Pending.Length + $readCount)
        if ($State.Pending.Length -gt 0) { [Array]::Copy($State.Pending, 0, $combined, 0, $State.Pending.Length) }
        [Array]::Copy($State.ReadBuffer, 0, $combined, $State.Pending.Length, $readCount)
        $State.Pending = $combined
      }
      continue
    }
    Start-Sleep -Milliseconds 10
  }
  throw [System.TimeoutException]::new("$Label machine result timed out after $TimeoutMilliseconds milliseconds.")
}

function ConvertFrom-RollbackBackupPublicationMarker {
  param(
    [Parameter(Mandatory = $true)][string]$Line,
    [Parameter(Mandatory = $true)][string]$ExpectedOperationId,
    [Parameter(Mandatory = $true)][ValidateSet('ready', 'committed')][string]$ExpectedPhase,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Line.Length -eq 0 -or $Line.Length -gt 1023 -or $Line -match '[^\x20-\x7e]') {
    throw "$Label machine result is not bounded canonical ASCII JSON."
  }
  try { $marker = ConvertFrom-Json -InputObject $Line } catch { throw "$Label machine result is not valid JSON." }
  if ($marker -isnot [System.Management.Automation.PSCustomObject]) { throw "$Label machine result must be an object." }
  $expectedNames = @('schema', 'operation_id', 'phase', 'publication_file', 'archive_sha256', 'archive_bytes', 'filesystem_identity', 'format_version')
  $properties = @($marker.PSObject.Properties)
  if ($properties.Count -ne $expectedNames.Count) { throw "$Label machine result field set is invalid." }
  for ($index = 0; $index -lt $expectedNames.Count; $index += 1) {
    if ($properties[$index].Name -cne $expectedNames[$index]) { throw "$Label machine result fields are not canonical." }
  }
  foreach ($name in $expectedNames[0..6]) {
    if ($marker.$name -isnot [string]) { throw "$Label machine result $name must be a string." }
  }
  if ($marker.schema -cne 'localminidrama.backup-publication-result.v1' -or
      $marker.operation_id -cne $ExpectedOperationId -or
      $marker.phase -cne $ExpectedPhase -or
      $marker.publication_file -cne 'data.zip' -or
      $marker.archive_sha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $marker.archive_bytes -cnotmatch '^(?:0|[1-9][0-9]*)$' -or
      $marker.filesystem_identity -cnotmatch '^[a-f0-9]{8}:[a-f0-9]{16}$') {
    throw "$Label machine result values are invalid."
  }
  if (($marker.format_version -isnot [int] -and $marker.format_version -isnot [long]) -or $marker.format_version -ne 2) {
    throw "$Label machine result format version is invalid."
  }
  $archiveBytes = [long]0
  if (-not [long]::TryParse($marker.archive_bytes, [Globalization.NumberStyles]::None, [Globalization.CultureInfo]::InvariantCulture, [ref]$archiveBytes) -or $archiveBytes -le 0) {
    throw "$Label machine result archive size is invalid."
  }
  $canonical = ConvertTo-Json -InputObject ([ordered]@{
    schema = $marker.schema
    operation_id = $marker.operation_id
    phase = $marker.phase
    publication_file = $marker.publication_file
    archive_sha256 = $marker.archive_sha256
    archive_bytes = $marker.archive_bytes
    filesystem_identity = $marker.filesystem_identity
    format_version = 2
  }) -Compress
  if ($canonical -cne $Line) { throw "$Label machine result is not canonical JSON." }
  return [pscustomobject][ordered]@{
    Schema = $marker.schema
    OperationId = $marker.operation_id
    Phase = $marker.phase
    PublicationFile = $marker.publication_file
    ArchiveSha256 = $marker.archive_sha256
    ArchiveBytes = $archiveBytes
    FilesystemIdentity = $marker.filesystem_identity
    FormatVersion = 2
  }
}

function Invoke-RollbackDescriptorBackup {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$DestinationPath,
    [Parameter(Mandatory = $true)][string]$DataDirectory,
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$Label,
    [string]$NodeExecutable = '',
    [AllowNull()][object]$ParentDirectoryAuthority = $null,
    [ValidateRange(1000, 3600000)][int]$TimeoutMilliseconds = 900000
  )
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "$Label descriptor publication requires Windows." }
  $destination = [System.IO.Path]::GetFullPath($DestinationPath)
  if ([System.IO.Path]::GetFileName($destination) -cne 'data.zip') { throw "$Label destination must be data.zip." }
  $repository = [System.IO.Path]::GetFullPath($RepositoryRoot)
  $dataRoot = [System.IO.Path]::GetFullPath($DataDirectory)
  $backupScript = Join-Path $repository 'backend-node\scripts\backup-data.js'
  if (-not [System.IO.File]::Exists($backupScript)) { throw "$Label backup CLI is missing." }
  $node = if (-not [string]::IsNullOrWhiteSpace($NodeExecutable)) {
    $NodeExecutable
  } elseif (-not [string]::IsNullOrWhiteSpace($env:LMD_NODE_EXE)) {
    $env:LMD_NODE_EXE
  } else {
    'node.exe'
  }
  $operationId = [Guid]::NewGuid().ToString('N')
  $authority = $null
  $invocation = $null
  $machineStream = $null
  $result = $null
  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $authority = New-RollbackFilePublicationAuthority -Path $destination -Label $Label -ParentDirectoryAuthority $ParentDirectoryAuthority
    $arguments = @(
      $backupScript,
      '--descriptor-publication',
      '--operation-id', $operationId,
      '--publication-path', $destination,
      '--publication-timeout-ms', '300000',
      '--data-root', $dataRoot
    )
    $invocation = Start-RollbackDescriptorProcess -FilePath $node -ArgumentList $arguments -WorkingDirectory $repository -ArchiveHandle $authority.Stream.SafeFileHandle
    $machineHandle = $invocation.MachineRead
    $machineStream = [System.IO.FileStream]::new($machineHandle, [System.IO.FileAccess]::Read, 4096, $false)
    $invocation.MachineRead = $null
    $state = [pscustomobject][ordered]@{
      Pending = [byte[]]::new(0)
      ReadBuffer = $null
      ReadTask = $null
      Ended = $false
    }

    $readyRecord = Read-RollbackMachineChannelRecord -Stream $machineStream -State $state -Stopwatch $stopwatch -TimeoutMilliseconds $TimeoutMilliseconds -Label $Label
    if ($readyRecord.EndOfStream) { throw "$Label child exited before the ready marker." }
    $ready = ConvertFrom-RollbackBackupPublicationMarker -Line $readyRecord.Line -ExpectedOperationId $operationId -ExpectedPhase 'ready' -Label $Label
    if ($ready.FilesystemIdentity -cne $authority.Identity) { throw "$Label Node and PowerShell archive identities differ before publication." }
    if ($authority.Stream.Length -ne $ready.ArchiveBytes) { throw "$Label archive length differs from the ready marker." }
    if ((Get-RollbackFileAuthoritySha256 -Authority $authority) -cne $ready.ArchiveSha256) { throw "$Label archive hash differs from the ready marker." }
    Publish-RollbackFileAuthority -Authority $authority | Out-Null

    $committedRecord = Read-RollbackMachineChannelRecord -Stream $machineStream -State $state -Stopwatch $stopwatch -TimeoutMilliseconds $TimeoutMilliseconds -Label $Label
    if ($committedRecord.EndOfStream) { throw "$Label child exited before the committed marker." }
    $committed = ConvertFrom-RollbackBackupPublicationMarker -Line $committedRecord.Line -ExpectedOperationId $operationId -ExpectedPhase 'committed' -Label $Label
    if ($committed.ArchiveSha256 -cne $ready.ArchiveSha256 -or
        $committed.ArchiveBytes -ne $ready.ArchiveBytes -or
        $committed.FilesystemIdentity -cne $ready.FilesystemIdentity) {
      throw "$Label committed marker differs from the ready marker."
    }
    $endRecord = Read-RollbackMachineChannelRecord -Stream $machineStream -State $state -Stopwatch $stopwatch -TimeoutMilliseconds $TimeoutMilliseconds -Label $Label
    if (-not $endRecord.EndOfStream) { throw "$Label child emitted more than two machine result markers." }

    $remaining = [Math]::Max(1, $TimeoutMilliseconds - [int]$stopwatch.ElapsedMilliseconds)
    $detail = ''
    if (-not [LocalMiniDrama.Rollback.DescriptorProcessLauncher]::WaitForNoActiveProcesses($invocation, $remaining, [ref]$detail)) {
      throw "$Label process tree did not become quiescent: $detail"
    }
    $exitCode = [LocalMiniDrama.Rollback.DescriptorProcessLauncher]::ExitCode($invocation)
    if ($exitCode -ne 0) { throw "$Label failed with exit code $exitCode." }
    Assert-RollbackFileAuthority -Authority $authority | Out-Null
    if ($authority.Stream.Length -ne $ready.ArchiveBytes -or (Get-RollbackFileAuthoritySha256 -Authority $authority) -cne $ready.ArchiveSha256) {
      throw "$Label retained archive changed after child completion."
    }
    $result = [pscustomobject][ordered]@{
      Authority = $authority
      ArchiveSha256 = $ready.ArchiveSha256
      ArchiveBytes = [long]$ready.ArchiveBytes
      FilesystemIdentity = $ready.FilesystemIdentity
      Ready = $ready
      Committed = $committed
    }
    $authority = $null
  } catch {
    $primaryError = $_
  } finally {
    if ($null -ne $primaryError -and $null -ne $invocation) {
      try {
        $detail = ''
        if (-not [LocalMiniDrama.Rollback.DescriptorProcessLauncher]::TerminateAndWait($invocation, 2000, [ref]$detail)) {
          throw "$Label process tree cleanup failed: $detail"
        }
      } catch { [void]$cleanupErrors.Add($_) }
    }
    try { if ($null -ne $machineStream) { $machineStream.Dispose() } } catch { [void]$cleanupErrors.Add($_) }
    try { if ($null -ne $invocation) { $invocation.Dispose() } } catch { [void]$cleanupErrors.Add($_) }
    if ($null -ne $primaryError -and $null -ne $authority) {
      if ($authority.Renamed -eq $true -or $authority.Published -eq $true) {
        try { Close-RollbackFilePublicationAuthority -Authority $authority } catch { [void]$cleanupErrors.Add($_) }
      } else {
        try { Remove-RollbackUnpublishedFileAuthority -Authority $authority } catch { [void]$cleanupErrors.Add($_) }
      }
    }
  }
  Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
  return $result
}
