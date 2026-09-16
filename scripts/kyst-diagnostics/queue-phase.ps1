# Internal fixed native publisher. Use operator.py; it consumes server publication before this code.
# REVIEW ONLY. No invocation until MAIN NOX names this exact packet and window.
param(
 [Parameter(Mandatory=$true)][ValidateSet('diagnostic-load','identity-capture','classic-refresh','classic-start','classic-capture','nox-return-refresh','nox-return-start','nox-return-capture','scrolled-capture','restored-capture')][string]$Phase,
 [Parameter(Mandatory=$true)][string]$ApprovedUntilUtc,
 [switch]$Execute, [switch]$PreflightOnly, [string]$PublicationDeadlineUtc
)
$ErrorActionPreference='Stop'
if(-not $Execute -and -not $PreflightOnly){throw 'Execution not released by preparation; -Execute and recorded MAIN NOX release required'}
$until=[DateTimeOffset]::ParseExact($ApprovedUntilUtc,'yyyy-MM-ddTHH:mm:ssZ',[Globalization.CultureInfo]::InvariantCulture)
if($until.UtcDateTime -le [DateTime]::UtcNow -or $until.UtcDateTime -gt [DateTime]::UtcNow.AddMinutes(45)){throw 'Expired/invalid session window'}
$stage='C:\NoxAgent\review\nox-11625-observe-recovery'
$pins=@{
 'C:\NoxAgent\agent.ps1'='f3b3ff51406eeece41f4abdaeff39af12be99b61999a246add0f3d6969fa8444';
 'C:\NoxAgent\supervisor.vbs'='812b563541031d1dc81c7fc6ead4e75372983d8fca14d34fa059d0c2d9af79cc';
 'C:\NoxAgent\nox11625-observe-after-night-sky.claimed'='749938623b1b42852d814dd3dc92e4cdbc8ef531330ec7b02aa864932a43e45b';
 'C:\NoxAgent\review\nox-11625-observe-recovery\board-install-guard.ps1'='8cd85643ad160f4e98df9247e982c6b088129f4d763ba4314af6ca5d55b6e6ee';
 'C:\NoxAgent\review\nox-11625-observe-recovery\recovery-evidence.ps1'='b52c2e97048c1a3be8153fe326485f303ed50cac51ae6c10e09ac2b079f407f2'
}
foreach($path in $pins.Keys){if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $pins[$path]){throw ('Pinned state drift: '+$path)}}
. (Join-Path $stage 'board-install-guard.ps1')
$script:InstallBoardBefore=Get-InstallBoardSnapshot
Assert-InstallBoardStable;Assert-StartQuiescent;Assert-ObserveQuiescent
if(@(Get-ChildItem C:\NoxAgent\queue -File -Force).Count){throw 'Queue nonempty'}
$s=Get-Content C:\NoxAgent\state.json -Raw -Encoding UTF8|ConvertFrom-Json
$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$s.agentPid) -ErrorAction Stop
$o=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction Stop
$parent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ParentProcessId) -ErrorAction Stop
$po=Invoke-CimMethod -InputObject $parent -MethodName GetOwnerSid -ErrorAction Stop
if($p.SessionId -ne 1 -or $parent.SessionId -ne 1 -or $o.ReturnValue -ne 0 -or $po.ReturnValue -ne 0 -or $o.Sid -cne 'S-1-5-21-2264777834-3716324509-3656978160-1002' -or $po.Sid -cne $o.Sid -or $p.CommandLine -notlike '*-File "C:\NoxAgent\agent.ps1"*' -or $parent.CommandLine -notlike '*"C:\NoxAgent\supervisor.vbs"*'){throw 'Resident/supervisor identity mismatch'}
if($s.lastResult -eq 'running' -or $s.lastError -or ([DateTime]::UtcNow-[DateTime]::Parse($s.heartbeat).ToUniversalTime()).TotalSeconds -gt 10){throw 'Nonterminal/error/stale state; no new command'}
$mapping=@{
 'diagnostic-load'=@('nox11625-diagnostic-load','refresh_board');
 'identity-capture'=@('nox11625-diagnostic-identity-frame','screenshot');
 'classic-refresh'=@('nox11625-refresh-classic','refresh_board');
 'classic-start'=@('nox11625-start-classic','start_board');
 'classic-capture'=@('nox11625-final-classic-frame','screenshot');
 'nox-return-refresh'=@('nox11625-refresh-nox-return','refresh_board');
 'nox-return-start'=@('nox11625-start-nox-return','start_board');
 'nox-return-capture'=@('nox11625-final-nox-frame','screenshot');
 'scrolled-capture'=@('nox11625-final-scroll-frame','screenshot');
 'restored-capture'=@('nox11625-final-restored-frame','screenshot')
}
$id=$mapping[$Phase][0];$command=$mapping[$Phase][1]
if(Test-Path ('C:\NoxAgent\'+$id+'.claimed')){throw 'Operation consumed; no replay'}
if(@($s.commandReceipts|Where-Object {$_.commandId -ceq $id}).Count -or (Test-Path ('C:\NoxAgent\done\'+$id+'.json')) -or (Test-Path ('C:\NoxAgent\media\'+$id+'.png'))){throw 'Existing operation evidence; no overwrite/retry'}
if($command -ceq 'start_board'){
 $refreshId=$id.Replace('start-','refresh-');$r=Get-Content ('C:\NoxAgent\media\'+$refreshId+'.refresh.json') -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json
 if($r.ok -cne $true -or $r.phase -cne 'complete' -or -not $r.completedAt){throw 'Matching refresh not complete'}
}
if($PreflightOnly){@{ready=$true;residentPid=$p.ProcessId;board=$script:InstallBoardBefore}|ConvertTo-Json -Depth 6;exit 0}
if([DateTime]::UtcNow -ge $until.UtcDateTime){throw 'Window expired before queue publication'}
$publicationDeadline=$until.UtcDateTime
if($command -ceq 'screenshot' -or $Phase -ceq 'diagnostic-load'){
 if(-not $PublicationDeadlineUtc){throw 'Server publication deadline required'}
 $publicationDeadline=[DateTimeOffset]::ParseExact($PublicationDeadlineUtc,'yyyy-MM-ddTHH:mm:ssZ',[Globalization.CultureInfo]::InvariantCulture).UtcDateTime
 if($publicationDeadline -gt $until.UtcDateTime -or $publicationDeadline -le [DateTime]::UtcNow){throw 'Publication expired or outside release'}
}
$payload=@{cmd=$command};if($command -ceq 'screenshot'){$payload.file=$id+'.png'}
$tmp='C:\NoxAgent\queue\'+$id+'.tmp';$final='C:\NoxAgent\queue\'+$id+'.json'
$f=[IO.File]::Open($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{$b=[Text.Encoding]::UTF8.GetBytes(($payload|ConvertTo-Json -Compress));$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()}
if([DateTime]::UtcNow -ge $publicationDeadline){throw 'Expired before atomic publication; preserve tmp evidence, no retry'}
[IO.File]::Move($tmp,$final)
@{id=$id;command=$command;queuedAt=[DateTime]::UtcNow.ToString('o');retryAllowed=$false;residentPid=$p.ProcessId;board=$script:InstallBoardBefore}|ConvertTo-Json -Depth 6
