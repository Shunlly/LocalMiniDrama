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

function ConvertTo-WindowsCommandLineArgument {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Argument
  )
  if ($Argument.Length -gt 0 -and $Argument -cnotmatch '[\s"]') {
    return $Argument
  }

  $builder = [System.Text.StringBuilder]::new()
  [void]$builder.Append('"')
  $backslashCount = 0
  foreach ($character in $Argument.ToCharArray()) {
    if ($character -eq '\') {
      $backslashCount += 1
      continue
    }
    if ($character -eq '"') {
      if ($backslashCount -gt 0) {
        [void]$builder.Append((('\' * (($backslashCount * 2) + 1)) -join ''))
      } else {
        [void]$builder.Append('\')
      }
      [void]$builder.Append('"')
    } else {
      if ($backslashCount -gt 0) {
        [void]$builder.Append((('\' * $backslashCount) -join ''))
      }
      [void]$builder.Append($character)
    }
    $backslashCount = 0
  }
  if ($backslashCount -gt 0) {
    [void]$builder.Append((('\' * ($backslashCount * 2)) -join ''))
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Get-RemainingNativeTimeoutMilliseconds {
  param(
    [Parameter(Mandatory = $true)][System.Diagnostics.Stopwatch]$Stopwatch,
    [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds
  )
  return [Math]::Max(0, $TimeoutMilliseconds - [int]$Stopwatch.ElapsedMilliseconds)
}

function Initialize-NativeJobBridge {
  if ($null -ne ('LocalMiniDrama.NativeJobLauncher' -as [type])) { return }
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace LocalMiniDrama {
  public sealed class NativeJobProcess : IDisposable {
    public SafeFileHandle Job;
    public SafeFileHandle Process;
    public SafeFileHandle StandardInput;
    public SafeFileHandle StandardOutput;
    public SafeFileHandle StandardError;
    public int ProcessId;
    public void Dispose() {
      if (StandardInput != null) StandardInput.Dispose();
      if (StandardOutput != null) StandardOutput.Dispose();
      if (StandardError != null) StandardError.Dispose();
      if (Process != null) Process.Dispose();
      if (Job != null) Job.Dispose();
    }
  }

  public static class NativeJobLauncher {
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const uint HANDLE_FLAG_INHERIT = 0x00000001;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint ERROR_CANCELLED = 1223;
    const uint WAIT_OBJECT_0 = 0;
    const uint WAIT_TIMEOUT = 258;
    const uint INFINITE = 0xffffffff;
    const int JobObjectBasicAccountingInformation = 1;
    const int JobObjectExtendedLimitInformation = 9;

    [StructLayout(LayoutKind.Sequential)]
    struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO { public int cb; public string lpReserved; public string lpDesktop; public string lpTitle; public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public uint dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount; public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION { public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime; public uint TotalPageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, int length, IntPtr returnedLength);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SECURITY_ATTRIBUTES attributes, int size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool CloseHandle(IntPtr handle);

    static Exception LastError(string operation) { int error = Marshal.GetLastWin32Error(); return new Win32Exception(error, operation + " failed (Win32 error " + error + ")."); }
    static void CloseRaw(ref IntPtr handle) { if (handle != IntPtr.Zero && handle != new IntPtr(-1)) { CloseHandle(handle); handle = IntPtr.Zero; } }
    static void CreateParentReadPipe(ref SECURITY_ATTRIBUTES attributes, out IntPtr parentRead, out IntPtr childWrite) {
      if (!CreatePipe(out parentRead, out childWrite, ref attributes, 0)) throw LastError("CreatePipe(stdout/stderr)");
      if (!SetHandleInformation(parentRead, HANDLE_FLAG_INHERIT, 0)) { CloseRaw(ref parentRead); CloseRaw(ref childWrite); throw LastError("SetHandleInformation(stdout/stderr)"); }
    }
    static void CreateParentWritePipe(ref SECURITY_ATTRIBUTES attributes, out IntPtr childRead, out IntPtr parentWrite) {
      if (!CreatePipe(out childRead, out parentWrite, ref attributes, 0)) throw LastError("CreatePipe(stdin)");
      if (!SetHandleInformation(parentWrite, HANDLE_FLAG_INHERIT, 0)) { CloseRaw(ref childRead); CloseRaw(ref parentWrite); throw LastError("SetHandleInformation(stdin)"); }
    }

    public static NativeJobProcess Start(string applicationName, string commandLine, string currentDirectory) {
      return StartCore(applicationName, commandLine, currentDirectory, false);
    }

    public static NativeJobProcess StartForAssignmentFailureTest(string applicationName, string commandLine, string currentDirectory) {
      return StartCore(applicationName, commandLine, currentDirectory, true);
    }

    static NativeJobProcess StartCore(string applicationName, string commandLine, string currentDirectory, bool failAssignmentForTest) {
      NativeJobProcess result = new NativeJobProcess();
      IntPtr job = IntPtr.Zero, stdoutRead = IntPtr.Zero, stdoutWrite = IntPtr.Zero, stderrRead = IntPtr.Zero, stderrWrite = IntPtr.Zero, stdinRead = IntPtr.Zero, stdinWrite = IntPtr.Zero, process = IntPtr.Zero, thread = IntPtr.Zero;
      int createdProcessId = 0;
      bool assignedToJob = false;
      try {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero || job == new IntPtr(-1)) throw LastError("CreateJobObject");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)))) throw LastError("SetInformationJobObject");
        SECURITY_ATTRIBUTES attributes = new SECURITY_ATTRIBUTES(); attributes.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); attributes.bInheritHandle = true;
        CreateParentReadPipe(ref attributes, out stdoutRead, out stdoutWrite);
        CreateParentReadPipe(ref attributes, out stderrRead, out stderrWrite);
        CreateParentWritePipe(ref attributes, out stdinRead, out stdinWrite);
        STARTUPINFO startup = new STARTUPINFO(); startup.cb = Marshal.SizeOf(typeof(STARTUPINFO)); startup.dwFlags = STARTF_USESTDHANDLES; startup.hStdInput = stdinRead; startup.hStdOutput = stdoutWrite; startup.hStdError = stderrWrite;
        PROCESS_INFORMATION info;
        StringBuilder mutableCommandLine = new StringBuilder(commandLine);
        if (!CreateProcess(applicationName, mutableCommandLine, IntPtr.Zero, IntPtr.Zero, true, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, currentDirectory, ref startup, out info)) throw LastError("CreateProcessW");
        process = info.hProcess; thread = info.hThread;
        createdProcessId = info.dwProcessId;
        CloseRaw(ref stdoutWrite); CloseRaw(ref stderrWrite); CloseRaw(ref stdinRead);
        if (failAssignmentForTest) throw new Win32Exception(5, "Injected AssignProcessToJobObject failure.");
        if (!AssignProcessToJobObject(job, process)) throw LastError("AssignProcessToJobObject");
        assignedToJob = true;
        if (ResumeThread(thread) == 0xffffffff) throw LastError("ResumeThread");
        CloseRaw(ref thread);
        result.Job = new SafeFileHandle(job, true); job = IntPtr.Zero;
        result.Process = new SafeFileHandle(process, true); process = IntPtr.Zero;
        result.StandardOutput = new SafeFileHandle(stdoutRead, true); stdoutRead = IntPtr.Zero;
        result.StandardError = new SafeFileHandle(stderrRead, true); stderrRead = IntPtr.Zero;
        result.StandardInput = new SafeFileHandle(stdinWrite, true); stdinWrite = IntPtr.Zero;
        result.ProcessId = info.dwProcessId;
        return result;
      } catch (Exception primaryError) {
        if (createdProcessId > 0) primaryError.Data["NativeProcessId"] = createdProcessId;
        if (process != IntPtr.Zero && !assignedToJob) {
          bool terminated = TerminateProcess(process, ERROR_CANCELLED);
          if (!terminated && WaitForSingleObject(process, 0) != WAIT_OBJECT_0) {
            primaryError.Data["NativeStartupCleanupError"] = LastError("TerminateProcess").Message;
          }
          uint waitResult = WaitForSingleObject(process, 2000);
          bool confirmed = waitResult == WAIT_OBJECT_0;
          primaryError.Data["NativeUnassignedProcessTerminated"] = confirmed;
          if (!confirmed) {
            primaryError.Data["NativeStartupCleanupError"] = waitResult == WAIT_TIMEOUT
              ? "Unassigned suspended process termination exceeded its bounded wait."
              : LastError("WaitForSingleObject").Message;
          }
        }
        if (job != IntPtr.Zero && assignedToJob) TerminateJobObject(job, ERROR_CANCELLED);
        result.Dispose();
        throw;
      } finally {
        CloseRaw(ref thread); CloseRaw(ref process); CloseRaw(ref stdoutRead); CloseRaw(ref stdoutWrite); CloseRaw(ref stderrRead); CloseRaw(ref stderrWrite); CloseRaw(ref stdinRead); CloseRaw(ref stdinWrite); CloseRaw(ref job);
      }
    }

    public static bool HasExited(NativeJobProcess process) { return WaitForSingleObject(process.Process.DangerousGetHandle(), 0) == WAIT_OBJECT_0; }
    public static int ExitCode(NativeJobProcess process) { uint code; if (!GetExitCodeProcess(process.Process.DangerousGetHandle(), out code)) throw LastError("GetExitCodeProcess"); return unchecked((int)code); }
    public static bool WaitForNoActiveProcesses(NativeJobProcess process, int timeoutMilliseconds, out string detail) {
      Stopwatch stopwatch = Stopwatch.StartNew();
      while (stopwatch.ElapsedMilliseconds < timeoutMilliseconds) {
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
        if (!QueryInformationJobObject(process.Job.DangerousGetHandle(), JobObjectBasicAccountingInformation, out accounting, Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero)) { detail = LastError("QueryInformationJobObject").Message; return false; }
        if (accounting.ActiveProcesses == 0) { detail = "Job has no active processes."; return true; }
        System.Threading.Thread.Sleep(10);
      }
      detail = "Job descendants did not exit within the bounded wait.";
      return false;
    }
    public static bool TerminateAndWait(NativeJobProcess process, int timeoutMilliseconds, out string detail) {
      if (!TerminateJobObject(process.Job.DangerousGetHandle(), ERROR_CANCELLED)) { detail = LastError("TerminateJobObject").Message; return false; }
      bool confirmed = WaitForNoActiveProcesses(process, timeoutMilliseconds, out detail);
      if (confirmed) detail = "Job terminated and has no active processes.";
      else if (detail == "Job descendants did not exit within the bounded wait.") detail = "Job termination exceeded its bounded wait.";
      return confirmed;
    }
  }
}
'@ -ErrorAction Stop
}

function Resolve-NativeExecutablePath {
  param([Parameter(Mandatory = $true)][string]$FilePath)
  $candidate = $FilePath
  if (-not [System.IO.Path]::IsPathRooted($candidate)) {
    $command = Get-Command -Name $FilePath -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $candidate = if (-not [string]::IsNullOrWhiteSpace([string]$command.Path)) { [string]$command.Path } else { [string]$command.Source }
  }
  $resolved = [System.IO.Path]::GetFullPath($candidate)
  if (-not [System.IO.File]::Exists($resolved)) { throw "Native executable does not exist: $resolved" }
  return $resolved
}

function Start-NativeJobProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList
  )
  Initialize-NativeJobBridge
  $executable = Resolve-NativeExecutablePath -FilePath $FilePath
  $commandLine = ((@($executable) + @($ArgumentList) | ForEach-Object {
    ConvertTo-WindowsCommandLineArgument -Argument ([string]$_)
  }) -join ' ')
  return [LocalMiniDrama.NativeJobLauncher]::Start($executable, $commandLine, (Get-Location).Path)
}

function Stop-NativeProcessTreeBounded {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][LocalMiniDrama.NativeJobProcess]$Invocation,
    [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$TimeoutMilliseconds
  )
  $detail = ''
  $confirmed = [LocalMiniDrama.NativeJobLauncher]::TerminateAndWait($Invocation, $TimeoutMilliseconds, [ref]$detail)
  if ($detail.Length -gt 1024) { $detail = $detail.Substring(0, 1024) }
  return [pscustomobject]@{ Confirmed = $confirmed; Detail = $detail }
}

function Wait-NativeProcessTreeExitBounded {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][LocalMiniDrama.NativeJobProcess]$Invocation,
    [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$TimeoutMilliseconds
  )
  $detail = ''
  $confirmed = [LocalMiniDrama.NativeJobLauncher]::WaitForNoActiveProcesses($Invocation, $TimeoutMilliseconds, [ref]$detail)
  if ($detail.Length -gt 1024) { $detail = $detail.Substring(0, 1024) }
  return [pscustomobject]@{ Confirmed = $confirmed; Detail = $detail }
}

function Invoke-NativeCommandWithTimeout {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$TimeoutMilliseconds,
    [switch]$CaptureOutput,
    [switch]$CaptureOutputBytes,
    [ValidateRange(1, 2097152)][int]$MaximumOutputBytes = 262144,
    [ValidateRange(1, 1048576)][int]$MaximumErrorBytes = 65536,
    [AllowNull()][byte[]]$StandardInputBytes = $null,
    [ValidateRange(1, [int]::MaxValue)][int]$TerminationTimeoutMilliseconds = 2000
  )

  if ($CaptureOutput -and $CaptureOutputBytes) {
    throw 'Native output can be captured as text or bytes, but not both.'
  }
  $captureStreams = $CaptureOutput -or $CaptureOutputBytes
  $nativeProcess = $null
  $outputStream = $null
  $errorStream = $null
  $inputStream = $null
  $started = $false
  $terminationAttempted = $false
  $standardInputClosed = ($null -eq $StandardInputBytes)
  $result = $null
  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    try {
      $nativeProcess = Start-NativeJobProcess -FilePath $FilePath -ArgumentList $ArgumentList
      $started = $true
    } catch {
      throw [System.InvalidOperationException]::new("$Label could not execute: $($_.Exception.Message)", $_.Exception)
    }

    $outputStream = [System.IO.FileStream]::new($nativeProcess.StandardOutput, [System.IO.FileAccess]::Read, 4096, $false)
    $errorStream = [System.IO.FileStream]::new($nativeProcess.StandardError, [System.IO.FileAccess]::Read, 4096, $false)
    $inputStream = [System.IO.FileStream]::new($nativeProcess.StandardInput, [System.IO.FileAccess]::Write, 4096, $false)

    $completed = $false
    $outputTruncated = $false
    $errorTruncated = $false
    $outputCount = 0
    $errorCount = 0
    $outputBytes = $null
    $errorBytes = $null
    $outputReadTask = $null
    $errorReadTask = $null
    $inputWriteTask = $null
    $outputFinished = $false
    $errorFinished = $false
    $inputFinished = ($null -eq $StandardInputBytes)
    $outputReadBuffer = [byte[]]::new(4096)
    $errorReadBuffer = [byte[]]::new(4096)
    $outputReadTask = $outputStream.ReadAsync($outputReadBuffer, 0, $outputReadBuffer.Length)
    $errorReadTask = $errorStream.ReadAsync($errorReadBuffer, 0, $errorReadBuffer.Length)
    if ($captureStreams) {
      $outputBytes = [byte[]]::new($MaximumOutputBytes)
      $errorBytes = [byte[]]::new($MaximumErrorBytes)
    }
    if ($null -ne $StandardInputBytes) {
      # Output readers must already be active before a potentially blocking stdin write begins.
      $inputWriteTask = $inputStream.WriteAsync($StandardInputBytes, 0, $StandardInputBytes.Length)
    } else {
      $inputStream.Close()
      $standardInputClosed = $true
    }

    while ($stopwatch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $madeProgress = $false
        if (-not $outputFinished -and $outputReadTask.IsCompleted) {
          $readCount = [int]$outputReadTask.GetAwaiter().GetResult()
          $madeProgress = $true
          if ($readCount -eq 0) {
            $outputFinished = $true
          } else {
            if ($captureStreams) {
              $copyCount = [Math]::Min($readCount, $MaximumOutputBytes - $outputCount)
              if ($copyCount -gt 0) {
                [Array]::Copy($outputReadBuffer, 0, $outputBytes, $outputCount, $copyCount)
                $outputCount += $copyCount
              }
              if ($copyCount -lt $readCount) {
                $outputTruncated = $true
                throw [System.InvalidOperationException]::new("$Label output exceeded the $MaximumOutputBytes-byte bound.")
              }
            }
            $outputReadTask = $outputStream.ReadAsync($outputReadBuffer, 0, $outputReadBuffer.Length)
          }
        }
        if (-not $errorFinished -and $errorReadTask.IsCompleted) {
          $readCount = [int]$errorReadTask.GetAwaiter().GetResult()
          $madeProgress = $true
          if ($readCount -eq 0) {
            $errorFinished = $true
          } else {
            if ($captureStreams) {
              $copyCount = [Math]::Min($readCount, $errorBytes.Length - $errorCount)
              if ($copyCount -gt 0) {
                [Array]::Copy($errorReadBuffer, 0, $errorBytes, $errorCount, $copyCount)
                $errorCount += $copyCount
              }
              if ($copyCount -lt $readCount) { $errorTruncated = $true }
            }
            $errorReadTask = $errorStream.ReadAsync($errorReadBuffer, 0, $errorReadBuffer.Length)
          }
        }
        if (-not $inputFinished -and $inputWriteTask.IsCompleted) {
          try {
            [void]$inputWriteTask.GetAwaiter().GetResult()
          } finally {
            try { $inputStream.Close() } finally { $standardInputClosed = $true }
          }
          $inputFinished = $true
          $madeProgress = $true
        }
        if ([LocalMiniDrama.NativeJobLauncher]::HasExited($nativeProcess) -and $outputFinished -and $errorFinished -and $inputFinished) {
          $completed = $true
          break
        }
        if (-not $madeProgress) { Start-Sleep -Milliseconds 10 }
    }

    if (-not $completed) {
      $terminationAttempted = $true
      $timeoutError = [System.TimeoutException]::new("$Label timed out after $TimeoutMilliseconds milliseconds.")
      $timeoutError.Data['NativeTimedOut'] = $true
      $timeoutError.Data['NativeProcessId'] = $nativeProcess.ProcessId
      try {
        $termination = Stop-NativeProcessTreeBounded -Invocation $nativeProcess -TimeoutMilliseconds $TerminationTimeoutMilliseconds
        $timeoutError.Data['NativeProcessTreeTerminated'] = [bool]$termination.Confirmed
        $timeoutError.Data['NativeTerminationDetail'] = [string]$termination.Detail
      } catch {
        $terminationDetail = "Process-tree termination helper failed: $($_.Exception.Message)"
        if ($terminationDetail.Length -gt 1024) { $terminationDetail = $terminationDetail.Substring(0, 1024) }
        $timeoutError.Data['NativeProcessTreeTerminated'] = $false
        $timeoutError.Data['NativeTerminationDetail'] = $terminationDetail
      }
      throw $timeoutError
    }

    $quiescence = Wait-NativeProcessTreeExitBounded -Invocation $nativeProcess -TimeoutMilliseconds $TerminationTimeoutMilliseconds
    if (-not $quiescence.Confirmed) {
      $quiescenceError = [System.InvalidOperationException]::new("$Label completed but its process tree did not become quiescent.")
      $quiescenceError.Data['NativeProcessTreeQuiesced'] = $false
      $quiescenceError.Data['NativeQuiescenceDetail'] = [string]$quiescence.Detail
      throw $quiescenceError
    }

    $exitCode = [LocalMiniDrama.NativeJobLauncher]::ExitCode($nativeProcess)
    if ($captureStreams -and $outputTruncated) {
      throw [System.InvalidOperationException]::new("$Label output exceeded the $MaximumOutputBytes-byte bound.")
    }
    if ($exitCode -ne 0) {
      $message = "$Label failed with exit code $exitCode."
      if ($captureStreams -and $errorCount -gt 0) {
        $diagnostic = [System.Text.Encoding]::UTF8.GetString($errorBytes, 0, $errorCount).Trim()
        if ($errorTruncated) { $diagnostic += [Environment]::NewLine + '[diagnostic truncated]' }
        if (-not [string]::IsNullOrWhiteSpace($diagnostic)) {
          $message += [Environment]::NewLine + $diagnostic
        }
      }
      $nativeError = [System.InvalidOperationException]::new($message)
      $nativeError.Data['NativeExitCode'] = $exitCode
      throw $nativeError
    }
    if ($CaptureOutputBytes) {
      $capturedOutput = [byte[]]::new($outputCount)
      $capturedError = [byte[]]::new($errorCount)
      if ($outputCount -gt 0) { [Array]::Copy($outputBytes, 0, $capturedOutput, 0, $outputCount) }
      if ($errorCount -gt 0) { [Array]::Copy($errorBytes, 0, $capturedError, 0, $errorCount) }
      $result = [pscustomobject][ordered]@{
        StandardOutputBytes = $capturedOutput
        StandardErrorBytes = $capturedError
        StandardErrorTruncated = $errorTruncated
      }
    }
    if ($CaptureOutput) {
      $result = [System.Text.Encoding]::UTF8.GetString($outputBytes, 0, $outputCount)
    }
  } catch {
    $primaryError = $_
    if ($started -and -not $terminationAttempted) {
      try {
        $termination = Stop-NativeProcessTreeBounded -Invocation $nativeProcess -TimeoutMilliseconds $TerminationTimeoutMilliseconds
        $primaryError.Exception.Data['NativeProcessTreeTerminated'] = [bool]$termination.Confirmed
        $primaryError.Exception.Data['NativeTerminationDetail'] = [string]$termination.Detail
      } catch {
        [void]$cleanupErrors.Add($_)
        $primaryError.Exception.Data['NativeProcessTreeTerminated'] = $false
        $primaryError.Exception.Data['NativeTerminationDetail'] = 'Process-tree cleanup failed after the native stream error.'
      }
    }
    throw
  } finally {
    if ($started -and $null -ne $StandardInputBytes -and -not $standardInputClosed) {
      try {
        $inputStream.Close()
      } catch {
        [void]$cleanupErrors.Add($_)
      }
    }
    try {
      if ($null -ne $outputStream) { $outputStream.Dispose() }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
    try {
      if ($null -ne $errorStream) { $errorStream.Dispose() }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
    try {
      if ($null -ne $inputStream) { $inputStream.Dispose() }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
    try {
      if ($null -ne $nativeProcess) { $nativeProcess.Dispose() }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
    Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
  }
  return $result
}

function Write-NativeDiagnostic {
  param(
    [Parameter(Mandatory = $true)][object]$Invocation,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($null -eq $Invocation.PSObject.Properties['StandardErrorBytes'] -or
      $Invocation.StandardErrorBytes -isnot [byte[]]) {
    throw "$Label did not return bounded stderr bytes."
  }
  if ($Invocation.StandardErrorBytes.Length -gt 0) {
    [Console]::Error.Write([System.Text.Encoding]::UTF8.GetString($Invocation.StandardErrorBytes))
  }
  if ($Invocation.StandardErrorTruncated -eq $true) {
    [Console]::Error.WriteLine("[$Label diagnostic truncated]")
  }
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

function Get-RollbackPathSha256 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $authority = $null
  try {
    $authority = Open-RollbackFileAuthority -Path $Path -Label $Label
    return Get-RollbackFileAuthoritySha256 -Authority $authority
  } finally {
    if ($null -ne $authority) { $authority.Stream.Dispose() }
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

function ConvertTo-CheckpointDockerMounts {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Mounts,
    [Parameter(Mandatory = $true)][string]$Context
  )
  return @($Mounts | ForEach-Object {
    Assert-CheckpointEvidenceJsonObject -Value $_ -Message "$Context entries must be objects."
    $typeProperty = Get-CheckpointEvidenceProperty -Object $_ -Name 'Type' -Context "$Context entry"
    $sourceProperty = Get-CheckpointEvidenceProperty -Object $_ -Name 'Source' -Context "$Context entry"
    $destinationProperty = Get-CheckpointEvidenceProperty -Object $_ -Name 'Destination' -Context "$Context entry"
    $readWriteProperty = Get-CheckpointEvidenceProperty -Object $_ -Name 'RW' -Context "$Context entry"
    if ($typeProperty.Value -isnot [string] -or
        $sourceProperty.Value -isnot [string] -or
        [string]::IsNullOrWhiteSpace($sourceProperty.Value) -or
        $destinationProperty.Value -isnot [string] -or
        $readWriteProperty.Value -isnot [bool]) {
      throw "$Context fields have invalid JSON types."
    }
    [pscustomobject][ordered]@{
      Type = $typeProperty.Value
      Source = $sourceProperty.Value
      Destination = $destinationProperty.Value
      RW = $readWriteProperty.Value
    }
  })
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
  $validatedMounts = ConvertTo-CheckpointDockerMounts -Mounts $mounts -Context "${Destination} mount capture"
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
  $reader = 'const fs = require("node:fs"); const expectedHex = process.argv[2]; if (typeof expectedHex !== "string" || !/^[a-f0-9]+$/.test(expectedHex)) process.exit(51); if (expectedHex.length !== 64) process.exit(52); const expected = Buffer.from(expectedHex, "hex"); let actual; try { actual = fs.readFileSync(process.argv[1]); } catch (error) { process.exit(error && error.code === "ENOENT" ? 53 : 54); } if (actual.length !== expected.length) process.exit(55); if (!actual.equals(expected)) process.exit(56);'
  $dockerExecTimeoutMilliseconds = 10000
  $dockerExecMaximumAttempts = 2
  $markerStream = $null
  $markerOwned = $false
  $randomNumberGenerator = $null
  $retainedIdentity = $null
  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  try {
    if ($ContainerId -cnotmatch '^[a-f0-9]{12,64}$') {
      throw 'The captured backend container ID must contain 12 to 64 lowercase hexadecimal characters.'
    }
    $fullContainerId = (Invoke-NativeCommandWithTimeout -FilePath 'docker.exe' -ArgumentList @('inspect', $ContainerId, '--format', '{{.Id}}') -Label 'Running container ID resolution' -TimeoutMilliseconds $dockerExecTimeoutMilliseconds -CaptureOutput).Trim()
    if ($fullContainerId -cnotmatch '^[a-f0-9]{64}$' -or
        -not $fullContainerId.StartsWith($ContainerId, [System.StringComparison]::Ordinal)) {
      throw 'Running container ID resolution did not match the captured backend container.'
    }

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

    $dockerExecArguments = @('exec', $fullContainerId, 'node', '-e', $reader, '--', $containerMarkerPath, $expectedHex)
    for ($attempt = 1; $attempt -le $dockerExecMaximumAttempts; $attempt += 1) {
      try {
        Invoke-NativeCommandWithTimeout -FilePath 'docker.exe' -ArgumentList $dockerExecArguments -Label 'Running container data bind byte proof' -TimeoutMilliseconds $dockerExecTimeoutMilliseconds | Out-Null
        break
      } catch {
        $retryableTimeout = $_.Exception.Data['NativeTimedOut'] -eq $true -and
          $_.Exception.Data['NativeProcessTreeTerminated'] -eq $true
        if (-not $retryableTimeout -or $attempt -ge $dockerExecMaximumAttempts) {
          throw
        }
        Start-Sleep -Milliseconds 100
      }
    }

    if ($null -eq $primaryError) {
      $containerJson = (Invoke-NativeCommandWithTimeout -FilePath 'docker.exe' -ArgumentList @('inspect', $fullContainerId, '--format', '{{json .}}') -Label 'Running container data bind reinspection' -TimeoutMilliseconds $dockerExecTimeoutMilliseconds -CaptureOutput).Trim()
      try {
        $container = ConvertFrom-Json -InputObject $containerJson
      } catch {
        throw 'Running container data bind reinspection returned invalid Docker JSON.'
      }
      Assert-CheckpointEvidenceJsonObject -Value $container -Message 'Running container data bind reinspection must be an object.'
      $idProperty = Get-CheckpointEvidenceProperty -Object $container -Name 'Id' -Context 'Running container data bind reinspection'
      if ($idProperty.Value -isnot [string] -or $idProperty.Value -cne $fullContainerId) {
        throw 'Running container data bind reinspection no longer represents the captured container.'
      }
      $mountsProperty = Get-CheckpointEvidenceProperty -Object $container -Name 'Mounts' -Context 'Running container data bind reinspection'
      if ($mountsProperty.Value -isnot [System.Collections.IList]) {
        throw 'Running container data bind reinspection mounts must be an array.'
      }
      $mounts = ConvertTo-CheckpointDockerMounts -Mounts @($mountsProperty.Value) -Context 'Running container data bind reinspection mount'
      $destinationMounts = @($mounts | Where-Object {
        Test-ContainerPathEqual -Expected $_.Destination -Actual $Destination
      })
      if ($destinationMounts.Count -ne 1) {
        throw "The captured container must still have exactly one mount at $Destination."
      }
      $mount = $destinationMounts[0]
      if ($mount.Type -cne 'bind') {
        throw "The captured container mount at $Destination must remain a bind mount with a host source."
      }
      if ($mount.RW -isnot [bool] -or $mount.RW -ne $true) {
        throw "The captured container bind mount at $Destination must remain read-write."
      }
      $reinspectedSource = Assert-RealDirectory -Path $mount.Source
      Assert-SamePath -Expected $HostDirectory -Actual $reinspectedSource -Label 'Captured container data bind reinspection'
      Assert-RollbackPathIdentity -Path $HostDirectory -ExpectedIdentity $retainedIdentity -Label 'Rollback data root retained container bind proof' | Out-Null
    }
  } catch {
    $primaryError = $_
    throw
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
    Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
  }
  if ($null -ne $retainedIdentity) {
    Assert-RollbackPathIdentity -Path $HostDirectory -ExpectedIdentity $retainedIdentity -Label 'Rollback data root retained container bind proof after marker cleanup' | Out-Null
  }
}

function Get-ImageRevision {
  param(
    [Parameter(Mandatory = $true)][string]$ImageReference,
    [Parameter(Mandatory = $true)][string]$Label,
    [string]$Platform = ''
  )
  $arguments = @('image', 'inspect')
  if (-not [string]::IsNullOrWhiteSpace($Platform)) {
    if ($Platform -cnotmatch '^[a-z0-9][a-z0-9._-]{0,63}/[a-z0-9][a-z0-9._-]{0,63}(?:/[a-z0-9][a-z0-9._-]{0,63})?$') {
      throw "$Label received an invalid Docker platform."
    }
    $arguments += @('--platform', $Platform)
  }
  $arguments += @($ImageReference, '--format', '{{json .Config.Labels}}')
  $labelsJson = Get-CheckedScalar -FilePath 'docker' -ArgumentList $arguments -Label $Label
  try {
    $labels = $labelsJson | ConvertFrom-Json
  } catch {
    throw "$Label returned invalid Docker labels JSON."
  }
  Assert-CheckpointEvidenceJsonObject -Value $labels -Message "$Label returned invalid Docker labels JSON."
  $property = Get-CheckpointEvidenceProperty -Object $labels -Name 'org.opencontainers.image.revision' -Context $Label
  Assert-CheckpointEvidenceStringPattern -Value $property.Value -Pattern '^[a-f0-9]{40}$' -Message "$Label did not contain an exact lowercase revision."
  return $property.Value
}

function Write-Utf8File {
  param([string]$Path, [string]$Value)
  [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

function New-RollbackFileAuthorityFromBytes {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $stream = $null
  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  try {
    $stream = [System.IO.FileStream]::new(
      $fullPath,
      [System.IO.FileMode]::CreateNew,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::Read
    )
    $stream.Write($Bytes, 0, $Bytes.Length)
    $stream.Flush($true)
    $identity = Get-RollbackPathIdentity -Handle $stream.SafeFileHandle
    Assert-RollbackPathIdentity -Path $fullPath -ExpectedIdentity $identity -Label $Label | Out-Null

    $actual = [byte[]]::new($Bytes.Length)
    $stream.Position = 0
    $offset = 0
    while ($offset -lt $actual.Length) {
      $read = $stream.Read($actual, $offset, $actual.Length - $offset)
      if ($read -eq 0) { throw "$Label bytes were truncated after publication." }
      $offset += $read
    }
    if ($stream.ReadByte() -ne -1) { throw "$Label bytes grew after publication." }
    for ($index = 0; $index -lt $actual.Length; $index++) {
      if ($actual[$index] -ne $Bytes[$index]) { throw "$Label bytes changed after publication." }
    }
    $stream.Position = 0
    return [pscustomobject][ordered]@{
      Path = $fullPath
      Label = $Label
      Identity = $identity
      Stream = $stream
    }
  } catch {
    $primaryError = $_
    throw
  } finally {
    if ($null -ne $primaryError -and $null -ne $stream) {
      try {
        $stream.Dispose()
      } catch {
        [void]$cleanupErrors.Add($_)
      }
    }
    Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
  }
}

function ConvertFrom-StrictRollbackJsonBytes {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes,
    [Parameter(Mandatory = $true)][string]$Label
  )
  $temporaryPath = Join-Path ([System.IO.Path]::GetTempPath()) (
    ".localminidrama-rollback-json-$([Guid]::NewGuid().ToString('N')).json"
  )
  $authority = $null
  $owned = $false
  $result = $null
  $primaryError = $null
  $cleanupErrors = [System.Collections.ArrayList]::new()
  try {
    $authority = New-RollbackFileAuthorityFromBytes -Path $temporaryPath -Bytes $Bytes -Label $Label
    $owned = $true
    $result = Read-StrictRollbackJson -Authority $authority -Label $Label
  } catch {
    $primaryError = $_
    throw
  } finally {
    try {
      if ($null -ne $authority) { $authority.Stream.Dispose() }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
    try {
      if ($owned -and (Test-Path -LiteralPath $temporaryPath)) {
        Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction Stop
      }
    } catch {
      [void]$cleanupErrors.Add($_)
    }
    Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
  }
  return $result
}

function ConvertFrom-CanonicalRollbackBase64Url {
  param(
    [Parameter(Mandatory = $true)][object]$Value,
    [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$MaximumBytes,
    [Parameter(Mandatory = $true)][string]$Label
  )
  if ($Value -isnot [string] -or $Value.Length -eq 0 -or $Value -cnotmatch '^[A-Za-z0-9_-]+$') {
    throw "$Label must be canonical base64url."
  }
  $maximumCharacters = [int]([Math]::Ceiling(($MaximumBytes * 4.0) / 3.0)) + 2
  if ($Value.Length -gt $maximumCharacters) { throw "$Label exceeds its byte limit." }
  $remainder = $Value.Length % 4
  if ($remainder -eq 1) { throw "$Label must be canonical base64url." }
  $padded = $Value.Replace('-', '+').Replace('_', '/')
  if ($remainder -gt 0) { $padded += ('=' * (4 - $remainder)) }
  try {
    $bytes = [Convert]::FromBase64String($padded)
  } catch {
    throw "$Label must be canonical base64url."
  }
  if ($bytes.Length -gt $MaximumBytes) { throw "$Label exceeds its byte limit." }
  $canonical = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  if ($canonical -cne $Value) { throw "$Label must be canonical base64url." }
  return [pscustomobject][ordered]@{ Bytes = $bytes }
}

function ConvertFrom-RollbackResultOutput {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes
  )
  $markerPrefix = 'LOCALMINIDRAMA_ROLLBACK_RESULT_V1='
  $maximumStreamBytes = 2 * 1024 * 1024
  $maximumMarkerBytes = 1024 * 1024
  $maximumEvidenceBytes = 512 * 1024
  $strictUtf8 = [System.Text.UTF8Encoding]::new($false, $true)
  $marker = $null
  $markerCount = 0
  if ($Bytes.Length -gt $maximumStreamBytes) { throw 'Rollback result stream exceeds the byte limit.' }
  try {
    $streamText = $strictUtf8.GetString($Bytes)
  } catch {
    throw 'Rollback result output must be strict UTF-8.'
  }
  foreach ($physicalLine in [regex]::Split($streamText, '\r?\n')) {
    if (-not $physicalLine.StartsWith($markerPrefix, [System.StringComparison]::Ordinal)) { continue }
    $markerCount += 1
    if ($markerCount -gt 1) { throw 'Rollback result stream must contain exactly one machine marker.' }
    if ($strictUtf8.GetByteCount($physicalLine) -gt $maximumMarkerBytes) {
      throw 'Rollback result marker exceeds the byte limit.'
    }
    $marker = $physicalLine
  }
  if ($markerCount -ne 1 -or $null -eq $marker) {
    throw 'Rollback result stream must contain exactly one machine marker.'
  }

  $encodedEnvelope = $marker.Substring($markerPrefix.Length)
  $envelopeBytes = (ConvertFrom-CanonicalRollbackBase64Url -Value $encodedEnvelope -MaximumBytes $maximumMarkerBytes -Label 'Rollback result envelope').Bytes
  try {
    $envelopeText = $strictUtf8.GetString($envelopeBytes)
  } catch {
    throw 'Rollback result envelope must be strict UTF-8.'
  }
  $envelope = ConvertFrom-StrictRollbackJsonBytes -Bytes $envelopeBytes -Label 'Rollback result envelope'
  if ($envelope -isnot [pscustomobject]) { throw 'Rollback result envelope must be an object.' }
  $expectedProperties = @('schema', 'evidence_utf8_base64url', 'evidence_sha256', 'diagnostic_relative_path')
  $actualProperties = @($envelope.PSObject.Properties.Name)
  if ($actualProperties.Count -ne $expectedProperties.Count -or ($actualProperties -join ',') -cne ($expectedProperties -join ',')) {
    throw 'Rollback result envelope property list is invalid.'
  }
  if ($envelope.schema -isnot [string] -or $envelope.schema -cne 'localminidrama.rollback-result.v1') {
    throw 'Rollback result envelope schema is invalid.'
  }
  if ($envelope.evidence_sha256 -isnot [string] -or $envelope.evidence_sha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw 'Rollback result evidence sha256 is invalid.'
  }
  if ($envelope.diagnostic_relative_path -isnot [string] -or
      $envelope.diagnostic_relative_path -cnotmatch '^artifacts/rollback-drill/summary-v3-[a-f0-9]{40}-[a-f0-9]{32}\.json$' -or
      $strictUtf8.GetByteCount($envelope.diagnostic_relative_path) -gt 240) {
    throw 'Rollback result diagnostic relative path is invalid.'
  }
  if ($envelope.evidence_utf8_base64url -isnot [string]) {
    throw 'Rollback result evidence base64url must be a string.'
  }
  $canonicalEnvelope = '{"schema":"localminidrama.rollback-result.v1","evidence_utf8_base64url":"' +
    $envelope.evidence_utf8_base64url + '","evidence_sha256":"' + $envelope.evidence_sha256 +
    '","diagnostic_relative_path":"' + $envelope.diagnostic_relative_path + '"}'
  if ($envelopeText -cne $canonicalEnvelope) { throw 'Rollback result envelope JSON must be canonical.' }

  $evidenceBytes = (ConvertFrom-CanonicalRollbackBase64Url -Value $envelope.evidence_utf8_base64url -MaximumBytes $maximumEvidenceBytes -Label 'Rollback result evidence').Bytes
  $sha256 = $null
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $evidenceSha256 = [BitConverter]::ToString($sha256.ComputeHash($evidenceBytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    if ($null -ne $sha256) { $sha256.Dispose() }
  }
  if ($evidenceSha256 -cne $envelope.evidence_sha256) { throw 'Rollback result evidence digest does not match.' }
  try {
    $evidenceText = $strictUtf8.GetString($evidenceBytes)
  } catch {
    throw 'Rollback result evidence must be strict UTF-8.'
  }
  $evidence = ConvertFrom-StrictRollbackJsonBytes -Bytes $evidenceBytes -Label 'Rollback result evidence'
  if ($evidence -isnot [pscustomobject]) { throw 'Rollback result evidence must be an object.' }
  return [pscustomobject][ordered]@{
    Schema = $envelope.schema
    Evidence = $evidence
    EvidenceBytes = $evidenceBytes
    EvidenceSha256 = $evidenceSha256
    DiagnosticRelativePath = $envelope.diagnostic_relative_path
  }
}

function Get-CheckpointEvidenceProperty {
  param(
    [Parameter(Mandatory = $true)][object]$Object,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Context
  )
  if ($Object -isnot [pscustomobject]) { throw "$Context must be a JSON object." }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { throw "$Context.$Name is required." }
  return $property
}

function Assert-CheckpointEvidenceJsonObject {
  param(
    [Parameter(Mandatory = $true)][AllowNull()][object]$Value,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if ($Value -isnot [pscustomobject]) { throw $Message }
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
  if ($containerId -cnotmatch '^[a-f0-9]{12,64}$') {
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
  } catch {
    throw 'Recovery Compose data bind resolution returned invalid Docker JSON.'
  }
  Assert-CheckpointEvidenceJsonObject -Value $config -Message 'Recovery Compose data bind resolution must be an object.'
  $servicesProperty = Get-CheckpointEvidenceProperty -Object $config -Name 'services' -Context 'Recovery Compose config'
  Assert-CheckpointEvidenceJsonObject -Value $servicesProperty.Value -Message 'Recovery Compose services must be an object.'
  $backendProperty = Get-CheckpointEvidenceProperty -Object $servicesProperty.Value -Name 'backend' -Context 'Recovery Compose services'
  Assert-CheckpointEvidenceJsonObject -Value $backendProperty.Value -Message 'Recovery Compose backend must be an object.'
  $volumesProperty = Get-CheckpointEvidenceProperty -Object $backendProperty.Value -Name 'volumes' -Context 'Recovery Compose backend'
  if ($volumesProperty.Value -isnot [System.Collections.IList]) {
    throw 'Recovery Compose backend volumes must be an array.'
  }
  $validatedMounts = @($volumesProperty.Value | ForEach-Object {
    Assert-CheckpointEvidenceJsonObject -Value $_ -Message 'Recovery Compose volume entries must be objects.'
    $typeProperty = Get-CheckpointEvidenceProperty -Object $_ -Name 'type' -Context 'Recovery Compose volume'
    $sourceProperty = Get-CheckpointEvidenceProperty -Object $_ -Name 'source' -Context 'Recovery Compose volume'
    $targetProperty = Get-CheckpointEvidenceProperty -Object $_ -Name 'target' -Context 'Recovery Compose volume'
    if ($typeProperty.Value -isnot [string] -or
        $sourceProperty.Value -isnot [string] -or
        [string]::IsNullOrWhiteSpace($sourceProperty.Value) -or
        $targetProperty.Value -isnot [string]) {
      throw 'Recovery Compose volume fields have invalid JSON types.'
    }
    $readOnly = $false
    $readOnlyProperty = $_.PSObject.Properties['read_only']
    if ($null -ne $readOnlyProperty) {
      if ($readOnlyProperty.Value -isnot [bool]) {
        throw 'Recovery Compose volume read_only must be a Boolean.'
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
    throw 'Recovery Compose must resolve exactly one mount at /app/data.'
  }
  $dataMount = $dataMounts[0]
  if ($dataMount.type -cne 'bind') {
    throw 'Recovery Compose /app/data mount must resolve to a bind source.'
  }
  if ($dataMount.read_only -eq $true) {
    throw 'Recovery Compose /app/data bind must be read-write.'
  }
  $composeDataDirectory = Assert-RealDirectory -Path $dataMount.source
  Assert-SamePath -Expected $ExpectedDataDirectory -Actual $composeDataDirectory -Label 'Recovery Compose data bind'
}

function Get-RunningServiceEvidence {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [Parameter(Mandatory = $true)][string]$ExpectedRevision
  )
  $containerId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('compose', 'ps', '-q', $Service) -Label "$Service container lookup"
  if ($containerId -cnotmatch '^[a-f0-9]{12,64}$') {
    throw "The $Service service must be running before a rollback checkpoint is created."
  }

  $status = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.State.Status}}') -Label "$Service container status"
  $health = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}') -Label "$Service container health"
  if ($status -cne 'running' -or $health -cne 'healthy') {
    throw "The $Service service must be running and healthy before a rollback checkpoint is created."
  }

  $runtimeImageId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.Image}}') -Label "$Service running image capture"
  if ($runtimeImageId -cnotmatch '^sha256:[a-f0-9]{64}$') {
    throw "Docker did not return an immutable image ID for $Service."
  }

  $imageReference = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{.Config.Image}}') -Label "$Service configured image reference capture"
  if ($imageReference -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$') {
    throw "Docker did not return a safe configured image reference for $Service."
  }
  $imageId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', $imageReference, '--format', '{{.Id}}') -Label "$Service archive image capture"
  if ($imageId -cnotmatch '^sha256:[a-f0-9]{64}$') {
    throw "Docker did not return an immutable archive image ID for $Service."
  }

  $platform = ''
  if ($imageId -cne $runtimeImageId) {
    $descriptorJson = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('inspect', $containerId, '--format', '{{json .ImageManifestDescriptor}}') -Label "$Service running image manifest capture"
    # PowerShell 7 unwraps singleton JSON arrays, so validate the top-level token before parsing.
    $descriptorText = $descriptorJson.Trim()
    if ($descriptorText.Length -lt 2 -or
        $descriptorText[0] -cne [char]'{' -or
        $descriptorText[$descriptorText.Length - 1] -cne [char]'}') {
      throw "$Service running image manifest capture must be a JSON object."
    }
    try {
      $descriptor = ConvertFrom-Json -InputObject $descriptorText
    } catch {
      throw "$Service running image manifest capture returned invalid Docker JSON."
    }
    Assert-CheckpointEvidenceJsonObject -Value $descriptor -Message "$Service running image manifest capture must be a JSON object."
    $digestProperty = Get-CheckpointEvidenceProperty -Object $descriptor -Name 'digest' -Context "$Service running image manifest"
    $mediaTypeProperty = Get-CheckpointEvidenceProperty -Object $descriptor -Name 'mediaType' -Context "$Service running image manifest"
    $platformProperty = Get-CheckpointEvidenceProperty -Object $descriptor -Name 'platform' -Context "$Service running image manifest"
    Assert-CheckpointEvidenceStringPattern -Value $digestProperty.Value -Pattern '^sha256:[a-f0-9]{64}$' -Message "$Service running image manifest digest is invalid."
    if ($mediaTypeProperty.Value -isnot [string] -or $mediaTypeProperty.Value -cnotin @(
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.docker.distribution.manifest.v2+json'
    )) {
      throw "$Service running image manifest media type is invalid."
    }
    Assert-CheckpointEvidenceJsonObject -Value $platformProperty.Value -Message "$Service running image platform must be a JSON object."
    $osProperty = Get-CheckpointEvidenceProperty -Object $platformProperty.Value -Name 'os' -Context "$Service running image platform"
    $architectureProperty = Get-CheckpointEvidenceProperty -Object $platformProperty.Value -Name 'architecture' -Context "$Service running image platform"
    foreach ($component in @($osProperty.Value, $architectureProperty.Value)) {
      if ($component -isnot [string] -or $component -cnotmatch '^[a-z0-9][a-z0-9._-]{0,63}$') {
        throw "$Service running image platform is invalid."
      }
    }
    $platform = "$($osProperty.Value)/$($architectureProperty.Value)"
    $variantProperty = $platformProperty.Value.PSObject.Properties['variant']
    if ($null -ne $variantProperty) {
      if ($variantProperty.Value -isnot [string] -or $variantProperty.Value -cnotmatch '^[a-z0-9][a-z0-9._-]{0,63}$') {
        throw "$Service running image platform variant is invalid."
      }
      $platform += "/$($variantProperty.Value)"
    }
    $selectedManifestId = Get-CheckedScalar -FilePath 'docker' -ArgumentList @('image', 'inspect', '--platform', $platform, $imageId, '--format', '{{.Id}}') -Label "$Service archive platform manifest capture"
    if ($selectedManifestId -cne $digestProperty.Value) {
      throw "The immutable archive image for $Service does not contain the running platform manifest."
    }
  }

  $revision = Get-ImageRevision -ImageReference $imageId -Label "$Service image revision capture" -Platform $platform
  if ($revision -cne $ExpectedRevision) {
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
$callerEnvironmentSnapshot = Get-RollbackEnvironmentSnapshot -Names @(
  'LOCALMINIDRAMA_CONFIG_DIR',
  'LOCALMINIDRAMA_CONFIG_PATH',
  'LOCALMINIDRAMA_DATA_DIR',
  'LOCALMINIDRAMA_IMAGE_TAG',
  'LOCALMINIDRAMA_BUILD_REVISION'
)
$directoryLock = $null
$checkpointDirectoryLock = $null
$configDirectoryLock = $null
$archiveAuthority = $null
$dataBindSourceAuthority = $null
$backupHashAuthority = $null
$summaryAuthority = $null
$metadataAuthority = $null
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

try {
  Push-Location $repoRoot
  $locationPushed = $true
  $dirty = Get-CheckedScalar -FilePath 'git' -ArgumentList @('status', '--porcelain', '--untracked-files=normal') -Label 'Git status'
  if (-not [string]::IsNullOrWhiteSpace($dirty)) {
    throw 'Rollback checkpoint requires a clean Git working tree.'
  }
  $commit = Get-CheckedScalar -FilePath 'git' -ArgumentList @('rev-parse', 'HEAD') -Label 'Commit capture'
  if ($commit -cnotmatch '^[a-f0-9]{40}$') { throw 'Git did not return a full commit SHA.' }
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
  $checkpointDirectoryLock = Open-RollbackWritableDirectoryAuthority -Path $checkpoint -Label 'Rollback checkpoint'
  Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory
  $configArchiveRoot = Join-Path $checkpoint 'configs'
  New-Item -ItemType Directory -Path $configArchiveRoot | Out-Null
  $configDirectoryLock = Open-RollbackDirectoryIdentityLock -Path $configArchiveRoot -Label 'Rollback checkpoint config directory'
  $composeArchive = Join-Path $checkpoint 'docker-compose.yml'
  $configArchive = Join-Path $configArchiveRoot 'config.yaml'
  $dataBindSourceArchive = Join-Path $checkpoint 'data-bind-source.txt'
  Copy-Item -LiteralPath (Join-Path $repoRoot 'docker-compose.yml') -Destination $composeArchive
  $dataBindSourceAuthority = Publish-RollbackUtf8FileAtomically -Path $dataBindSourceArchive -Value "$runtimeDataDirectory`n" -Label 'Rollback checkpoint data bind source' -ParentDirectoryAuthority $checkpointDirectoryLock
  Invoke-Checked -FilePath 'node' -ArgumentList @((Join-Path $repoRoot 'scripts\runtime-config-policy.cjs'), $runtimeConfigSource, $configArchive) -Label 'Runtime config sanitization' | Out-Null
  Assert-RegularFile -Path $configArchive
  Assert-RollbackFileAuthority -Authority $dataBindSourceAuthority | Out-Null
  $composeHash = Get-RollbackPathSha256 -Path $composeArchive -Label 'Archived Compose file'
  $configHash = Get-RollbackPathSha256 -Path $configArchive -Label 'Archived runtime config'
  $dataBindSourceHash = Get-RollbackFileAuthoritySha256 -Authority $dataBindSourceAuthority
  $imageArchive = Join-Path $checkpoint 'images.tar'
  $rollbackTag = "rollback-checkpoint-$($commit.Substring(0, 12))"
  $backendRollbackRef = "localminidrama-backend:$rollbackTag"
  $frontendRollbackRef = "localminidrama-frontend:$rollbackTag"
  Assert-SafeRollbackPaths -CheckpointDirectory $checkpoint -DataDirectory $runtimeDataDirectory
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $backend.image_id, $backendRollbackRef) -Label 'Backend checkpoint image tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'tag', $frontend.image_id, $frontendRollbackRef) -Label 'Frontend checkpoint image tag' | Out-Null
  Invoke-Checked -FilePath 'docker' -ArgumentList @('image', 'save', '--output', $imageArchive, $backendRollbackRef, $frontendRollbackRef) -Label 'Checkpoint image archive' | Out-Null
  $imageArchiveHash = Get-RollbackPathSha256 -Path $imageArchive -Label 'Archived Docker images'
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
    $descriptorBackup = Invoke-RollbackDescriptorBackup -DestinationPath $backupPath -DataDirectory $runtimeDataDirectory -RepositoryRoot $repoRoot -Label 'Data backup' -ParentDirectoryAuthority $checkpointDirectoryLock
    $archiveAuthority = $descriptorBackup.Authority
    $capturedArchiveIdentity = $descriptorBackup.FilesystemIdentity
    Assert-RollbackPathIdentity -Path $backupPath -ExpectedIdentity $capturedArchiveIdentity -Label 'Rollback archive after backup' | Out-Null
    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root after backup' | Out-Null
    $backupHash = $descriptorBackup.ArchiveSha256
    if ((Get-RollbackFileAuthoritySha256 -Authority $archiveAuthority) -cne $backupHash) {
      throw 'Rollback archive differs from its committed descriptor result.'
    }
    $backupHashAuthority = Publish-RollbackUtf8FileAtomically -Path (Join-Path $checkpoint 'data.sha256.txt') -Value "$backupHash`n" -Label 'Rollback checkpoint data hash' -ParentDirectoryAuthority $checkpointDirectoryLock

    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root before drill' | Out-Null
    $drillInvocation = Invoke-NativeCommandWithTimeout -FilePath 'node' -ArgumentList @(
      (Join-Path $repoRoot 'scripts\run-rollback-drill-launcher.cjs'),
      '--archive', $backupPath,
      '--data-root', $runtimeDataDirectory
    ) -Label 'Rollback drill' -TimeoutMilliseconds 900000 -CaptureOutputBytes -MaximumOutputBytes 2097152 -MaximumErrorBytes 262144
    Write-NativeDiagnostic -Invocation $drillInvocation -Label 'Rollback drill'
    $validatorInvocation = Invoke-NativeCommandWithTimeout -FilePath 'node' -ArgumentList @(
      (Join-Path $repoRoot 'scripts\rollback-drill-evidence.cjs'),
      '--validate-result-stream',
      '--expected-version', $version,
      '--expected-commit', $commit,
      '--expected-mode', 'checkpoint-bound'
    ) -Label 'Rollback result validation' -TimeoutMilliseconds 60000 -CaptureOutputBytes -MaximumOutputBytes 65536 -MaximumErrorBytes 262144 -StandardInputBytes $drillInvocation.StandardOutputBytes
    Write-NativeDiagnostic -Invocation $validatorInvocation -Label 'Rollback result validation'
    $rollbackResult = ConvertFrom-RollbackResultOutput -Bytes $drillInvocation.StandardOutputBytes
    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root after drill' | Out-Null
    Assert-RollbackPathIdentity -Path $backupPath -ExpectedIdentity $capturedArchiveIdentity -Label 'Rollback archive after drill' | Out-Null
    $actualBackupHash = Get-RollbackFileAuthoritySha256 -Authority $archiveAuthority
    $actualDataRootIdentity = Get-RollbackPathIdentity -Path $runtimeDataDirectory
    $validatedEvidence = Assert-CheckpointDrillEvidence -Summary $rollbackResult.Evidence -ExpectedCommit $commit -ExpectedVersion $version -ExpectedBackupHash $backupHash -ActualBackupHash $actualBackupHash -ExpectedDataRootIdentity $capturedDataRootIdentity -ActualDataRootIdentity $actualDataRootIdentity
    $summaryArchive = Join-Path $checkpoint 'rollback-drill-summary.json'
    $summaryAuthority = New-RollbackFileAuthorityFromBytes -Path $summaryArchive -Bytes $rollbackResult.EvidenceBytes -Label 'Rollback checkpoint drill summary'
    Assert-RollbackFileAuthority -Authority $summaryAuthority | Out-Null
    $summaryHash = Get-RollbackFileAuthoritySha256 -Authority $summaryAuthority
    if ($summaryHash -cne $rollbackResult.EvidenceSha256) {
      throw 'Rollback checkpoint drill summary digest differs from captured evidence bytes.'
    }

    Assert-RollbackPathIdentity -Path $runtimeDataDirectory -ExpectedIdentity $capturedDataRootIdentity -Label 'Rollback data root before metadata publication' | Out-Null
    Assert-RollbackPathIdentity -Path $backupPath -ExpectedIdentity $capturedArchiveIdentity -Label 'Rollback archive before metadata publication' | Out-Null
    $publishedBackupHash = Get-RollbackFileAuthoritySha256 -Authority $archiveAuthority
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
    Assert-RollbackFileAuthority -Authority $summaryAuthority | Out-Null
    if ((Get-RollbackFileAuthoritySha256 -Authority $summaryAuthority) -cne $summaryHash) {
      throw 'Rollback checkpoint drill summary changed before metadata publication.'
    }
    $metadataPath = Join-Path $checkpoint 'metadata.json'
    $metadataText = "$(ConvertTo-Json $metadata -Depth 6)`n"
    $metadataAuthority = Publish-RollbackUtf8FileAtomically -Path $metadataPath -Value $metadataText -Label 'Rollback checkpoint metadata' -ParentDirectoryAuthority $checkpointDirectoryLock
    Assert-RollbackFileAuthority -Authority $metadataAuthority | Out-Null
    Write-Output "Rollback checkpoint ready: $checkpoint"
    Write-Output 'Provider credentials were excluded from the archived runtime config and must be configured and tested again after restore.'
  } catch {
    if ($dockerStopped) {
      try {
        Start-CapturedDeployment -Backend $backend -Frontend $frontend -Revision $commit -ConfigDirectory $runtimeConfigDirectory -ConfigPath $runtimeConfigSource -DataDirectory $runtimeDataDirectory -CheckpointDirectory $checkpoint
      } catch {
        [void]$cleanupErrors.Add($_)
      }
    }
    throw
  }
} catch {
  $primaryError = $_
  throw
} finally {
  try {
    if ($null -ne $metadataAuthority) { Close-RollbackFilePublicationAuthority -Authority $metadataAuthority }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $summaryAuthority) { $summaryAuthority.Stream.Dispose() }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $backupHashAuthority) { Close-RollbackFilePublicationAuthority -Authority $backupHashAuthority }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $archiveAuthority) { Close-RollbackFilePublicationAuthority -Authority $archiveAuthority }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $dataBindSourceAuthority) { Close-RollbackFilePublicationAuthority -Authority $dataBindSourceAuthority }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $configDirectoryLock) {
      Close-RollbackDirectoryIdentityLock -Handle $configDirectoryLock -Label 'Rollback checkpoint config directory'
    }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $checkpointDirectoryLock) {
      Close-RollbackWritableDirectoryAuthority -Authority $checkpointDirectoryLock
    }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    Restore-RollbackEnvironmentSnapshot -Snapshot $callerEnvironmentSnapshot
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($locationPushed) { Pop-Location }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  try {
    if ($null -ne $directoryLock) {
      Close-RollbackDirectoryIdentityLock -Handle $directoryLock -Label 'Rollback data root'
    }
  } catch {
    [void]$cleanupErrors.Add($_)
  }
  Complete-RollbackInvocation -PrimaryError $primaryError -CleanupErrors $cleanupErrors
}
}

if ($MyInvocation.InvocationName -ne '.') {
  if ([string]::IsNullOrWhiteSpace($CheckpointDirectory)) {
    throw 'CheckpointDirectory is required.'
  }
  Invoke-ReleaseRollbackCheckpoint -CheckpointDirectory $CheckpointDirectory
}
