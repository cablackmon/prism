# Receipt correlation only: legacy permission is one immutable historical receipt.
function Read-StartEvidence([string]$Path) {
 $bytes=[IO.File]::ReadAllBytes($Path);$sha=[Security.Cryptography.SHA256]::Create()
 try{$hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 $text=[Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xfeff)
 @{hash=$hash;value=($text|ConvertFrom-Json -ErrorAction Stop)}
}
function Get-PinnedPreclickRefusal([string]$RootPath,[string]$MediaPath) {
 $r=Read-StartEvidence (Join-Path $MediaPath 'nox11625-start-baseline-precision.start.json')
 $c=Read-StartEvidence (Join-Path $RootPath 'nox11625-start-baseline-precision.claimed')
 $d=Read-StartEvidence (Join-Path $RootPath 'nox-11625-dismiss-once.json')
 if($r.hash -cne 'b1c71debffc5735c688e8a7e1d29e311434752545757af9d6e29c861be8f352d' -or $c.hash -cne '2cf46e671dfc2bdb7b29a04d4cd49d7dd7f8736c654858edcea446109a76672c' -or $d.hash -cne 'fed3a8d68efeb7a6f9e192d0e8ebfdd561a6739f6df8cc441352d1ca51c54e0c'){throw 'Recovery evidence pin mismatch'}
 $v=$r.value
 if($v.invocationId -cne 'nox11625-start-baseline-precision' -or $v.phase -cne 'input_may_start' -or $v.ok -cne $false -or $v.error -cne 'Full-frame startup target mismatch; no click' -or -not $v.completedAt){throw 'Not the reviewed terminal Target refusal'}
 foreach($key in @('input','target','capture','contextError','receiptError','disposeError')){if($null -ne $v.$key){throw ('Unexpected refusal field '+$key)}}
 # This is an attestation about immutable known bytes, not a changed receipt
 # or a generic "input_may_start is safe" interpretation.
 $v
}
function Assert-ObserveTerminal($Receipt) {
 if($Receipt.invocationId -cne 'nox11625-observe-after-night-sky' -or $Receipt.agentPid -le 0 -or -not $Receipt.startedAt -or $Receipt.phase -cnotin @('preflight','input_returned','complete')){throw 'Observation terminal identity/phase unverified'}
 if($Receipt.phase -ceq 'preflight'){
  if($null -ne $Receipt.input -or -not $Receipt.error){throw 'Observation preflight outcome inconsistent'}
 }else{
  if($null -eq $Receipt.input -or $Receipt.input.ok -isnot [bool] -or $Receipt.input.unresolvedRelease -isnot [bool]){throw 'Observation native outcome unverified'}
  if($Receipt.input.inserted -notin @(0,1,2) -or ($Receipt.input.inserted -eq 1 -and ($Receipt.input.cleanupInserted -ne 1 -or -not $Receipt.input.releaseInserted))){throw 'Observation key release unverified'}
  if($Receipt.input.inserted -eq 2 -and (-not $Receipt.input.ok -or -not $Receipt.input.releaseInserted)){throw 'Full-pair outcome inconsistent'}
  if($Receipt.input.inserted -ne 2 -and $Receipt.input.ok){throw 'Partial input cannot be successful'}
  if($Receipt.input.inserted -eq 0 -and ($Receipt.input.releaseInserted -or $Receipt.input.cleanupInserted -ne 0)){throw 'Zero-input cleanup inconsistent'}
  if($Receipt.phase -ceq 'complete' -and (-not $Receipt.ok -or -not $Receipt.input.ok -or $Receipt.input.inserted -ne 2)){throw 'Observation success inconsistent'}
 }
 if(-not $Receipt.completedAt -or $Receipt.phase -eq 'input_may_start' -or $Receipt.input.unresolvedRelease -or $Receipt.contextError -or $Receipt.disposeError -or $Receipt.receiptError){throw 'Observation input/cleanup unresolved; no resident reload'}
}
