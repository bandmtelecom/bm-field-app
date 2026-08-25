<#
.SYNOPSIS
  B&M Field App - weekly backup. Runs on Windows.

.DESCRIPTION
  Pulls everything out of the live app and drops one dated zip in the backup
  folder. Meant to be run unattended by Task Scheduler; safe to run by hand.

  Contents of the zip:
    data\          every table as CSV, straight from the live database
    rate-cards\    the .xlsx sent to the customer, one per completed job
    reports\       the field report PDF, one per completed job
    code\          git bundle — whole repo, full history (skipped if no git)
    MANIFEST.txt   what was captured, what failed, how to restore it

  WHY POWERSHELL and not the Node version in this same folder: this has to run
  on the Windows machine, because that is the only place that can reach the app
  on Render at all - the Claude cloud session and its Linux workspace are both
  blocked from onrender.com. Windows PowerShell 5.1 ships with Windows, so
  there is nothing to install and nothing to keep updated.

  WHY NOT STRAIGHT TO THE OFFICE FILE SERVER: \\BMFILESERV sits behind a
  firewall that takes real effort to get through from a new machine, and an
  elevated shell cannot see it at all. Not worth fighting for a weekly copy.
  The zip lands in OneDrive (so it is offsite automatically) and gets carried
  to the server by hand. If the destination is ever unreachable the backup is
  still kept locally - see the delivery block near the end.

.PARAMETER Destination
  Where the dated zip lands. Defaults to a folder in OneDrive, so the archive
  gets an offsite copy for free. Copy it to the office server when convenient -
  the file server sits behind a firewall this script cannot reliably cross.

.PARAMETER RepoPath
  The bm-field-app clone, for the code bundle.

.PARAMETER SkipCode
  Skip the git bundle (data and documents only).

.EXAMPLE
  .\Invoke-WeeklyBackup.ps1
  .\Invoke-WeeklyBackup.ps1 -Destination 'D:\test' -SkipCode

.NOTES
  THE TOKEN IS NOT IN THIS FILE, ON PURPOSE. This script lives in the repo,
  which is public on GitHub. It reads the token from, in order:
    1. $env:BM_BACKUP_TOKEN
    2. %LOCALAPPDATA%\bm-field-backup\token.txt
  Both are on the local machine and neither is in the backup folder - anyone who
  can read a backup must not thereby be handed a key to the live database.

  Exit codes:  0 = complete   2 = built but incomplete (read MANIFEST)   1 = failed
#>

