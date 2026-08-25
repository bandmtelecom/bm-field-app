# Backups — how they work and how to restore

Everything B&M has lives in one Supabase database. If it goes, the jobs, the
visits, the closure registry, the priced drafts and the rate card all go with
it. This is the copy that survives that.

**Where backups live:** `%USERPROFILE%\OneDrive\BM Field App Backups`
One dated zip per week, and OneDrive gives it an offsite copy automatically.

**Why not straight onto `\\BMFILESERV`:** the office file server sits behind a
firewall that takes real effort to get through from any new machine, and an
elevated PowerShell cannot see it at all (elevation creates a separate logon
session with its own view of the network). Not worth fighting for a weekly copy.
Austin carries the zip across by hand when convenient. If you ever do want it
automated, pass `-Destination '\\BMFILESERV\bmtelecom\B&M Field APP'` and sort
the credentials out first.

---

## Three ways to take one

| | who runs it | when | what you get |
|---|---|---|---|
| **Admin → ⬇ Download full backup** | any admin, in the app | on demand | table CSVs only |
| **`tools\Invoke-WeeklyBackup.ps1`** | Windows Task Scheduler | every Thursday | everything |
| `tools/weekly-backup.mjs` | Node, anywhere that can reach the API | manual | everything |

Use the app button before you do anything risky to the database. The scheduled
PowerShell script is the real backup.

---

## The weekly backup

```
bm-field-backup-YYYY-MM-DD.zip
├── data\          every table as CSV, straight from the live database
├── rate-cards\    the .xlsx we'd send the customer, one per completed job
├── reports\       the field report PDF, one per completed job
├── code\          git bundle — the whole repo, full history, one file
└── MANIFEST.txt   what was captured, what failed, how to restore it
```

### Why it runs on the Windows PC and not in the cloud

This was the plan at first and it does not work. The Claude cloud session and
the Linux workspace on Austin's machine are both behind an egress allowlist
that does not include `onrender.com` — neither can reach the API at all, so a
cloud-scheduled backup would fail at the first step every week. The Windows
machine talks to both the API and `\\BMFILESERV`, so that is where it belongs.

Bonus: it no longer depends on Claude, the desktop app being open, or anyone
remembering. It just needs the PC on and logged in.

---

## Setup — once

### The short way

Set `BACKUP_TOKEN` in Render first (step 1 below), then, in an **Administrator**
PowerShell:

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\GitHub\GitHub\bm-field-app"
powershell -ExecutionPolicy Bypass -File tools\Setup-WeeklyBackup.ps1
```

It prompts for the token (hidden as you paste), locks the token file down so it
is not readable by every account on the machine, takes a real backup to prove
the whole chain works, and registers the Thursday task. **If the test backup
fails it refuses to register the task** — a task that fails every week is worse
than no task, because it looks like it is working.

Safe to re-run: it overwrites the token and replaces the task rather than
stacking up duplicates.

The rest of this section is the same thing by hand, and is worth reading once so
you know what the script did.

### 1. `BACKUP_TOKEN` on the API

Render → **bm-field-api** → Environment → add `BACKUP_TOKEN`, a long random
string. Generate one:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Must be **at least 32 characters**. Shorter or unset and the automation door
does not exist at all — the export routes stay admin-session-only. That is
deliberate: a backup that quietly opened the rate card to the internet would be
much worse than a backup that stops running and makes someone ask why.

**What the token can do:** read the backup zip, the rate cards, and the field
reports. Nothing else. It cannot create, edit, or complete a job — marking a job
complete still requires a real admin login.

### 2. The same token on the PC

**Not on the share, and not in the script** — the script is in a public GitHub
repo, and anyone who can read the backup folder must not thereby be handed a key
to the live database.

```powershell
mkdir "$env:LOCALAPPDATA\bm-field-backup"
notepad "$env:LOCALAPPDATA\bm-field-backup\token.txt"
```

Paste the same value, save, close.

### 3. Prove it works before scheduling it

```powershell
cd "$env:USERPROFILE\OneDrive\Documents\GitHub\GitHub\bm-field-app"
powershell -ExecutionPolicy Bypass -File tools\Invoke-WeeklyBackup.ps1
```

It prints each step and finishes with the path it wrote. Open that zip and look
inside before trusting it. If it fails, the message says why.

### 4. Register the scheduled task

In an **Administrator** PowerShell, one time:

```powershell
$repo = "$env:USERPROFILE\OneDrive\Documents\GitHub\GitHub\bm-field-app"
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\tools\Invoke-WeeklyBackup.ps1`""
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At 4pm
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'BM Field App weekly backup' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Backs up the B&M Field App'
```

