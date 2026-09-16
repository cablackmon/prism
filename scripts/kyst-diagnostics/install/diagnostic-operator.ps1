# REVIEW ONLY until MAIN NOX approves exact live file/process action.
# Run in the existing administrative SSH lane; never starts an agent in SSH.
param([ValidateSet('Activate','Restore','RestoreFilesOnly')][string]$Mode, [switch]$Execute)
$ErrorActionPreference = 'Stop'
if (-not $Execute -or -not $Mode) { throw 'Specify the reviewed Mode and -Execute only after live-action approval' }
. (Join-Path $PSScriptRoot 'capture-transition.ps1')
. (Join-Path $PSScriptRoot 'board-install-guard.ps1')
if($Mode -ne 'RestoreFilesOnly'){$script:InstallBoardBefore=Get-InstallBoardSnapshot}
$captureTarget = 'C:\NoxAgent\agent.ps1'
$captureStaged = 'C:\NoxAgent\review\nox-11625-diagnostic-load\agent.ps1'
$captureBackup = 'C:\NoxAgent\review\nox-11625-diagnostic-load\agent.before.ps1'
$captureBaselineHash = '47f1322b0a10260f49b7f1c81162ad662ee1cf087173364cf3379bc8f75ab10f'
$captureCandidateHash = 'f3b3ff51406eeece41f4abdaeff39af12be99b61999a246add0f3d6969fa8444'
$captureSupervisorHash = '812b563541031d1dc81c7fc6ead4e75372983d8fca14d34fa059d0c2d9af79cc'
function Get-CaptureHash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-CaptureSupervisor {
    if ((Get-CaptureHash 'C:\NoxAgent\supervisor.vbs') -ne $captureSupervisorHash) { throw 'Supervisor source drift' }
    $items = @(Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" | Where-Object { $_.CommandLine -like '*"C:\NoxAgent\supervisor.vbs"*' })
    if ($items.Count -ne 1 -or $items[0].SessionId -ne 1) { throw 'Unexpected supervisor/session' }
    $items[0]
}
function Get-CaptureIdentity {
    $parent = Get-CaptureSupervisor
    $items = @(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*-File "C:\NoxAgent\agent.ps1"*' })
    if ($items.Count -eq 0) { return $null }
    if ($items.Count -ne 1 -or $items[0].SessionId -ne 1 -or $items[0].ParentProcessId -ne $parent.ProcessId) { throw 'Unexpected agent identity' }
    @{ pid=$items[0].ProcessId; created=$items[0].CreationDate; command=$items[0].CommandLine; parent=$parent.ProcessId; parentCreated=$parent.CreationDate }
}
function Assert-CaptureIdentity($Expected) {
    $current = Get-CaptureIdentity
    if ($null -eq $current -or $null -eq $Expected) { throw 'Agent absent or identity missing' }
    foreach ($key in @('pid','created','command','parent','parentCreated')) {
        if ($current[$key] -ne $Expected[$key]) { throw "Agent/supervisor identity drift: $key" }
    }
}
function Assert-CaptureQuiescent {
    Assert-InstallBoardStable
    Assert-StartQuiescent;Assert-ObserveQuiescent
    if (@(Get-ChildItem 'C:\NoxAgent\queue' -Filter '*.json' -File).Count) { throw 'Queue not empty' }
    $state = Get-Content 'C:\NoxAgent\state.json' -Raw | ConvertFrom-Json
    # Absence is handled by recovery's bounded supervisor observation. If there
    # is a process, require a recent matching heartbeat before interrupting it.
    $identity = Get-CaptureIdentity
    if ($identity -and $state.lastResult -eq 'running') { throw 'Command active' }
    if ($identity -and (($state.agentPid -ne $identity.pid) -or ([DateTime]::UtcNow - [DateTime]::Parse($state.heartbeat).ToUniversalTime()).TotalSeconds -gt 10)) { throw 'Stale/mismatched agent state' }
    $busy = @(Get-CimInstance Win32_Process | Where-Object {
        ($_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*--user-data-dir=C:\NoxAgent\show-profile*') -or
        ($_.Name -eq 'powershell.exe' -and ($_.CommandLine -like '*C:\NoxAgent\play-audio.ps1*' -or $_.CommandLine -like '*C:\NoxAgent\overlay.ps1*'))
    })
    if ($busy.Count) { throw 'Overlay or audio active' }
}
function Assert-CaptureBackup {
    if ((Get-CaptureHash $captureBackup) -ne $captureBaselineHash) { throw 'Untrusted rollback backup' }
}
function Set-CaptureFile([string]$Kind, $Expected) {
    $pairs=@(
        @{target=$captureTarget;candidate=$captureStaged;backup=$captureBackup;old=$captureBaselineHash;new=$captureCandidateHash}
    )
    foreach($pair in $pairs){
        $source=if($Kind -eq 'candidate'){$pair.candidate}else{$pair.backup}
        $hash=if($Kind -eq 'candidate'){$pair.new}else{$pair.old}
        if((Get-CaptureHash $source) -ne $hash){throw 'Pair source pin mismatch'}
        $current=Get-CaptureHash $pair.target
        if($current -notin @($pair.old,$pair.new)){throw 'Unknown target bytes; preserve/report'}
        $temporary=Join-Path (Split-Path $pair.target) ('nox11625-'+[Guid]::NewGuid().ToString('N')+'.tmp')
        try{
            [IO.File]::Copy($source,$temporary,$false)
            if((Get-CaptureHash $temporary) -ne $hash){throw 'Staged pair hash mismatch'}
            if($Kind -eq 'candidate'){
                if($pair.target.EndsWith('.ps1')){
                    $tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($temporary,[ref]$tokens,[ref]$errors)
                    if($errors.Count){throw 'Candidate parse failure'}
                }
                Assert-CaptureQuiescent;Assert-CaptureIdentity $Expected
                if((Get-CaptureHash $pair.target) -ne $pair.old){throw 'Target drift before pair replacement'}
            }else{
                if((Get-CaptureHash $pair.target) -ne $current){throw 'Target drift before rollback'}
            }
            [IO.File]::Replace($temporary,$pair.target,[NullString]::Value)
            if((Get-CaptureHash $pair.target) -ne $hash){throw 'Pair post-replacement pin mismatch'}
        }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
    }
}
function Stop-CaptureVerified($Expected) {
    Assert-CaptureQuiescent
    Assert-CaptureIdentity $Expected
    # Bind a process handle and recheck creation before killing. This avoids a
    # stale PID being reused between the CIM lookup and Stop-Process.
    $process = Get-Process -Id $Expected.pid
    try {
        $handle = $process.Handle
        if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $Expected.created.ToUniversalTime()).Ticks) -gt 10) { throw 'Process creation changed before stop' }
        Assert-CaptureIdentity $Expected
        $process.Kill()
    } finally { $process.Dispose() }
}
function Wait-CaptureFresh($Previous) {
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $current = Get-CaptureIdentity
        $state = Get-Content 'C:\NoxAgent\state.json' -Raw | ConvertFrom-Json
        if ($current -and ($null -eq $Previous -or $current.pid -ne $Previous.pid -or $current.created -ne $Previous.created) -and $state.agentPid -eq $current.pid -and $state.sessionId -eq 1 -and $state.user -match '\\kiosk$' -and ([DateTime]::UtcNow - [DateTime]::Parse($state.heartbeat).ToUniversalTime()).TotalSeconds -le 10 -and -not $state.lastError) { return }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw 'No verified interactive respawn within 15 seconds; no task/service repair attempted'
}
function Get-CaptureReport {
    $report = @{}
    try{$report.launchHash=Get-CaptureHash 'C:\ProgramData\KYST\kiosk-launch.cmd'}catch{$report.launchHashError=$_.Exception.Message}
    foreach($pair in @(@('diskHash',$captureTarget),@('backupHash',$captureBackup))) {
        try { $report[$pair[0]]=Get-CaptureHash $pair[1] } catch { $report[$pair[0]]=$_.Exception.Message }
    }
    try { $report.identity=Get-CaptureIdentity } catch { $report.identityError=$_.Exception.Message }
    try { $state=Get-Content 'C:\NoxAgent\state.json' -Raw|ConvertFrom-Json; $report.receiptState=$state|Select-Object agentPid,sessionId,heartbeat,lastCommandId,lastResult,lastError,commandReceipts } catch { $report.receiptError=$_.Exception.Message }
    $report.loadedSource='Not directly observable; disk hash plus new matching process/heartbeat are reload evidence only'
    $report
}
$ops = @{
    AssertQuiescent={Assert-CaptureQuiescent};
    EnsureBackup={
        if ((Get-CaptureHash $captureTarget) -ne $captureBaselineHash) { throw 'Initial source drift' }
        if (-not (Test-Path -LiteralPath $captureBackup)) { [IO.File]::Copy($captureTarget,$captureBackup,$false) }
        Assert-CaptureBackup
    };
    VerifyBackup={Assert-CaptureBackup}; GetIdentity={Get-CaptureIdentity};
    CheckIdentity={param($expected) Assert-CaptureIdentity $expected};
    AtomicInstall={param($kind,$expected) Set-CaptureFile $kind $expected};
    StopVerified={param($expected) Stop-CaptureVerified $expected};
    WaitFresh={param($previous) Wait-CaptureFresh $previous}; Report={Get-CaptureReport}
}
if($Mode -eq 'RestoreFilesOnly'){
    Assert-CaptureBackup
    Set-CaptureFile 'baseline' $null
    @{outcome='files_restored_no_process_action';state=(Get-CaptureReport)}|ConvertTo-Json -Depth 8
    exit 0
}
$result=Invoke-CaptureTransition -Mode $Mode -Ops $ops
$result | ConvertTo-Json -Depth 8
if ($result.outcome -eq 'recovery_incomplete' -or ($Mode -eq 'Activate' -and $result.outcome -ne 'activated_pending_capture')) { exit 1 }