[CmdletBinding()]
param(
  [string] $Destination = "$env:USERPROFILE\OneDrive\BM Field App Backups",
  [string] $ApiBase     = 'https://bm-field-api.onrender.com',
  [string] $RepoPath    = "$env:USERPROFILE\OneDrive\Documents\GitHub\GitHub\bm-field-app",
  [switch] $SkipCode
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
# Invoke-WebRequest in 5.1 renders a progress bar that costs more time than the
# download itself on a big file. Silence it.
$ProgressPreference = 'SilentlyContinue'
# 5.1 can still default to TLS 1.0, which Cloudflare (in front of Render) refuses.
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$Problems = New-Object System.Collections.ArrayList
function Note([string]$m) { [void]$Problems.Add($m); Write-Warning $m }

# Where per-machine state lives (token, logs). Normally %LOCALAPPDATA%, but a
# scheduled task can run under an account where that is not set, and a backup
# that dies on a missing environment variable is a backup that silently stops
# happening. Fall back rather than crash.
function Get-LocalStateRoot {
  $base = $env:LOCALAPPDATA
  if (-not $base) { $base = $env:APPDATA }
  if (-not $base) { $base = [Environment]::GetFolderPath('LocalApplicationData') }
  if (-not $base) { $base = [System.IO.Path]::GetTempPath() }
  return (Join-Path $base 'bm-field-backup')
}
$script:StateRoot = Get-LocalStateRoot

# --------------------------------------------------------------- the token

function Get-BackupToken {
  if ($env:BM_BACKUP_TOKEN) { return $env:BM_BACKUP_TOKEN }
  $f = Join-Path $script:StateRoot 'token.txt'
  if (Test-Path -LiteralPath $f) {
    $t = (Get-Content -LiteralPath $f -Raw).Trim()
    if ($t) { return $t }
  }
  throw @"
No backup token found. The backup cannot run without it.

Put the token in a file (this only has to be done once):

  mkdir "$($script:StateRoot)"
  notepad "$(Join-Path $script:StateRoot 'token.txt')"

Paste the same value that is set as BACKUP_TOKEN in Render on the
bm-field-api service, save, close. Do not put it on the network share.
"@
}

# ----------------------------------------------------------------- fetching

function Get-ApiFile {
  param(
    [Parameter(Mandatory)] [string] $Path,
    [Parameter(Mandatory)] [string] $OutFile,
    [int] $Attempts = 4
  )
  $headers = @{ 'X-Backup-Token' = $script:Token }
  for ($i = 1; $i -le $Attempts; $i++) {
    try {
      Invoke-WebRequest -Uri "$ApiBase$Path" -Headers $headers -OutFile $OutFile `
        -TimeoutSec 300 -UseBasicParsing
      return $true
    } catch {
      $code = $null
      try { $code = [int]$_.Exception.Response.StatusCode } catch { }

      # Wrong credentials will be wrong on the retry too. Fail loudly and now.
      if ($code -eq 401 -or $code -eq 403) {
        throw "The API rejected the backup token (HTTP $code). Check that the token file matches BACKUP_TOKEN in Render, and that bm-field-api has finished deploying."
      }
      if ($i -eq $Attempts) { throw $_ }
      $wait = 5 * $i    # Render can be slow to wake; give it room
      Write-Host ("    retry {0} in {1}s ({2})" -f $i, $wait, $_.Exception.Message)
      Start-Sleep -Seconds $wait
    }
  }
}

function Get-SafeName([string]$s) {
  if (-not $s) { return 'job' }
  $out = ($s -replace '[^A-Za-z0-9._-]+', '-').Trim('-')
  if ($out) { return $out } else { return 'job' }
}

# --------------------------------------------------------------------- run

$stamp   = Get-Date -Format 'yyyy-MM-dd'     # local date, deliberately not UTC
$work    = Join-Path ([System.IO.Path]::GetTempPath()) ("bm-backup-" + [guid]::NewGuid().ToString('N'))
$rootDir = Join-Path $work "bm-field-backup-$stamp"
$logDir  = Join-Path $script:StateRoot 'logs'
$null = New-Item -ItemType Directory -Path $rootDir -Force
$null = New-Item -ItemType Directory -Path $logDir  -Force
$logFile = Join-Path $logDir "backup-$stamp.log"

try { Start-Transcript -Path $logFile -Force | Out-Null } catch { }

$exitCode = 0
try {
  $script:Token = Get-BackupToken
  Write-Host "B&M Field App weekly backup - $stamp"
  Write-Host "  api:         $ApiBase"
  Write-Host "  destination: $Destination"
  Write-Host ""

  # 1 ---- the database -----------------------------------------------------
  Write-Host "[1/4] data"
  $dataDir = Join-Path $rootDir 'data'
  $null = New-Item -ItemType Directory -Path $dataDir -Force
  $dataZip = Join-Path $work 'data.zip'
  Get-ApiFile -Path '/export/backup.zip' -OutFile $dataZip | Out-Null
  Expand-Archive -LiteralPath $dataZip -DestinationPath $dataDir -Force

  $jobsCsv = Join-Path $dataDir 'jobs.csv'
  if (-not (Test-Path -LiteralPath $jobsCsv)) {
    throw "The backup zip contains no jobs.csv. The export looks broken - do not trust this archive."
  }
  # Import-Csv understands quoted fields containing commas and newlines, which
  # the tech narratives are full of. Never split these by hand.
  $jobs = @(Import-Csv -LiteralPath $jobsCsv)
  Write-Host ("      {0} tables, {1} jobs" -f (Get-ChildItem $dataDir -Filter *.csv).Count, $jobs.Count)

  # 2 ---- rate cards + field reports ---------------------------------------
  # Completed jobs only: the rate card is generated from the draft that gets
  # written at Mark Complete, so an open job is a guaranteed 404.
  $done = @($jobs | Where-Object { $_.status -eq 'complete' })
  Write-Host ("[2/4] rate cards + reports for {0} completed job(s)" -f $done.Count)
  $cardsDir   = Join-Path $rootDir 'rate-cards'
  $reportsDir = Join-Path $rootDir 'reports'
  $null = New-Item -ItemType Directory -Path $cardsDir   -Force
  $null = New-Item -ItemType Directory -Path $reportsDir -Force

  $cards = 0; $reports = 0
  foreach ($j in $done) {
    $label = Get-SafeName $j.bm_number
    if ($label -eq 'job') { $label = Get-SafeName $j.id }
    try {
      Get-ApiFile -Path "/jobs/$($j.id)/invoice.xlsx" -OutFile (Join-Path $cardsDir "$label.xlsx") -Attempts 2 | Out-Null
      $cards++
    } catch { Note ("rate card for job {0}: {1}" -f $label, $_.Exception.Message) }
    try {
      Get-ApiFile -Path "/jobs/$($j.id)/report.pdf" -OutFile (Join-Path $reportsDir "$label.pdf") -Attempts 2 | Out-Null
      $reports++
    } catch { Note ("report for job {0}: {1}" -f $label, $_.Exception.Message) }
  }
  Write-Host ("      {0} rate card(s), {1} report(s)" -f $cards, $reports)

  # 3 ---- the code ---------------------------------------------------------
  # A bundle, not a zip of the source: it restores with `git clone`, history
  # intact, so a bad push can be walked back commit by commit.
  $bundleNote = 'skipped (-SkipCode)'
  if (-not $SkipCode) {
    Write-Host "[3/4] code bundle"
    $git = $null
    # 'git' first so a normal install on PATH wins; then the copy that ships
    # inside GitHub Desktop, which is the only git on a lot of Windows boxes.
    $candidates = @('git', 'git.exe')
    if ($env:LOCALAPPDATA) {
      $candidates += (Join-Path $env:LOCALAPPDATA 'GitHubDesktop\app-*\resources\app\git\cmd\git.exe')
    }
    $candidates += 'C:\Program Files\Git\cmd\git.exe'
    foreach ($c in $candidates) {
      $found = @(Get-Command $c -ErrorAction SilentlyContinue)
      if ($found.Count) { $git = $found[0].Source; break }
      $globbed = @(Get-ChildItem -Path $c -ErrorAction SilentlyContinue)
      if ($globbed.Count) { $git = $globbed[0].FullName; break }
    }
    if (-not $git) {
      $bundleNote = 'SKIPPED - git not found on this machine'
      Note "code bundle skipped: git.exe not found. The code is still on GitHub; only the offline copy is missing."
    } elseif (-not (Test-Path -LiteralPath $RepoPath)) {
      $bundleNote = "SKIPPED - repo not found at $RepoPath"
      Note "code bundle skipped: no repo at $RepoPath"
    } else {
      $codeDir = Join-Path $rootDir 'code'
      $null = New-Item -ItemType Directory -Path $codeDir -Force
      try {
        $head = (& $git -C $RepoPath rev-parse HEAD 2>&1)
        & $git -C $RepoPath bundle create (Join-Path $codeDir 'bm-field-app.bundle') --all 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "git bundle exited $LASTEXITCODE" }
        $bundleNote = "git bundle at $($head.ToString().Substring(0,8)) (full history, all branches)"
        Write-Host "      $bundleNote"
      } catch {
        $bundleNote = "FAILED - $($_.Exception.Message)"
        Note "code bundle: $($_.Exception.Message)"
      }
    }
  } else { Write-Host "[3/4] code bundle skipped" }

  # 4 ---- manifest + zip ---------------------------------------------------
  Write-Host "[4/4] manifest + zip"
  $countLines = @(); $total = 0
  foreach ($f in (Get-ChildItem $dataDir -Filter *.csv | Sort-Object Name)) {
    # Import-Csv again, so multi-line narratives are counted as ONE row each.
    $n = @(Import-Csv -LiteralPath $f.FullName).Count
    $total += $n
    $countLines += ('{0,8}  {1}' -f $n, $f.Name)
  }

  $status = if ($Problems.Count) {
    "INCOMPLETE - $($Problems.Count) problem(s):`r`n" + (($Problems | ForEach-Object { "  - $_" }) -join "`r`n")
  } else { 'COMPLETE - everything expected was captured.' }

  $manifest = @(
    'B&M Field App - weekly backup'
    "Taken $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') on $env:COMPUTERNAME"
    "Source $ApiBase"
    ''
    'CONTENTS'
    '  data\         every table as CSV, straight from the live database'
    '  rate-cards\   the .xlsx sent to the customer, one per completed job'
    '  reports\      the field report PDF, one per completed job'
    '  code\         git bundle - whole repo, full history, one file'
    ''
    'ROWS PER TABLE'
    ($countLines -join "`r`n")
    ('{0,8}  TOTAL' -f $total)
    ''
    "RATE CARDS  $cards of $($done.Count) completed jobs"
    "REPORTS     $reports of $($done.Count) completed jobs"
    "CODE        $bundleNote"
    ''
    $status
    ''
    'HOW TO RESTORE'
    '  Code:  git clone code\bm-field-app.bundle bm-field-app'
    '  Data:  create the tables from supabase\migrations\ in the cloned repo,'
    '         then import each CSV. Order matters - parents before children:'
    '         customers and closures, then jobs, then visits, then locations,'
    '         then cables / shots / downtime / location_units.'
    '  The CSVs are plain text. They do not need this app, or Supabase, or'
    '  anything else to still exist in order to be readable.'
  ) -join "`r`n"
  Set-Content -LiteralPath (Join-Path $rootDir 'MANIFEST.txt') -Value $manifest -Encoding ASCII

  # Build the zip locally first, then copy. Compress-Archive straight onto a
  # network share is slow and leaves a half-written file if the link drops.
  $localZip = Join-Path $work "bm-field-backup-$stamp.zip"
  Compress-Archive -Path $rootDir -DestinationPath $localZip -CompressionLevel Optimal -Force

  # Deliver it. If the destination is unreachable - a share behind a firewall, a
  # disconnected drive - the backup itself is still perfectly good, so park it
  # somewhere local rather than throwing away work that succeeded. Losing a
  # finished backup over a delivery problem is the wrong way to fail.
  $src      = (Get-Item -LiteralPath $localZip).Length
  $finalZip = $null
  try {
    if (-not (Test-Path -LiteralPath $Destination)) {
      $null = New-Item -ItemType Directory -Path $Destination -Force
      Write-Host "      created $Destination"
    }
    $candidate = Join-Path $Destination "bm-field-backup-$stamp.zip"
    Copy-Item -LiteralPath $localZip -Destination $candidate -Force

    # Trust nothing: confirm the file is actually there and the right size.
    $dst = (Get-Item -LiteralPath $candidate).Length
    if ($src -ne $dst) { throw "the copy came out the wrong size ($dst vs $src bytes)" }
    $finalZip = $candidate
  } catch {
    $fallbackDir = Join-Path $script:StateRoot 'undelivered'
    $null = New-Item -ItemType Directory -Path $fallbackDir -Force
    $finalZip = Join-Path $fallbackDir "bm-field-backup-$stamp.zip"
    Copy-Item -LiteralPath $localZip -Destination $finalZip -Force
    Note ("could not write to {0} ({1}). The backup was kept at {2} instead - copy it across by hand." -f `
          $Destination, $_.Exception.Message, $finalZip)
  }

  $dst = (Get-Item -LiteralPath $finalZip).Length
  Write-Host ""
  Write-Host ("{0}  ({1:N1} MB)" -f $finalZip, ($dst / 1MB))

  if ($Problems.Count) {
    Write-Host ""
    Write-Host "Built, but INCOMPLETE - $($Problems.Count) problem(s). See MANIFEST.txt in the zip."
    $exitCode = 2
  } else {
    Write-Host ""
    Write-Host "Complete."
  }
}
catch {
  Write-Host ""
  Write-Error "Backup FAILED: $($_.Exception.Message)"
  $exitCode = 1
}
finally {
  if (Test-Path -LiteralPath $work) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
  try { Stop-Transcript | Out-Null } catch { }
}

exit $exitCode
