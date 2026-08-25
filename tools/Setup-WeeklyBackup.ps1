<#
.SYNOPSIS
  One-time setup for the B&M Field App weekly backup. Run once, on the PC.

.DESCRIPTION
  Does the fiddly parts of the setup in one go:

    1. Stores the backup token in %LOCALAPPDATA%\bm-field-backup\token.txt
       and locks the file down so only you (and admins) can read it.
    2. Runs a real backup, so you find out NOW if something is wrong.
    3. Registers the Thursday 4pm scheduled task.

  Everything here can also be done by hand — see docs\BACKUP.md. This just
  saves typing and gets the file permissions right, which the by-hand version
  leaves at whatever the folder happened to inherit.

  Safe to run again: it overwrites the token and re-registers the task rather
  than creating a duplicate.

.PARAMETER Token
  The same value set as BACKUP_TOKEN on the bm-field-api service in Render.
  Leave it off and you'll be prompted (the prompt hides what you paste).

.PARAMETER Destination
  Where the weekly zip lands.

.PARAMETER SkipTestRun
  Don't take a backup during setup. Not recommended — the test run is the
  only thing that proves the token and the share both actually work.

.PARAMETER SkipTask
  Set up the token but don't register the scheduled task.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\Setup-WeeklyBackup.ps1

.NOTES
  Registering a scheduled task normally needs an elevated PowerShell.
  Right-click PowerShell -> Run as administrator.
#>

[CmdletBinding()]
param(
  [string] $Token,
  [string] $Destination = "$env:USERPROFILE\OneDrive\BM Field App Backups",
  [string] $TaskName    = 'BM Field App weekly backup',
  [switch] $SkipTestRun,
  [switch] $SkipTask
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$MIN_TOKEN_LENGTH = 32
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$backupPs1  = Join-Path $scriptDir 'Invoke-WeeklyBackup.ps1'
$repoRoot   = Split-Path -Parent $scriptDir

function Get-LocalStateRoot {
  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = $env:APPDATA }
  if (-not $base) { $base = [Environment]::GetFolderPath('LocalApplicationData') }
  if (-not $base) { $base = [System.IO.Path]::GetTempPath() }
  return (Join-Path $base 'bm-field-backup')
}

function Test-IsAdmin {
  try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

Write-Host ''
Write-Host 'B&M Field App - weekly backup setup'
Write-Host '==================================='
Write-Host ''

if (-not (Test-Path -LiteralPath $backupPs1)) {
  throw "Can't find Invoke-WeeklyBackup.ps1 next to this script (looked in $scriptDir). Run this from the repo's tools folder."
}

# ---------------------------------------------------------- 1. the token

if (-not $Token) {
  Write-Host 'Paste the backup token (the same value as BACKUP_TOKEN in Render).'
  Write-Host 'It will not be shown as you paste.'
  $secure = Read-Host -AsSecureString '  Token'
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try   { $Token = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
$Token = $Token.Trim()

if ($Token.Length -lt $MIN_TOKEN_LENGTH) {
  throw "That token is only $($Token.Length) characters. The API requires at least $MIN_TOKEN_LENGTH and will reject anything shorter, so setting it up now would just fail on Thursday."
}

$stateRoot = Get-LocalStateRoot
$tokenFile = Join-Path $stateRoot 'token.txt'
$null = New-Item -ItemType Directory -Path $stateRoot -Force

# -NoNewline: a trailing newline is harmless (the script trims) but this keeps
# the file byte-identical to what was pasted, which makes it easy to compare
# against Render when something does not line up.
Set-Content -LiteralPath $tokenFile -Value $Token -NoNewline -Encoding ASCII

# Lock it down. By default this file inherits the profile's permissions, which
# on a shared or domain-joined box can be broader than you'd think. This is a
# live database credential; treat it like one.
$acl_ok = $false
try {
  $me = "$env:USERDOMAIN\$env:USERNAME"
  if (-not $env:USERDOMAIN) { $me = $env:USERNAME }
  # /inheritance:r drops inherited entries, then grant only me + Administrators.
  $null = & icacls $tokenFile /inheritance:r /grant:r "${me}:(R,W)" "BUILTIN\Administrators:(F)" 2>&1
  $acl_ok = ($LASTEXITCODE -eq 0)
} catch { $acl_ok = $false }

Write-Host "  token saved   $tokenFile"
if ($acl_ok) {
  Write-Host '  permissions   locked to you + Administrators'
} else {
  Write-Warning "Could not tighten permissions on $tokenFile. It still works, but check who can read that file."
}
Write-Host ''

# ------------------------------------------------------- 2. prove it works

if (-not $SkipTestRun) {
  Write-Host 'Taking a real backup now, to prove the token and the share both work.'
  Write-Host 'This is the first time anything has talked to the live API - if it'
  Write-Host 'fails, better now than unattended on Thursday.'
  Write-Host ''

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupPs1 `
      -Destination $Destination -RepoPath $repoRoot
  $rc = $LASTEXITCODE

  Write-Host ''
  switch ($rc) {
    0 { Write-Host '  test run: COMPLETE.' }
    2 { Write-Warning 'Test run finished but the backup is INCOMPLETE. Open MANIFEST.txt in the zip and read what is missing before trusting this.' }
    default {
      throw "The test backup FAILED (exit $rc). Not registering the scheduled task - a task that fails every Thursday is worse than no task, because it looks like it is working. Fix the error above, then run this setup again."
    }
  }
  Write-Host ''
} else {
  Write-Host '  test run skipped (-SkipTestRun)'
  Write-Host ''
}

# ---------------------------------------------------- 3. the scheduled task

if ($SkipTask) {
  Write-Host '  scheduled task skipped (-SkipTask)'
} elseif (-not (Test-IsAdmin)) {
  Write-Warning @"
Not running as administrator, so the scheduled task was NOT registered.

The token is saved and the backup works - you just need to schedule it.
Reopen PowerShell with 'Run as administrator' and run this again, or paste
the Register-ScheduledTask block from docs\BACKUP.md.
"@
} else {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"$backupPs1`" " +
               "-Destination `"$Destination`" -RepoPath `"$repoRoot`"")
  $trigger  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At 4pm
  # StartWhenAvailable: if the PC is off at 4pm Thursday, run at the next
  # opportunity instead of silently skipping the week.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 15)

  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "  replaced the existing '$TaskName' task"
  }

  $null = Register-ScheduledTask -TaskName $TaskName -Action $action `
    -Trigger $trigger -Settings $settings `
    -Description "Backs up the B&M Field App to $Destination. See docs\BACKUP.md."

  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "  scheduled     '$TaskName'"
  Write-Host "  next run      $($info.NextRunTime)"
}

Write-Host ''
Write-Host 'Done.'
Write-Host ''
Write-Host "Backups land in:  $Destination"
Write-Host "Logs land in:     $(Join-Path (Get-LocalStateRoot) 'logs')"
Write-Host ''
Write-Host 'To check on it later:'
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName' | Select LastRunTime, LastTaskResult, NextRunTime"
Write-Host '  LastTaskResult 0 = good, 2 = incomplete (read MANIFEST.txt), 1 = failed'
Write-Host ''
