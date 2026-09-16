$ErrorActionPreference = 'Stop'

$Root = 'C:\NoxAgent'
$QueueDir = Join-Path $Root 'queue'
$DoneDir = Join-Path $Root 'done'
$MediaDir = Join-Path $Root 'media'
$StatePath = Join-Path $Root 'state.json'
$LogPath = Join-Path $Root 'agent.log'
$ShowProfile = Join-Path $Root 'show-profile'
$EdgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$PowerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$PollSeconds = 2

$script:LastCommand = $null
$script:LastCommandId = $null
$script:LastResult = 'starting'
$script:LastError = $null
$script:ShowPid = $null
$script:ShowDeadline = $null
$script:LastAudioPid = $null
$script:CommandReceipts = @()

function Restore-CommandReceipts {
    if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { return }
    try {
        $priorState = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
        $script:CommandReceipts = @(
            $priorState.commandReceipts |
                Where-Object { $_ -and $_.commandId -and $_.result } |
                Select-Object -First 100
        )
    } catch {
        Write-AgentLog "Could not restore command receipts from state: $($_.Exception.Message)" 'WARN'
        $script:CommandReceipts = @()
    }
}

function Write-AgentLog {
    param([string]$Message, [string]$Level = 'INFO')
    $mutex = New-Object System.Threading.Mutex($false, 'Local\NOX-KioskAgent-Log')
    $locked = $false
    try {
        $locked = $mutex.WaitOne(3000)
        if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -ge 1MB) {
            $rotated = "$LogPath.1"
            Remove-Item $rotated -Force -ErrorAction SilentlyContinue
            Move-Item $LogPath $rotated -Force
        }
        $line = '{0} [{1}] {2}' -f (Get-Date).ToUniversalTime().ToString('o'), $Level, $Message
        Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

function Write-AgentState {
    $queueDepth = @(Get-ChildItem -LiteralPath $QueueDir -Filter '*.json' -File -ErrorAction SilentlyContinue).Count
    $state = [ordered]@{
        heartbeat = (Get-Date).ToUniversalTime().ToString('o')
        agentPid = $PID
        sessionId = (Get-Process -Id $PID).SessionId
        user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        queueDepth = $queueDepth
        lastCommand = $script:LastCommand
        lastCommandId = $script:LastCommandId
        lastResult = $script:LastResult
        lastError = $script:LastError
        showPid = $script:ShowPid
        showDeadline = if ($script:ShowDeadline) { $script:ShowDeadline.ToUniversalTime().ToString('o') } else { $null }
        lastAudioPid = $script:LastAudioPid
        commandReceipts = @($script:CommandReceipts)
    }
    $temporary = "$StatePath.tmp"
    $state | ConvertTo-Json -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $StatePath -Force
}

function Get-ShowProcesses {
    $needle = '--user-data-dir=C:\NoxAgent\show-profile'
    @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) })
}

function Close-ShowWindow {
    param([string]$Reason = 'command')
    $processes = @(Get-ShowProcesses)
    foreach ($process in ($processes | Sort-Object { $_.CommandLine -match '--type=' } -Descending)) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($processes.Count -gt 0) {
        Write-AgentLog "Closed temporary show window ($Reason); stopped $($processes.Count) Edge process(es)"
    } else {
        Write-AgentLog "Close-show requested ($Reason); no temporary Edge process was present"
    }
    $script:ShowPid = $null
    $script:ShowDeadline = $null
}

function Start-ShowWindow {
    param([string]$Url, [int]$Seconds)
    if ([string]::IsNullOrWhiteSpace($Url)) { throw 'show requires a non-empty url' }
    if ($Seconds -lt 1 -or $Seconds -gt 86400) { throw 'show seconds must be between 1 and 86400' }
    Close-ShowWindow -Reason 'replaced'

    $arguments = @(
        '--kiosk', ('"{0}"' -f $Url),
        '--edge-kiosk-type=fullscreen',
        '--no-first-run',
        '--no-default-browser-check',
        '--user-data-dir=C:\NoxAgent\show-profile'
    )
    $started = Start-Process -FilePath $EdgePath -ArgumentList $arguments -PassThru
    Start-Sleep -Milliseconds 1200
    $root = Get-ShowProcesses | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
    $script:ShowPid = if ($root) { [int]$root.ProcessId } else { [int]$started.Id }
    $script:ShowDeadline = (Get-Date).AddSeconds($Seconds)
    Write-AgentLog "Opened temporary show window PID=$($script:ShowPid) duration=${Seconds}s"
}

function Start-AudioPlayback {
    param([string]$FileName)
    if ([string]::IsNullOrWhiteSpace($FileName)) { throw 'mp3 filename is required' }
    if ([IO.Path]::GetFileName($FileName) -ne $FileName) { throw 'mp3 must be a filename, not a path' }
    $mediaPath = Join-Path $MediaDir $FileName
    if (-not (Test-Path -LiteralPath $mediaPath -PathType Leaf)) { throw "media file not found: $FileName" }
    $arguments = @(
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-STA',
        '-File', '"C:\NoxAgent\play-audio.ps1"', '-Path', ('"{0}"' -f $mediaPath)
    )
    $audio = Start-Process -FilePath $PowerShellPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $script:LastAudioPid = [int]$audio.Id
    Write-AgentLog "Audio playback launched PID=$($audio.Id) file=$FileName"
}

function Show-Announcement {
    param([string]$Text, [int]$Seconds)
    if ([string]::IsNullOrWhiteSpace($Text)) { throw 'announce requires non-empty text' }
    if ($Seconds -lt 1 -or $Seconds -gt 3600) { throw 'announce seconds must be between 1 and 3600' }
    $overlayId = [Guid]::NewGuid().ToString('N')
    $payloadPath = Join-Path $Root "overlay-$overlayId.json"
    [ordered]@{ text = $Text; seconds = $Seconds } | ConvertTo-Json -Compress |
        Set-Content -LiteralPath $payloadPath -Encoding UTF8
    $arguments = @(
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-STA',
        '-File', '"C:\NoxAgent\overlay.ps1"', '-PayloadPath', ('"{0}"' -f $payloadPath)
    )
    $overlay = Start-Process -FilePath $PowerShellPath -ArgumentList $arguments -WindowStyle Hidden -PassThru
    Write-AgentLog "Announcement overlay launched PID=$($overlay.Id) duration=${Seconds}s"
}

