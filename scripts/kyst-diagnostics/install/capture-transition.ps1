# Offline-reviewable transition controller. Dot-sourcing performs no operation.
function Invoke-CaptureTransition {
    param([ValidateSet('Activate','Restore')][string]$Mode, [hashtable]$Ops)
    $initialError = if ($Mode -eq 'Restore') { 'Operator requested rollback (including failed capture)' } else { $null }
    $backupVerified = $false
    if ($Mode -eq 'Activate') {
        try {
            & $Ops.AssertQuiescent
            & $Ops.EnsureBackup
            $backupVerified = $true
            $identity = & $Ops.GetIdentity
            if ($null -eq $identity) { throw 'No interactive agent to activate' }
            # AtomicInstall revalidates identity immediately before replacement.
            & $Ops.AtomicInstall 'candidate' $identity
            & $Ops.CheckIdentity $identity
            & $Ops.AssertQuiescent
            & $Ops.StopVerified $identity
            & $Ops.WaitFresh $identity
            return @{ outcome='activated_pending_capture'; state=(& $Ops.Report) }
        } catch {
            $initialError = $_.Exception.Message
            if (-not $backupVerified) {
                try { $snapshot = & $Ops.Report } catch { $snapshot = @{reportError=$_.Exception.Message} }
                return @{outcome='aborted_before_replacement';initialError=$initialError;state=$snapshot}
            }
        }
    }
    try {
        # Always restore disk first. An absent/changed process must not leave the
        # candidate armed for a later supervisor respawn.
        & $Ops.VerifyBackup
        & $Ops.AtomicInstall 'baseline' $null
        & $Ops.AssertQuiescent
        $recoveryIdentity = & $Ops.GetIdentity
        if ($null -ne $recoveryIdentity) {
            & $Ops.StopVerified $recoveryIdentity
        }
        # With no agent, observe the existing supervisor only; no extra start.
        & $Ops.WaitFresh $recoveryIdentity
        return @{ outcome='baseline_restored'; initialError=$initialError; state=(& $Ops.Report) }
    } catch {
        $recoveryError = $_.Exception.Message
        try { $snapshot = & $Ops.Report } catch { $snapshot = @{ reportError=$_.Exception.Message } }
        return @{ outcome='recovery_incomplete'; initialError=$initialError; recoveryError=$recoveryError; state=$snapshot }
    }
}
