param([Parameter(Mandatory=$true)][string]$EvidenceRoot)
$ErrorActionPreference='Stop'
# Actual guard/controller, with only Windows observation/process effects replaced.
. (Join-Path $PSScriptRoot 'install/board-install-guard.ps1')
. (Join-Path $PSScriptRoot 'install/capture-transition.ps1')
$fixture=Join-Path $EvidenceRoot ('r3-fixture-'+[Guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory -Path $fixture
$null=New-PSDrive -Name C -PSProvider FileSystem -Root $fixture
$null=New-Item -ItemType Directory -Path 'C:\NoxAgent\media' -Force
$claim='C:\NoxAgent\nox11625-diagnostic-load.claimed'
$receipt='C:\NoxAgent\media\nox11625-diagnostic-load.refresh.json'
function Get-InstallBoardSnapshot { $script:stable }
function Assert($condition,$message){if(-not $condition){throw $message}}
function Seed($case){
 Set-Content $claim 'permanent consumed claim'
 if($case -eq 'missing'){return}
 $phase=if($case -eq 'success'){'complete'}elseif($case -eq 'incomplete'){'waiting_for_new_board'}else{$case}
 @{ok=($case -eq 'success');phase=$phase;completedAt=$(if($case -ne 'incomplete'){'2026-09-16T12:00:00Z'}else{$null})}|ConvertTo-Json|Set-Content $receipt
}
$results=@()
try{
 foreach($case in @('missing','incomplete','stop_may_start','waiting_for_terminal','start_may_occur','waiting_for_new_board','success')){
  foreach($route in @('Activate','Restore','AutomaticRecovery')){
   Remove-Item $claim,$receipt -ErrorAction SilentlyContinue
   # This represents a late Edge which now looks stable, including a fresh
   # resident heartbeat outside this guard. Receipt uncertainty must still win.
   $script:stable=@{pid=9001;created='late-edge-after-timeout';session=1;sid='fixture';commandHash='fixture';taskHash='fixture'}
   $script:InstallBoardBefore=$script:stable.Clone()
   $script:counts=@{stop=0;wait=0;candidate=0;baseline=0;guard=0}
   $script:seedCase=$case;$script:route=$route
   if($route -ne 'AutomaticRecovery'){Seed $case}
   $ops=@{
    AssertQuiescent={$script:counts.guard++;Assert-InstallBoardStable};
    EnsureBackup={};VerifyBackup={};GetIdentity={@{pid=123;created='fixture'}};
    AtomicInstall={param($kind,$identity) $script:counts[$kind]++;if($kind -eq 'candidate' -and $script:route -eq 'AutomaticRecovery'){Seed $script:seedCase}};
    CheckIdentity={param($identity) if($script:route -eq 'AutomaticRecovery'){throw 'Injected activation identity failure'}};
    StopVerified={param($identity) $script:counts.stop++};WaitFresh={param($identity) $script:counts.wait++};Report={@{fixture=$true}}
   }
   $mode=if($route -eq 'Restore'){'Restore'}else{'Activate'}
   $r=Invoke-CaptureTransition -Mode $mode -Ops $ops
   if($case -eq 'success'){
    Assert ($script:counts.stop -eq 1 -and $script:counts.wait -eq 1) "$route/$case lost permitted reload"
    $expected=if($route -eq 'Activate'){'activated_pending_capture'}else{'baseline_restored'}
    Assert ($r.outcome -eq $expected) "$route/$case unexpected outcome"
   }else{
    Assert ($script:counts.stop -eq 0 -and $script:counts.wait -eq 0) "$route/$case attempted resident process operation"
    $expected=if($route -eq 'Activate'){'aborted_before_replacement'}else{'recovery_incomplete'}
    Assert ($r.outcome -eq $expected) "$route/$case unexpected outcome"
    if($route -ne 'Activate'){Assert ($script:counts.baseline -eq 1) 'Recovery did not restore files first'}
   }
   Assert ((Get-Content $claim -Raw).Trim() -ceq 'permanent consumed claim') 'Consumed claim lost'
   $results+=@{case=$case;route=$route;passed=$true;outcome=$r.outcome;counts=$script:counts.Clone();error=$r.recoveryError;initialError=$r.initialError;stableLateEdge=$true;claimPreserved=$true}
  }
 }
 # Execute the actual RestoreFilesOnly branch in a child PowerShell process.
 # Its real exit stays intact; mocked effects are logged durably for assertion.
 $source=Get-Content (Join-Path $PSScriptRoot 'install/diagnostic-operator.ps1') -Raw
 $tokens=$null;$errors=$null
 $ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
 Assert ($errors.Count -eq 0) 'Installer parse failed'
 $branch=$ast.Find({param($a) $a -is [Management.Automation.Language.IfStatementAst] -and $a.Extent.Text.StartsWith("if(`$Mode -eq 'RestoreFilesOnly')")},$true)
 Assert ($null -ne $branch) 'File-only branch not found'
 $worker=Join-Path $fixture 'files-only.ps1';$log=Join-Path $fixture 'file-effects.txt'
 @'
param($Log)
$ErrorActionPreference='Stop'
$Mode='RestoreFilesOnly'
function Assert-CaptureBackup { Add-Content $Log 'verify-backup' }
function Set-CaptureFile($Kind,$Expected) { if($Kind -cne 'baseline'){throw 'Wrong file mode'};Add-Content $Log 'baseline-files' }
function Get-CaptureReport { Add-Content $Log 'read-only-report';@{} }
function Invoke-CaptureTransition { throw 'Forbidden process transition' }
function Stop-CaptureVerified { throw 'Forbidden resident stop' }
function Wait-CaptureFresh { throw 'Forbidden resident wait/reload' }
'@ + "`n" + $branch.Extent.Text |Set-Content $worker
 $null=& (Join-Path $PSHOME 'pwsh') -NoProfile -File $worker -Log $log
 Assert ($LASTEXITCODE -eq 0) 'File-only branch failed'
 Assert (((Get-Content $log) -join ',') -ceq 'verify-backup,baseline-files,read-only-report') 'File-only effects changed'
 $results+=@{case='RestoreFilesOnly actual branch';passed=$true;stop=0;reload=0}
 # Publisher must pin/import the same corrected guard that the installer uses.
 $publisher=Get-Content (Join-Path $PSScriptRoot 'queue-phase.ps1') -Raw
 $hash=(Get-FileHash (Join-Path $PSScriptRoot 'install/board-install-guard.ps1')).Hash.ToLowerInvariant()
 Assert ($publisher.Contains($hash) -and -not $publisher.Contains('nox-11625-observe-recovery') -and $publisher.Contains("`$stage='C:\NoxAgent\review\nox-11625-diagnostic-load'")) 'Publisher guard path/pin drift'
 $results+=@{case='publisher corrected guard pin/path';passed=$true;guardHash=$hash}
 @{passed=$results.Count;total=$results.Count;nativeOperations=0;checks=$results}|ConvertTo-Json -Depth 8|Set-Content (Join-Path $EvidenceRoot 'recovery-guard-results.json')
 Write-Output ('PASS '+$results.Count+'/'+$results.Count+'; native operations 0')
}finally{Remove-PSDrive C}