**Do not add `-RunLevel Highest`.** The task needs no admin rights at run time,
and an elevated task sees a different view of the network and of mapped drives.

`-StartWhenAvailable` matters: if the PC is off at 4pm Thursday, the task runs
at the next opportunity instead of skipping the week silently.

Run it once by hand to confirm the schedule works:

```powershell
Start-ScheduledTask -TaskName 'BM Field App weekly backup'
```

---

## Checking on it

Every run writes a log:

```
%LOCALAPPDATA%\bm-field-backup\logs\backup-YYYY-MM-DD.log
```

Last run's result:

```powershell
Get-ScheduledTaskInfo -TaskName 'BM Field App weekly backup' |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
```

`LastTaskResult` maps to the script's exit codes:

| code | meaning |
|------|---------|
| 0 | complete — everything expected was captured |
| 2 | built, but something is missing. `MANIFEST.txt` names it. The archive is still usable |
| 1 | no backup was produced |

**Exit 2 is not "fine".** It means a real thing is missing — usually a rate card
for a job whose draft is broken. Read the manifest.

The quickest health check is the folder itself: if there is a zip with last
Thursday's date and a sane file size, it worked.

---

## Restoring

**Code.** The bundle is a real git repository in one file:

```
git clone code\bm-field-app.bundle bm-field-app
```

Full history, all branches — so a bad push can be walked back commit by commit,
not just flattened to one frozen moment.

**Data.** The CSVs are plain text and do not need this app, or Supabase, or
anything else to still exist in order to be readable. To rebuild:

1. Create the tables from `supabase/migrations/` in the cloned repo.
2. Import each CSV — **parents before children**, or the foreign keys reject it:

```
customers, closures
  → jobs
    → visits
      → locations
        → cables, shots, panel_ports, downtime, location_units
```

`profiles` and `rate_card` stand alone and can go in any time.

---

## Things worth knowing

**Rate cards are re-fetched for every completed job each week, not just the new
ones.** The card is generated from the saved draft at export time, so a
billing-engine fix changes what an old job's card looks like. Re-pulling keeps
the archive honest about what the app would produce *today*.

**Only completed jobs get a rate card.** The draft is written at Mark Complete;
asking for an open job's card is a guaranteed 404, so the script skips them.

**The date stamp is local, not UTC.** A Thursday 4pm run is stamped Thursday.

**Row counts in the manifest count records, not lines.** Narratives contain real
newlines inside quoted CSV fields, so counting lines would overstate every table
that has one. Both scripts parse the CSV properly to count.

**The zip is built in temp, then copied to the destination.** Compressing
straight onto a network path is slow and leaves a half-written file if the link
drops. The script re-checks the copied file's size before calling it a success.

**A backup is never thrown away because it could not be delivered.** If the
destination is unreachable, the finished zip is kept in
`%LOCALAPPDATA%\bm-field-backup\undelivered\` and the run exits 2 with a
warning naming the file. Losing a good backup over a copy problem is the wrong
way to fail. Check that folder if a week's zip is missing from OneDrive.

**Nothing is ever deleted.** Old backups accumulate. If the folder gets tight,
prune by hand — no script should be quietly deleting the only copy of anything.

**The zip uses Windows-style path separators inside.** That is how Windows
PowerShell's `Compress-Archive` writes them. Windows Explorer, 7-Zip and the
standard `unzip` command all handle it (unzip prints a warning and carries on),
so any realistic restore is fine. But a *scripted* restore using Python's
`zipfile` or Java would not convert them and would produce files with
backslashes in their names. If you ever automate a restore, extract with
`unzip` or 7-Zip rather than a language's built-in zip library.