# Offline-testable sequence; no native operations until supplied by the resident adapter.
function Invoke-BoardRefreshSequence {
    param([hashtable]$Ops)
    $r=@{ok=$false;phase='preflight';startAttempted=$false;stopTerminal=$false;retryAllowed=$false}
    $bound=$null
    try {
        & $Ops.Validate
        $before=& $Ops.Identity
        $r.before=$before
        $bound=& $Ops.Bind $before
        & $Ops.Revalidate $before $bound
        $r.phase='stop_may_start'; & $Ops.Record $r
        & $Ops.Revalidate $before $bound
        & $Ops.Stop $bound
        $r.phase='waiting_for_terminal'
        if(-not (& $Ops.WaitTerminal $bound 15000)){throw 'Board stop not proved terminal; no start'}
        $r.stopTerminal=$true
        & $Ops.Validate
        & $Ops.AssertEmpty
        $r.phase='start_may_occur'; & $Ops.Record $r
        & $Ops.Validate
        & $Ops.AssertEmpty
        $r.startAttempted=$true
        & $Ops.Start
        $r.phase='waiting_for_new_board'
        $r.after=& $Ops.WaitNew $before 20000
        $r.ok=$true;$r.phase='complete'
    } catch { $r.error=$_.Exception.Message }
    finally {
        if($bound){try{& $Ops.Dispose $bound}catch{$r.disposeError=$_.Exception.Message;$r.ok=$false}}
        $r.completedAt=[DateTime]::UtcNow.ToString('o')
        try{& $Ops.Record $r}catch{$r.receiptError=$_.Exception.Message;$r.ok=$false}
    }
    $r
}
function Get-RefreshHash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() }
function Get-RefreshTextHash([string]$Text) {
    $h=[Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-','').ToLowerInvariant() } finally {$h.Dispose()}
}
function Assert-RefreshTask {
    if((Get-RefreshHash 'C:\ProgramData\KYST\kiosk-launch.cmd') -ne '63fc114fbb37de69887a4ed6f032d4b4143fc6ad0c78409e2aa799998ae489b1'){throw 'Launch source drift'}
    $task=Get-ScheduledTask -TaskPath '\' -TaskName 'KYST-FamilyBoard-Kiosk' -ErrorAction Stop
    if($task.TaskPath -ne '\' -or $task.TaskName -ne 'KYST-FamilyBoard-Kiosk' -or [string]$task.State -ne 'Ready'){throw 'Exact task not Ready; no stop/start'}
    $xml=Export-ScheduledTask -TaskPath '\' -TaskName 'KYST-FamilyBoard-Kiosk' -ErrorAction Stop
    if((Get-RefreshTextHash $xml) -ne 'cf99ef0dd000d4b427457bb0ce054e87effc1649c785931eecc11c15b0e0013f'){throw 'Task definition drift'}
    $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
    if((Get-Process -Id $PID).SessionId -ne 1 -or $identity.User.Value -ne 'S-1-5-21-2264777834-3716324509-3656978160-1002'){throw 'Resident user/session mismatch'}
    $profile=Get-CimInstance Win32_UserProfile -Filter "SID='S-1-5-21-2264777834-3716324509-3656978160-1002'" -ErrorAction Stop
    if($profile.LocalPath -ne 'C:\Users\kiosk'){throw 'Kiosk profile path drift'}
    $local=Get-Content 'C:\Users\kiosk\AppData\Local\Microsoft\Edge\User Data\Local State' -Raw -Encoding UTF8 -ErrorAction Stop|ConvertFrom-Json
    if($local.profile.last_used -ne 'Default' -or @($local.profile.last_active_profiles).Count -ne 1 -or $local.profile.last_active_profiles[0] -ne 'Default'){throw 'Implicit Default profile not established'}
}
function Get-RefreshBoardIdentity {
    $all=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction Stop)
    $roots=@($all|Where-Object {$_.CommandLine -and $_.CommandLine -notmatch '--type='})
    if($roots.Count -ne 1){throw 'Ambiguous/missing Edge root; no stop'}
    $r=$roots[0]
    # Exact approved launch flags/URL, including unchanged secret query, are read
    # locally. Never include the full command or URL in a receipt or exception.
    $line=@(Get-Content 'C:\ProgramData\KYST\kiosk-launch.cmd' -Encoding UTF8|Where-Object {$_ -like 'start "" *'})
    if($line.Count -ne 1 -or $line[0] -notmatch '^start "" "([^"]+)" --kiosk "([^"]+)" --edge-kiosk-type=fullscreen --no-first-run$'){throw 'Launch grammar mismatch'}
    $exe=$Matches[1];$url=$Matches[2]
    if($url -notmatch '^https://kyst-board\.fly\.dev/api/household-auth/device\?'){throw 'Not auth-wall device URL'}
    $pattern='^"'+[regex]::Escape($exe)+'"\s+--kiosk\s+"'+[regex]::Escape($url)+'"\s+--edge-kiosk-type=fullscreen\s+--no-first-run\s*$'
    if($r.ExecutablePath -ne $exe -or $r.SessionId -ne 1 -or $r.CommandLine -notmatch $pattern){throw 'Root is not exact board launch/profile'}
    $owner=Invoke-CimMethod -InputObject $r -MethodName GetOwnerSid -ErrorAction Stop
    if($owner.ReturnValue -ne 0 -or $owner.Sid -ne 'S-1-5-21-2264777834-3716324509-3656978160-1002'){throw 'Board owner mismatch'}
    # Every other Edge process must be an attributable descendant in this session.
    # Unrelated Edge blocks refresh; it is never a stop target.
    $known=@{};$known[[string]$r.ProcessId]=$r.CreationDate
    $pending=@($all|Where-Object {$_.ProcessId -ne $r.ProcessId})
    while($pending.Count){
        $next=@();$progress=$false
        foreach($child in $pending){
            if($known.ContainsKey([string]$child.ParentProcessId) -and $child.CreationDate -ge $known[[string]$child.ParentProcessId] -and $child.SessionId -eq 1 -and $child.ExecutablePath -eq $exe){
                $co=Invoke-CimMethod -InputObject $child -MethodName GetOwnerSid -ErrorAction Stop
                if($co.ReturnValue -ne 0 -or $co.Sid -ne $owner.Sid){throw 'Unrelated Edge owner; no stop'}
                $known[[string]$child.ProcessId]=$child.CreationDate;$progress=$true
            }else{$next+=$child}
        }
        if(-not $progress){throw 'Unrelated/unresolved Edge process; no stop'}
        $pending=$next
    }
    @{pid=[int]$r.ProcessId;created=$r.CreationDate;creationRepresentation='utc-ticks-v1';createdUtcTicks=$r.CreationDate.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);session=[int]$r.SessionId;sid=$owner.Sid;executable=$exe;commandHash=(Get-RefreshTextHash $r.CommandLine);profile='C:\Users\kiosk\AppData\Local\Microsoft\Edge\User Data\Default';profileEvidence='implicit launch flags plus Local State last_used/last_active Default';descendantCount=$known.Count-1}
}
function Assert-RefreshIdentity($Expected,$Bound) {
    Assert-RefreshTask
    $current=Get-RefreshBoardIdentity
    foreach($key in @('pid','created','session','sid','executable','commandHash','profile')){if($current[$key] -ne $Expected[$key]){throw ('Board identity drift: '+$key)}}
    if($Bound.HasExited -or [Math]::Abs(($Bound.StartTime.ToUniversalTime()-$Expected.created.ToUniversalTime()).Ticks) -gt 10){throw 'Bound process creation/exit drift'}
}
function Assert-NoRefreshEdge {
    if(@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction Stop).Count){throw 'Edge still present/unrelated Edge appeared; no start'}
}
function Write-RefreshReceipt([string]$Path,$Value) {
    $temp=$Path+'.tmp';$bytes=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 7))
    $f=[IO.File]::Open($temp,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$f.Write($bytes,0,$bytes.Length);$f.Flush($true)}finally{$f.Dispose()}
    Move-Item -LiteralPath $temp -Destination $Path -Force
}
function Restart-FamilyBoard {
    $invocation=$script:LastCommandId
    if($invocation -notin @('nox11625-refresh-baseline','nox11625-refresh-classic','nox11625-refresh-nox-return','nox11625-diagnostic-load')){throw 'Refresh requires one of the four reviewed invocation IDs'}
    $claimPath=Join-Path $Root ($invocation+'.claimed')
    $claim=[IO.File]::Open($claimPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$bytes=[Text.Encoding]::UTF8.GetBytes([DateTime]::UtcNow.ToString('o'));$claim.Write($bytes,0,$bytes.Length);$claim.Flush($true)}finally{$claim.Dispose()}
    $receipt=Join-Path $MediaDir ($invocation+'.refresh.json')
    $started=[DateTime]::UtcNow.ToString('o')
    $ops=@{
        Validate={Assert-RefreshTask};Identity={Get-RefreshBoardIdentity};
        Bind={param($expected)$proc=Get-Process -Id $expected.pid -ErrorAction Stop;try{$null=$proc.Handle;if([Math]::Abs(($proc.StartTime.ToUniversalTime()-$expected.created.ToUniversalTime()).Ticks) -gt 10){throw 'PID reused before binding'};return $proc}catch{$proc.Dispose();throw}};
        Revalidate={param($expected,$bound)Assert-RefreshIdentity $expected $bound};
        Stop={param($bound)$bound.Kill()};
        WaitTerminal={param($bound,$ms)
            $deadline=[DateTime]::UtcNow.AddMilliseconds($ms)
            do {
                $remaining=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction Stop).Count
                if([DateTime]::UtcNow -ge $deadline){return $false}
                if($bound.HasExited -and $remaining -eq 0){return $true}
                Start-Sleep -Milliseconds 200
            }while([DateTime]::UtcNow -lt $deadline)
            return $false
        };
        AssertEmpty={Assert-NoRefreshEdge};
        Start={Start-ScheduledTask -TaskPath '\' -TaskName 'KYST-FamilyBoard-Kiosk' -ErrorAction Stop};
        WaitNew={param($previous,$ms)
            $deadline=[DateTime]::UtcNow.AddMilliseconds($ms)
            do {
                $all=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction Stop)
                if($all.Count){
                    $next=Get-RefreshBoardIdentity
                    if([DateTime]::UtcNow -ge $deadline){throw 'New identity lookup exceeded deadline; no retry'}
                    if($next.pid -eq $previous.pid -and $next.created -eq $previous.created){throw 'Old board identity survived start'}
                    return $next
                }
                Start-Sleep -Milliseconds 200
            }while([DateTime]::UtcNow -lt $deadline)
            throw 'No verified new board within20seconds; no retry'
        };
        Dispose={param($bound)$bound.Dispose()};
        Record={param($state)$state.invocationId=$invocation;$state.agentPid=$PID;$state.startedAt=$started;Write-RefreshReceipt $receipt $state}
    }
    $result=Invoke-BoardRefreshSequence $ops
    if(-not $result.ok){throw ('Bounded refresh failed; inspect receipt: '+$result.error)}
    Write-AgentLog "Bounded board refresh completed id=$invocation; visual acceptance requires screenshot"
}

