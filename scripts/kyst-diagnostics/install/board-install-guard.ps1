. (Join-Path $PSScriptRoot 'recovery-evidence.ps1')
# Read-only guard used by the pair installer; no source/process mutation on import.
function Get-InstallBoardSnapshot {
    $task=Get-ScheduledTask -TaskPath '\' -TaskName 'KYST-FamilyBoard-Kiosk' -ErrorAction Stop
    if([string]$task.State -ne 'Ready'){throw 'Board task not Ready; installer will not restart anything'}
    $xml=Export-ScheduledTask -TaskPath '\' -TaskName 'KYST-FamilyBoard-Kiosk' -ErrorAction Stop
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$hash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($xml)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    if($hash -ne 'cf99ef0dd000d4b427457bb0ce054e87effc1649c785931eecc11c15b0e0013f'){throw 'Task definition changed'}
    $roots=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"|Where-Object {$_.CommandLine -and $_.CommandLine -notmatch '--type='})
    if($roots.Count -ne 1){throw 'Board process unresolved for install/reload'}
    $r=$roots[0];$owner=Invoke-CimMethod -InputObject $r -MethodName GetOwnerSid -ErrorAction Stop
    if($r.SessionId -ne 1 -or $owner.ReturnValue -ne 0 -or $owner.Sid -ne 'S-1-5-21-2264777834-3716324509-3656978160-1002' -or $r.CommandLine -notmatch '--kiosk "https://kyst-board\.fly\.dev/api/household-auth/device\?'){throw 'Not verified board identity'}
    $sha=[Security.Cryptography.SHA256]::Create()
    try{$commandHash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($r.CommandLine)))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
    @{pid=$r.ProcessId;created=$r.CreationDate;session=$r.SessionId;sid=$owner.Sid;commandHash=$commandHash;taskHash=$hash}
}
function Assert-InstallBoardStable {
    $now=Get-InstallBoardSnapshot
    foreach($key in @('pid','created','session','sid','commandHash','taskHash')){if($now[$key] -ne $script:InstallBoardBefore[$key]){throw ('Board state changed; no resident reload: '+$key)}}
    # Any unresolved refresh receipt blocks installation/reload. Never turn an
    # absent final receipt into permission to restart a possibly active handler.
    foreach($name in @('nox11625-refresh-baseline','nox11625-refresh-classic','nox11625-refresh-nox-return','nox11625-diagnostic-load')){
        if(Test-Path (Join-Path 'C:\NoxAgent' ($name+'.claimed'))){
            $receipt=Get-Content (Join-Path 'C:\NoxAgent\media' ($name+'.refresh.json')) -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json
            if(-not $receipt.completedAt -or (-not $receipt.ok -and $receipt.phase -in @('stop_may_start','waiting_for_terminal','start_may_occur','waiting_for_new_board'))){throw 'Refresh process state unresolved; file restore only, no reload'}
        }
    }
}

function Assert-StartQuiescent {
 if((Get-FileHash 'C:\ProgramData\KYST\kiosk-launch.cmd' -Algorithm SHA256).Hash.ToLowerInvariant() -ne '63fc114fbb37de69887a4ed6f032d4b4143fc6ad0c78409e2aa799998ae489b1'){throw 'Pinned bounded launcher drift'}
 foreach($id in @('nox11625-start-baseline','nox11625-start-baseline-precision','nox11625-start-classic','nox11625-start-nox-return')){
  if(Test-Path (Join-Path 'C:\NoxAgent' ($id+'.claimed'))){
   $r=Get-Content (Join-Path 'C:\NoxAgent\media' ($id+'.start.json')) -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json
   if($id -ceq 'nox11625-start-baseline-precision' -and $r.phase -ceq 'input_may_start'){$null=Get-PinnedPreclickRefusal 'C:\NoxAgent' 'C:\NoxAgent\media'}elseif(-not $r.completedAt -or $r.phase -eq 'input_may_start' -or $r.input.unresolvedRelease -or $r.contextError){throw 'Startup input or cleanup unresolved; no resident reload'}
  }
 }
}

function Assert-ObserveQuiescent {
 if(Test-Path 'C:\NoxAgent\nox11625-observe-after-night-sky.claimed'){
  $r=Get-Content 'C:\NoxAgent\media\nox11625-observe-after-night-sky.observe.json' -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json
  $c=Get-Content 'C:\NoxAgent\nox11625-observe-after-night-sky.claimed' -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json
  if($c.id -cne $r.invocationId -or $c.agentPid -ne $r.agentPid -or $c.at -ne $r.startedAt){throw 'Observation claim/receipt mismatch'}
  Assert-ObserveTerminal $r
 }
}