function Save-ScreenCapture {
    param([string]$FileName)
    Add-Type -AssemblyName System.Drawing
    if (-not ('NoxCaptureNative' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NoxCaptureNative {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);
}
'@
    }
    # Use one physical-pixel context for BOTH bounds and copying. Never multiply
    # logical bounds by an assumed scale; the desktop can have negative origins.
    $previousContext = [NoxCaptureNative]::SetThreadDpiAwarenessContext([IntPtr](-4))
    if ($previousContext -eq [IntPtr]::Zero) {
        throw "Cannot enter physical capture DPI context (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    }
    try {
        $captureX = [NoxCaptureNative]::GetSystemMetrics(76) # SM_XVIRTUALSCREEN
        $captureY = [NoxCaptureNative]::GetSystemMetrics(77) # SM_YVIRTUALSCREEN
        $captureWidth = [NoxCaptureNative]::GetSystemMetrics(78) # SM_CXVIRTUALSCREEN
        $captureHeight = [NoxCaptureNative]::GetSystemMetrics(79) # SM_CYVIRTUALSCREEN
        if ($captureWidth -le 0 -or $captureHeight -le 0) {
            throw "Invalid physical desktop bounds: ${captureX},${captureY} ${captureWidth}x${captureHeight}"
        }
        $bitmap = New-Object System.Drawing.Bitmap($captureWidth, $captureHeight)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.CopyFromScreen($captureX, $captureY, 0, 0, $bitmap.Size)
            } finally { $graphics.Dispose() }
            if ([string]::IsNullOrWhiteSpace($FileName)) {
                $FileName = 'screen-{0}.png' -f (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
            }
            $target = Join-Path $MediaDir ([System.IO.Path]::GetFileName($FileName))
            $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $bitmap.Dispose() }
    } finally {
        # Do not change the DPI context for overlays or later queue commands.
        $restoredContext = [NoxCaptureNative]::SetThreadDpiAwarenessContext($previousContext)
        if ($restoredContext -eq [IntPtr]::Zero) {
            $script:CaptureDpiRestoreFailed = $true
            throw "Cannot restore capture DPI context (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
        }
    }
    Write-AgentLog "Screen capture written to $target (${captureWidth}x${captureHeight} physical pixels; origin ${captureX},${captureY})"
}

function Initialize-StartNative {
 if(-not ('StartNative' -as [type])) {Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class StartSnapshot { public long hwnd; public uint pid,tick; public int x,y; public string title,windowClass; }
public class StartInputResult { public bool ok,releaseInserted,unresolvedRelease; public uint inserted,cleanupInserted,cursorInserted; public int error,cleanupError,cursorError; public string failure,cursorDisposition; }
public interface IStartIO {
 bool Valid(StartSnapshot s); bool Idle {get;} long Now {get;}
 uint Batch(out int error); uint Release(out int error);
}
public static class StartGuard {
 public static StartInputResult Run(IStartIO io,StartSnapshot s,long deadline) {
  var r=new StartInputResult();r.cursorDisposition="not_moved";
  if(io.Now>deadline||!io.Valid(s)||!io.Idle||io.Now>deadline){r.failure="boundary_refused";return r;}
  r.inserted=io.Batch(out r.error);
  r.releaseInserted=r.inserted==3;
  if(r.inserted==2){r.cleanupInserted=io.Release(out r.cleanupError);r.releaseInserted=r.cleanupInserted==1;r.unresolvedRelease=!r.releaseInserted;}
  if(r.inserted>0)r.cursorDisposition="left_at_clicked_control_no_restore_input";
  r.ok=r.inserted==3;
  if(!r.ok)r.failure="partial_or_failed_input";
  return r;
 }
}
public class StartNative:IStartIO {
 public Process Bound;
 [StructLayout(LayoutKind.Sequential)] public struct POINT{public int x,y;}
 [StructLayout(LayoutKind.Sequential)] public struct RECT{public int l,t,r,b;}
 [StructLayout(LayoutKind.Sequential)] struct LAST{public uint size,time;}
 [StructLayout(LayoutKind.Sequential)] public struct INPUT{public uint type;public UNION data;}
 [StructLayout(LayoutKind.Explicit)] public struct UNION{[FieldOffset(0)]public MOUSE mouse;}
 [StructLayout(LayoutKind.Sequential)] public struct MOUSE{public int dx,dy;public uint data,flags,time;public UIntPtr extra;}
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr w,System.Text.StringBuilder b,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr w,System.Text.StringBuilder b,int n);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll",SetLastError=true)] static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr w,out RECT r);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr w,ref POINT p);
 [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr w,uint flags);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int k);
 [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LAST l);
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n,INPUT[] a,int size);
 [DllImport("kernel32.dll")] static extern void SetLastError(uint v);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 public long Now{get{return DateTime.UtcNow.Ticks;}}
 public bool Idle{get{for(int k=1;k<255;k++)if((GetAsyncKeyState(k)&0x8000)!=0)return false;return true;}}
 public uint Tick(){var l=new LAST();l.size=(uint)Marshal.SizeOf(typeof(LAST));if(!GetLastInputInfo(ref l))throw new Exception("Last-input query failed");return l.time;}
 public StartSnapshot Snapshot(){POINT p;if(!GetCursorPos(out p))throw new Exception("Cursor query failed");var w=GetForegroundWindow();uint id;GetWindowThreadProcessId(w,out id);var title=new System.Text.StringBuilder(512);var cls=new System.Text.StringBuilder(256);GetWindowText(w,title,512);GetClassName(w,cls,256);return new StartSnapshot{title=title.ToString(),windowClass=cls.ToString(),hwnd=w.ToInt64(),pid=id,tick=Tick(),x=p.x,y=p.y};}
 bool Window(StartSnapshot s){
  if(Bound==null||Bound.HasExited||Bound.Id!=s.pid)return false;
  var w=GetForegroundWindow();uint p;GetWindowThreadProcessId(w,out p);if(w.ToInt64()!=s.hwnd||p!=s.pid)return false;var current=Snapshot();if(!current.title.StartsWith("KYST Wall",StringComparison.Ordinal)||current.windowClass!="Chrome_WidgetWin_1"||s.x<0||s.x>=3840||s.y<0||s.y>=2160)return false;
  RECT r;POINT o=new POINT();if(!GetClientRect(w,out r)||!ClientToScreen(w,ref o))return false;
  if(o.x!=0||o.y!=0||r.l!=0||r.t!=0||r.r!=3840||r.b!=2160)return false;
  if(GetSystemMetrics(76)!=0||GetSystemMetrics(77)!=0||GetSystemMetrics(78)!=3840||GetSystemMetrics(79)!=2160)return false;
  return GetAncestor(WindowFromPoint(new POINT{x=1920,y=1080}),2)==w;
 }
 public bool Valid(StartSnapshot s){POINT p;return Window(s)&&GetCursorPos(out p)&&p.x==s.x&&p.y==s.y&&Tick()==s.tick;}
 INPUT Move(int x,int y){var a=new INPUT();a.data.mouse.dx=(int)Math.Round(x*65535.0/3839);a.data.mouse.dy=(int)Math.Round(y*65535.0/2159);a.data.mouse.flags=0xC001;return a;}
 uint Send(INPUT[] a,out int error){SetLastError(0);var n=SendInput((uint)a.Length,a,Marshal.SizeOf(typeof(INPUT)));error=Marshal.GetLastWin32Error();return n;}
 public uint Batch(out int error){var a=new INPUT[3];a[0]=Move(1920,1080);a[1].data.mouse.flags=2;a[2].data.mouse.flags=4;return Send(a,out error);}
 public uint Release(out int error){var a=new INPUT[1];a[0].data.mouse.flags=4;return Send(a,out error);}
}
'@
 }
}
# Receipt correlation only: legacy permission is one immutable historical receipt.
function Read-StartEvidence([string]$Path) {
 $bytes=[IO.File]::ReadAllBytes($Path);$sha=[Security.Cryptography.SHA256]::Create()
 try{$hash=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 $text=[Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xfeff)
 @{hash=$hash;value=($text|ConvertFrom-Json -ErrorAction Stop)}
}
function Assert-StartSuccessorEligibility([string]$RootPath,[string]$MediaPath) {
 $claim=Read-StartEvidence (Join-Path $RootPath 'nox11625-start-baseline.claimed')
 $receipt=Read-StartEvidence (Join-Path $MediaPath 'nox11625-start-baseline.start.json')
 $refresh=Read-StartEvidence (Join-Path $MediaPath 'nox11625-refresh-baseline.refresh.json')
 if($claim.hash -cne '8c5c721e28deddc238b549e22aa63913c1b8ac2d8930cd51f68c7b146ec7cbbf' -or $receipt.hash -cne '7e29e8e0e9053f05b892d5462a314bd1147dfda641d2bfcdef4217d9d3b9a6aa' -or $refresh.hash -cne '66288892f29ece094d2602d8d0e263543ed0b5cdc791647fa6656f925c0857b1'){throw 'Successor historical evidence pin mismatch'}
 $r=$receipt.value
 if($r.invocationId -cne 'nox11625-start-baseline' -or $r.phase -cne 'preflight' -or $r.ok -cne $false -or $r.error -cne 'Refresh receipt not bound to current board' -or -not $r.completedAt -or $r.input -or $r.target -or $r.capture -or $r.contextError -or $r.receiptError -or $r.disposeError){throw 'Successor requires the exact terminal no-input refusal'}
 # Pins bind the original bytes. No receipt/claim is rewritten or removed.
}
function Get-StartReceiptDate($Value) {
 if($Value -is [DateTime]){$date=$Value}
 elseif($Value -is [string] -and $Value -cmatch '^/Date\(([0-9]{13})\)/$'){
  $ticks=[int64]621355968000000000+([int64]$Matches[1]*[int64]10000)
  $date=[DateTime]::new($ticks,[DateTimeKind]::Utc)
 }elseif($Value -is [string]){
  $date=[DateTime]::MinValue
  if(-not [DateTime]::TryParseExact($Value,'o',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind,[ref]$date)){throw 'Malformed receipt creation date'}
 }else{throw 'Missing/invalid receipt creation date'}
 if($date.Kind -ne [DateTimeKind]::Utc){throw 'Ambiguous receipt timezone'}
 $date
}
function Assert-StartReceiptIdentity($Receipt,$Live,[bool]$PinnedLegacy) {
 foreach($v in @($Receipt,$Live)){
  if($null -eq $v -or ($v.pid -isnot [int] -and $v.pid -isnot [long]) -or $v.pid -le 0 -or ($v.session -isnot [int] -and $v.session -isnot [long]) -or $v.session -ne 1){throw 'Malformed PID/session identity'}
  foreach($key in @('sid','executable','commandHash')){if($v.$key -isnot [string] -or [string]::IsNullOrWhiteSpace($v.$key)){throw ('Missing identity field: '+$key)}}
  if($v.commandHash -cnotmatch '^[0-9a-f]{64}$'){throw 'Malformed command hash'}
 }
 foreach($key in @('pid','session','sid','executable','commandHash')){if($Receipt.$key -cne $Live.$key){throw ('Receipt identity mismatch: '+$key)}}
 if($Live.created -isnot [DateTime]){throw 'Live creation is not a native DateTime'}
 $liveTicks=$Live.created.ToUniversalTime().Ticks
 $date=Get-StartReceiptDate $Receipt.created
 $hasFormat=$null -ne $Receipt.creationRepresentation;$hasTicks=$null -ne $Receipt.createdUtcTicks
 if($hasFormat -or $hasTicks){
  if($PinnedLegacy -or $Receipt.creationRepresentation -cne 'utc-ticks-v1' -or $Receipt.createdUtcTicks -isnot [string] -or $Receipt.createdUtcTicks -cnotmatch '^[0-9]{18}$'){throw 'Invalid/inconsistent creation representation'}
  $ticks=[int64]::Parse($Receipt.createdUtcTicks,[Globalization.CultureInfo]::InvariantCulture)
  # The compatibility DateTime field may be serialized at milliseconds by PS5.
  # The explicit decimal ticks remain lossless and MUST match live ticks exactly.
  if($date.Ticks -ne $ticks -and $date.Ticks -ne ($ticks-($ticks%10000))){throw 'Inconsistent receipt creation fields'}
  if($ticks -ne $liveTicks){throw 'Full-precision receipt creation mismatch'}
  return @{representation='utc-ticks-v1';matchedTicks=$Receipt.createdUtcTicks;historicalSubmillisecondIdentity=$true}
 }
 if(-not $PinnedLegacy -or $date.Ticks%10000 -ne 0){throw 'Unrecognized unversioned receipt'}
 if($date.Ticks -ne ($liveTicks-($liveTicks%10000))){throw 'Legacy receipt millisecond mismatch'}
 @{representation='pinned-legacy-windows-json-ms';matchedMillisecondTicks=$date.Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);historicalSubmillisecondIdentity=$false}
}
function Assert-StartRefreshCorrelation([string]$Invocation,[string]$RootPath,[string]$MediaPath,$Identity) {
 if($Invocation -ceq 'nox11625-start-baseline-precision'){
  Assert-StartSuccessorEligibility $RootPath $MediaPath
  $refreshId='nox11625-refresh-baseline'
 }elseif($Invocation -cin @('nox11625-start-classic','nox11625-start-nox-return')){$refreshId=$Invocation.Replace('start-','refresh-')}
 else{throw 'No receipt correlation authorized for this invocation'}
 $e=Read-StartEvidence (Join-Path $MediaPath ($refreshId+'.refresh.json'));$r=$e.value
 if($r.invocationId -cne $refreshId -or $r.ok -isnot [bool] -or -not $r.ok -or $r.phase -cne 'complete' -or $r.stopTerminal -isnot [bool] -or -not $r.stopTerminal -or -not $r.completedAt){throw 'Matching refresh not complete'}
 $legacy=$refreshId -ceq 'nox11625-refresh-baseline' -and $e.hash -ceq '66288892f29ece094d2602d8d0e263543ed0b5cdc791647fa6656f925c0857b1'
 Assert-StartReceiptIdentity $r.after $Identity $legacy
}
function Assert-StartBoundCreation($Process,$Identity) {
 if($Process.HasExited -or $Process.Id -ne $Identity.pid -or $Process.StartTime.ToUniversalTime().Ticks -ne $Identity.created.ToUniversalTime().Ticks){throw 'Exact bound process creation/exit mismatch'}
}

# Fixed startup control only. No coordinate, key, URL or phase arguments accepted.
function Write-StartReceipt([string]$Path,$Value) {
 $b=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 10));$t=$Path+'.tmp'
 $f=[IO.File]::Open($t,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()}
 Move-Item -LiteralPath $t -Destination $Path -Force
}
function Assert-StartSame($A,$B){foreach($k in @('pid','created','sid','session','executable','commandHash')){if($A[$k] -ne $B[$k]){throw ('Board identity drift: '+$k)}}}
function Invoke-StartSequence([hashtable]$Ops,$Result) {
 $bound=$null;$context=$null
 try {
  & $Ops.Validate
  $before=& $Ops.Identity;$Result.before=$before
  $bound=& $Ops.Bind $before
  $context=& $Ops.Context $bound
  $Result.foregroundBefore=$context.snapshot
  & $Ops.Phase $before
  Assert-StartSame $before (& $Ops.Identity)
  # Pre-input durable marker precedes the final image check. A hung/disappeared
  # handler keeps an ambiguous claim; never reload/kill while cleanup may run.
  $Result.phase='input_may_start';& $Ops.Record $Result
  $Result.target=& $Ops.Target
  $Result.input=& $Ops.Click $context $bound
  $Result.phase='input_returned'
  $Result.foregroundAfter=& $Ops.After $context
  $Result.capture=& $Ops.Capture
  if(-not $Result.input.ok){throw ('Input refused/partial: '+$Result.input.failure)}
  if($Result.foregroundAfter.hwnd -ne $Result.foregroundBefore.hwnd -or $Result.foregroundAfter.pid -ne $Result.foregroundBefore.pid){throw 'Foreground changed after click; no retry'}
  Assert-StartSame $before (& $Ops.Identity)
  $Result.ok=$true;$Result.phase='complete'
 }catch{$Result.error=$_.Exception.Message}
 finally {
  if($context){try{& $Ops.DisposeContext $context}catch{$Result.contextError=$_.Exception.Message;$Result.ok=$false}}
  if($bound){try{$bound.Dispose()}catch{$Result.disposeError=$_.Exception.Message;$Result.ok=$false}}
  $Result.completedAt=[DateTime]::UtcNow.ToString('o')
  try{& $Ops.Record $Result}catch{$Result.receiptError=$_.Exception.Message;$Result.ok=$false}
 }
 $Result
}
function Invoke-StartupControl([IO.FileInfo]$File,$Command) {
 if(@($Command.PSObject.Properties).Count -ne 1 -or $Command.cmd -cne 'start_board'){throw 'Only {"cmd":"start_board"} accepted'}
 $id=$File.BaseName
 if($id -cnotin @('nox11625-start-baseline','nox11625-start-baseline-precision','nox11625-start-classic','nox11625-start-nox-return')){throw 'Unapproved startup phase ID'}
 $start=[DateTime]::UtcNow;$deadline=$start.AddSeconds(20)
 if(($start-$File.CreationTimeUtc).TotalSeconds -gt 30 -or $File.CreationTimeUtc -gt $start.AddSeconds(2)){throw 'Stale/future startup queue file'}
 $path=Join-Path $MediaDir ($id+'.start.json');$claim=Join-Path $Root ($id+'.claimed')
 $f=[IO.File]::Open($claim,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$b=[Text.Encoding]::UTF8.GetBytes((@{id=$id;agentPid=$PID;at=$start.ToString('o');retryAllowed=$false}|ConvertTo-Json));$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()}
 $result=@{invocationId=$id;agentPid=$PID;startedAt=$start.ToString('o');deadline=$deadline.ToString('o');ok=$false;retryAllowed=$false;phase='preflight'}
 $ops=@{
  Validate={
   Assert-RefreshTask
   if($id -ceq 'nox11625-start-baseline-precision'){Assert-StartSuccessorEligibility $Root $MediaDir}
   if([DateTime]::UtcNow -gt $deadline){throw 'Startup deadline expired'}
   Initialize-StartNative
  };
  Identity={Get-RefreshBoardIdentity};
  Bind={param($identity)$p=Get-Process -Id $identity.pid -ErrorAction Stop;try{$null=$p.Handle;Assert-StartBoundCreation $p $identity;return $p}catch{$p.Dispose();throw}};
  Context={param($p)
   $old=[StartNative]::SetThreadDpiAwarenessContext([IntPtr](-4));if($old -eq [IntPtr]::Zero){throw 'Physical DPI context refused'}
   try{$io=[StartNative]::new();$io.Bound=$p;$snap=$io.Snapshot();if(-not $io.Valid($snap) -or -not $io.Idle){throw 'Wrong foreground/geometry or active input'};@{io=$io;snapshot=$snap;previous=$old}}catch{
    $initialContextError=$_
    $result.contextInitialError=$initialContextError.Exception.Message
    try {
     if([StartNative]::SetThreadDpiAwarenessContext($old) -eq [IntPtr]::Zero){throw 'Initial DPI context restoration failed'}
     $result.contextCleanup='restored'
    } catch {
     $result.contextError=$_.Exception.Message
     $result.contextCleanup='unresolved'
     $script:CaptureDpiRestoreFailed=$true
    }
    throw $initialContextError
   }
  };
  Phase={param($identity)
   $result.receiptCorrelation=Assert-StartRefreshCorrelation $id $Root $MediaDir $identity
  };
  Record={param($r)Write-StartReceipt $path $r};
  Target={
   $script:StartTargetAt=[DateTime]::UtcNow
   $name=$id+'.before.png';Save-ScreenCapture -FileName $name
   $hash=Get-RefreshHash (Join-Path $MediaDir $name)
   if($hash -ne '2e92ca13139f034a8d634ffc0c05163911508fc8e61fa7c46bc223dfe244233a'){throw 'Full-frame startup target mismatch; no click'}
   @{file=$name;sha256=$hash;x=1920;y=1080;width=3840;height=2160;observedAt=$script:StartTargetAt.ToString('o')}
  };
  Click={param($c,$p)
   $until=[Math]::Min($deadline.Ticks,$script:StartTargetAt.AddMilliseconds(1500).Ticks)
   [StartGuard]::Run($c.io,$c.snapshot,$until)
  };
  After={param($c)$c.io.Snapshot()};
  Capture={$name=$id+'.after.png';Save-ScreenCapture -FileName $name;@{file=$name;sha256=(Get-RefreshHash (Join-Path $MediaDir $name));at=[DateTime]::UtcNow.ToString('o')}};
  DisposeContext={param($c)if([StartNative]::SetThreadDpiAwarenessContext($c.previous) -eq [IntPtr]::Zero){$script:CaptureDpiRestoreFailed=$true;throw 'DPI restore failed'}}
 }
 $r=Invoke-StartSequence $ops $result
 if(-not $r.ok){throw ('Startup operation failed; no retry: '+$r.error+' '+$r.receiptError)}
 Write-AgentLog ('Startup click inserted and captured id='+$id+'; visual acceptance still required')
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

function Initialize-ObserveNative {
 if(-not ('ObserveNative' -as [type])) {
  # Compile the unchanged window guard and fixed Shift adapter together so PS5
  # does not require a filesystem assembly reference to an in-memory Add-Type.
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class ObserveSnapshot { public long hwnd; public uint pid,tick; public int x,y; public string title,windowClass; }
public class ObserveInputResult { public bool ok,releaseInserted,unresolvedRelease; public uint inserted,cleanupInserted,cursorInserted; public int error,cleanupError,cursorError; public string failure,cursorDisposition; }
public interface IObserveIO {
 bool Valid(ObserveSnapshot s); bool Idle {get;} long Now {get;}
 uint Batch(out int error); uint Release(out int error);
}
public class ObserveWindow {
 public Process Bound;
 [StructLayout(LayoutKind.Sequential)] public struct POINT{public int x,y;}
 [StructLayout(LayoutKind.Sequential)] public struct RECT{public int l,t,r,b;}
 [StructLayout(LayoutKind.Sequential)] struct LAST{public uint size,time;}
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr w,System.Text.StringBuilder b,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr w,System.Text.StringBuilder b,int n);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll",SetLastError=true)] static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr w,out RECT r);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr w,ref POINT p);
 [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr w,uint flags);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int k);
 [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LAST l);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 public long Now{get{return DateTime.UtcNow.Ticks;}}
 public bool Idle{get{for(int k=1;k<255;k++)if((GetAsyncKeyState(k)&0x8000)!=0)return false;return true;}}
 public uint Tick(){var l=new LAST();l.size=(uint)Marshal.SizeOf(typeof(LAST));if(!GetLastInputInfo(ref l))throw new Exception("Last-input query failed");return l.time;}
 public ObserveSnapshot Snapshot(){POINT p;if(!GetCursorPos(out p))throw new Exception("Cursor query failed");var w=GetForegroundWindow();uint id;GetWindowThreadProcessId(w,out id);var title=new System.Text.StringBuilder(512);var cls=new System.Text.StringBuilder(256);GetWindowText(w,title,512);GetClassName(w,cls,256);return new ObserveSnapshot{title=title.ToString(),windowClass=cls.ToString(),hwnd=w.ToInt64(),pid=id,tick=Tick(),x=p.x,y=p.y};}
 bool Window(ObserveSnapshot s){
  if(Bound==null||Bound.HasExited||Bound.Id!=s.pid)return false;
  var w=GetForegroundWindow();uint p;GetWindowThreadProcessId(w,out p);if(w.ToInt64()!=s.hwnd||p!=s.pid)return false;var current=Snapshot();if(!current.title.StartsWith("KYST Wall",StringComparison.Ordinal)||current.windowClass!="Chrome_WidgetWin_1"||s.x<0||s.x>=3840||s.y<0||s.y>=2160)return false;
  RECT r;POINT o=new POINT();if(!GetClientRect(w,out r)||!ClientToScreen(w,ref o))return false;
  if(o.x!=0||o.y!=0||r.l!=0||r.t!=0||r.r!=3840||r.b!=2160)return false;
  if(GetSystemMetrics(76)!=0||GetSystemMetrics(77)!=0||GetSystemMetrics(78)!=3840||GetSystemMetrics(79)!=2160)return false;
  return GetAncestor(WindowFromPoint(new POINT{x=1920,y=1080}),2)==w;
 }
 public bool Valid(ObserveSnapshot s){POINT p;return Window(s)&&GetCursorPos(out p)&&p.x==s.x&&p.y==s.y&&Tick()==s.tick;}
}

public class ObserveNative : IObserveIO {
 public ObserveWindow Window=new ObserveWindow();
 [StructLayout(LayoutKind.Sequential)] public struct INPUT{public uint type;public UNION data;}
 [StructLayout(LayoutKind.Explicit)] public struct UNION{[FieldOffset(0)]public MOUSE mouse;[FieldOffset(0)]public KEY key;}
 [StructLayout(LayoutKind.Sequential)] public struct MOUSE{public int dx,dy;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct KEY{public ushort vk,scan;public uint flags,time;public UIntPtr extra;}
 public bool Valid(ObserveSnapshot s){return Window.Valid(s);}
 public bool Idle{get{return Window.Idle;}} public long Now{get{return Window.Now;}}
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n,INPUT[] input,int size);
 [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
 public uint Batch(out int error){var a=new INPUT[2];a[0].type=1;a[0].data.key.vk=16;a[1].type=1;a[1].data.key.vk=16;a[1].data.key.flags=2;SetLastError(0);uint n=SendInput(2,a,Marshal.SizeOf(typeof(INPUT)));error=Marshal.GetLastWin32Error();return n;}
 public uint Release(out int error){var a=new INPUT[1];a[0].type=1;a[0].data.key.vk=16;a[0].data.key.flags=2;SetLastError(0);uint n=SendInput(1,a,Marshal.SizeOf(typeof(INPUT)));error=Marshal.GetLastWin32Error();return n;}
}
public static class ObserveGuard {
 public static ObserveInputResult Run(IObserveIO io,ObserveSnapshot s,long deadline){
  var r=new ObserveInputResult();r.cursorDisposition="not_moved";
  if(io.Now>=deadline){r.failure="deadline";return r;}
  if(!io.Valid(s)||!io.Idle){r.failure="identity_focus_geometry_or_input_drift";return r;}
  if(io.Now>=deadline){r.failure="deadline";return r;}
  r.inserted=io.Batch(out r.error);
  if(r.inserted==2){r.ok=true;r.releaseInserted=true;return r;}
  r.failure="partial_or_failed_shift_pair";
  if(r.inserted!=0){r.cleanupInserted=io.Release(out r.cleanupError);r.releaseInserted=r.cleanupInserted==1;r.unresolvedRelease=!r.releaseInserted;}
  return r;
 }
}

'@
 }
}
function Invoke-ObserveBoardOnce([IO.FileInfo]$File,$Command) {
 if(@($Command.PSObject.Properties).Count -ne 1 -or $Command.cmd -cne 'observe_board_once'){throw 'Only {"cmd":"observe_board_once"} accepted'}
 $id='nox11625-observe-after-night-sky'
 if($File.BaseName -cne $id){throw 'Unapproved observation ID'}
 $start=[DateTime]::UtcNow;$deadline=$start.AddSeconds(20)
 if(($start-$File.CreationTimeUtc).TotalSeconds -gt 30 -or $File.CreationTimeUtc -gt $start.AddSeconds(2)){throw 'Stale/future observation queue file'}
 $claim=Join-Path $Root ($id+'.claimed');$path=Join-Path $MediaDir ($id+'.observe.json')
 $f=[IO.File]::Open($claim,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$b=[Text.Encoding]::UTF8.GetBytes((@{id=$id;agentPid=$PID;at=$start.ToString('o');retryAllowed=$false}|ConvertTo-Json));$f.Write($b,0,$b.Length);$f.Flush($true)}finally{$f.Dispose()}
 $result=@{invocationId=$id;agentPid=$PID;startedAt=$start.ToString('o');deadline=$deadline.ToString('o');ok=$false;retryAllowed=$false;phase='preflight';operation='one Shift pair; no click or adaptive input'}
 $ops=@{
  Validate={Assert-RefreshTask;$null=Get-PinnedPreclickRefusal $Root $MediaDir;Assert-StartSuccessorEligibility $Root $MediaDir;if([DateTime]::UtcNow -ge $deadline){throw 'Observation deadline expired'};Initialize-ObserveNative};
  Identity={Get-RefreshBoardIdentity};
  Bind={param($identity)$p=Get-Process -Id $identity.pid -ErrorAction Stop;try{$null=$p.Handle;Assert-StartBoundCreation $p $identity;return $p}catch{$p.Dispose();throw}};
  Context={param($p)
   $old=[ObserveWindow]::SetThreadDpiAwarenessContext([IntPtr](-4));if($old -eq [IntPtr]::Zero){throw 'Physical DPI context refused'}
   try{$io=[ObserveNative]::new();$io.Window.Bound=$p;$snap=$io.Window.Snapshot();if(-not $io.Valid($snap) -or -not $io.Idle){throw 'Wrong foreground/geometry or active input'};@{io=$io;snapshot=$snap;previous=$old}}catch{
    $initialContextError=$_;$result.contextInitialError=$initialContextError.Exception.Message
    try{if([ObserveWindow]::SetThreadDpiAwarenessContext($old) -eq [IntPtr]::Zero){throw 'Initial DPI context restoration failed'};$result.contextCleanup='restored'}catch{$result.contextError=$_.Exception.Message;$result.contextCleanup='unresolved';$script:CaptureDpiRestoreFailed=$true}
    throw $initialContextError
   }
  };
  Phase={param($identity)$refusal=Get-PinnedPreclickRefusal $Root $MediaDir;$result.refusalCorrelation=Assert-StartReceiptIdentity $refusal.before $identity $false;$result.reconciliation=@{kind='exact-pinned-terminal-preclick-refusal';historicalReceiptUnchanged=$true;oldClaimsRemainConsumed=$true}};
  Record={param($r)Write-StartReceipt $path $r};
  # Observational frame only: no image match, adaptive coordinates or startup
  # reference. The only action is the fixed guarded key pair approved for review.
  Target={$name=$id+'.before.png';Save-ScreenCapture -FileName $name;@{file=$name;sha256=(Get-RefreshHash (Join-Path $MediaDir $name));purpose='pre-input observation, not a visual targeting assertion'}};
  Click={param($c,$p)[ObserveGuard]::Run($c.io,$c.snapshot,$deadline.Ticks)};
  After={param($c)$c.io.Window.Snapshot()};
  Capture={$name=$id+'.after.png';Save-ScreenCapture -FileName $name;@{file=$name;sha256=(Get-RefreshHash (Join-Path $MediaDir $name));at=[DateTime]::UtcNow.ToString('o')}};
  DisposeContext={param($c)if([ObserveWindow]::SetThreadDpiAwarenessContext($c.previous) -eq [IntPtr]::Zero){$script:CaptureDpiRestoreFailed=$true;throw 'DPI restore failed'}}
 }
 $r=Invoke-StartSequence $ops $result
 if(-not $r.ok){throw ('Observation failed; no retry: '+$r.error+' '+$r.receiptError)}
 Write-AgentLog ('One Shift pair inserted; observation id='+$id+'; board visibility not inferred')
}

function Process-CommandFile {
    param([System.IO.FileInfo]$File)
    $script:LastCommandId = $File.BaseName
    try {
        $raw = Get-Content -LiteralPath $File.FullName -Raw -Encoding UTF8
        $command = $raw | ConvertFrom-Json
        $name = [string]$command.cmd
        if ([string]::IsNullOrWhiteSpace($name)) { throw 'command is missing cmd' }
        $script:LastCommand = $name
        $script:LastError = $null
        Write-AgentLog "Processing command id=$($File.BaseName) cmd=$name"

        switch ($name) {
            'announce' {
                $seconds = if ($command.seconds) { [int]$command.seconds } else { 20 }
                Show-Announcement -Text ([string]$command.text) -Seconds $seconds
                if ($command.mp3) { Start-AudioPlayback -FileName ([string]$command.mp3) }
            }
            'show' {
                $seconds = if ($command.seconds) { [int]$command.seconds } else { 120 }
                Start-ShowWindow -Url ([string]$command.url) -Seconds $seconds
            }
            'close_show' { Close-ShowWindow -Reason 'command' }
            'speak' { Start-AudioPlayback -FileName ([string]$command.mp3) }
            'refresh_board' { Restart-FamilyBoard }
            'screenshot' { Save-ScreenCapture -FileName ([string]$command.file) }
            'start_board' { Invoke-StartupControl -File $File -Command $command }
            'observe_board_once' { Invoke-ObserveBoardOnce -File $File -Command $command }
            default { throw "unsupported command: $name" }
        }
        $script:LastResult = 'ok'
        $script:CommandReceipts = @(
            [ordered]@{ commandId = $File.BaseName; command = $name; result = 'ok'; completedAt = (Get-Date).ToUniversalTime().ToString('o') }
            $script:CommandReceipts
        ) | Select-Object -First 100
        Write-AgentLog "Command completed id=$($File.BaseName) cmd=$name"
    } catch {
        $script:LastResult = 'error'
        $script:LastError = $_.Exception.Message
        $script:CommandReceipts = @(
            [ordered]@{ commandId = $File.BaseName; command = $script:LastCommand; result = 'error'; error = $script:LastError; completedAt = (Get-Date).ToUniversalTime().ToString('o') }
            $script:CommandReceipts
        ) | Select-Object -First 100
        Write-AgentLog "Command failed id=$($File.BaseName): $($_.Exception.Message)" 'ERROR'
    } finally {
        $destination = Join-Path $DoneDir $File.Name
        Move-Item -LiteralPath $File.FullName -Destination $destination -Force -ErrorAction SilentlyContinue
        @(Get-ChildItem -LiteralPath $DoneDir -Filter '*.json' -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTimeUtc -Descending | Select-Object -Skip 50) |
            Remove-Item -Force -ErrorAction SilentlyContinue
    }
}

foreach ($directory in @($Root, $QueueDir, $DoneDir, $MediaDir, $ShowProfile)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
}

Restore-CommandReceipts
Write-AgentLog "NOX kiosk agent started PID=$PID session=$((Get-Process -Id $PID).SessionId) user=$([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"

# Any temporary display left by an interrupted watcher belongs to this agent profile only.
Close-ShowWindow -Reason 'agent startup cleanup'

while ($true) {
    try {
        if ($script:ShowDeadline -and (Get-Date) -ge $script:ShowDeadline) {
            Close-ShowWindow -Reason 'timeout'
        }
        $next = Get-ChildItem -LiteralPath $QueueDir -Filter '*.json' -File -ErrorAction SilentlyContinue |
            Sort-Object CreationTimeUtc, Name | Select-Object -First 1
        if ($next) { Process-CommandFile -File $next }
        Write-AgentState
    } catch {
        $script:LastResult = 'loop_error'
        $script:LastError = $_.Exception.Message
        try { Write-AgentLog "Watcher loop error: $($_.Exception.Message)" 'ERROR' } catch { }
        try { Write-AgentState } catch { }
    }
    # The dispatcher has recorded the error and the loop persisted its receipt.
    # Never process another command on a thread whose DPI context is unknown.
    if ($script:CaptureDpiRestoreFailed) { exit 1 }
    Start-Sleep -Seconds $PollSeconds
}
