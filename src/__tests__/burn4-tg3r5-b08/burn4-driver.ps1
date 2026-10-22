param([string]$Root)

$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Management
Import-Module Microsoft.PowerShell.Utility
$PSModuleAutoLoadingPreference = 'None'
$global:Burn4Root = [IO.Path]::GetFullPath($Root)
$global:Burn4Options = [IO.File]::ReadAllText([IO.Path]::Combine($Root, 'burn4-options.json')) | ConvertFrom-Json
$global:Burn4Calls = [Collections.Generic.List[object]]::new()
$global:Burn4Allowed = @('Write-Host', 'Get-Command', 'mkcert', 'New-Item', 'Out-Null', 'Push-Location', 'Pop-Location', 'Join-Path')
$global:Burn4Started = $false
$global:Burn4Verified = $false
$global:LASTEXITCODE = 0

function global:Burn4Path([string]$Path) {
    if (-not $Path) { throw 'Empty fixture path denied' }
    $normal = $Path.Replace('\', '/')
    $cwd = (Microsoft.PowerShell.Management\Get-Location).Path
    $full = [IO.Path]::GetFullPath($normal, $cwd)
    if ($full -ne $global:Burn4Root -and -not $full.StartsWith($global:Burn4Root + '/', [StringComparison]::Ordinal)) {
        throw 'Fixture path escape denied'
    }
    return $full
}

function global:Burn4Record([string]$Operation, [string[]]$Arguments = @()) {
    $global:Burn4Calls.Add([pscustomobject]@{
        operation = $Operation
        cwd = (Microsoft.PowerShell.Management\Get-Location).Path
        arguments = @($Arguments)
        status = [int]$global:LASTEXITCODE
    })
    if ($global:Burn4Options.fault -eq $Operation) { throw "Injected fixture failure: $Operation" }
}

function global:Burn4Validate([string]$Text) {
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($Text, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'Subject parse failed before execution' }
    foreach ($command in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true)) {
        $name = $command.GetCommandName()
        if (-not $name -or $global:Burn4Allowed -cnotcontains $name) { throw 'Unallowlisted or dynamic command denied' }
    }
    foreach ($variable in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.VariableExpressionAst] }, $true)) {
        if ($variable.VariablePath.DriveName -eq 'env') { throw 'Environment provider access denied' }
    }
    foreach ($node in $ast.FindAll({ param($item) $item -is [Management.Automation.Language.InvokeMemberExpressionAst] }, $true)) {
        throw 'Member invocation denied in subject'
    }
}

function global:Write-Host {
    param([object]$Object, [string]$ForegroundColor)
    Burn4Record 'message' @([string]$Object)
}

function global:Get-Command {
    [CmdletBinding()]
    param([string]$Name)
    if ($Name -cne 'mkcert') { throw 'Command lookup denied' }
    Burn4Record 'lookup' @($Name)
    if (-not $global:Burn4Options.missingTool) { return [pscustomobject]@{ Name = 'mkcert'; CommandType = 'Function' } }
}

function global:mkcert {
    $arguments = @($args | ForEach-Object { [string]$_ })
    $stage = switch ($arguments[0]) {
        '-install' { 'install' }
        '-cert-file' { 'generate' }
        '-CAROOT' { 'caroot' }
        default { throw 'Unexpected inert mkcert invocation denied' }
    }
    if ($global:Burn4Options.nativeFailure -eq $stage) { $global:LASTEXITCODE = $global:Burn4Options.nativeStatus }
    else { $global:LASTEXITCODE = 0 }
    Burn4Record $stage $arguments
    if ($stage -eq 'caroot') { return [IO.Path]::Combine($global:Burn4Root, 'ordinary-ca-location') }
}

function global:New-Item {
    param([string]$ItemType, [switch]$Force, [string]$Path)
    $full = Burn4Path $Path
    if ($ItemType -cne 'Directory' -or [IO.Path]::GetExtension($full) -match '^\.(crt|key|pem)$') { throw 'Material file creation denied' }
    Burn4Record 'mkdir' @($full, $ItemType, [string]$Force.IsPresent)
    Microsoft.PowerShell.Management\New-Item -ItemType Directory -Force:$Force -Path $full
}

function global:Out-Null {
    param([Parameter(ValueFromPipeline = $true)]$InputObject)
    process { }
}

function global:Push-Location {
    param([string]$Path)
    $full = Burn4Path $Path
    Burn4Record 'push' @($full)
    Microsoft.PowerShell.Management\Push-Location -LiteralPath $full
}

function global:Pop-Location {
    Burn4Record 'pop'
    Microsoft.PowerShell.Management\Pop-Location
}

function global:Join-Path {
    param([string]$Path, [string]$ChildPath)
    $full = Burn4Path $Path
    Burn4Record 'join' @($full, $ChildPath)
    return [IO.Path]::Combine($full, $ChildPath)
}

$caller = (Microsoft.PowerShell.Management\Get-Location).Path
$failure = $null
try {
    # Check every command binding before the subject or a safety probe can run.
    foreach ($name in $global:Burn4Allowed) {
        $binding = $ExecutionContext.SessionState.InvokeCommand.GetCommand($name, [Management.Automation.CommandTypes]::Function)
        if (-not $binding -or $binding.CommandType -ne 'Function' -or $binding.ScriptBlock.File -ne $PSCommandPath) {
            throw 'Inert function binding verification failed'
        }
    }
    $subject = [IO.Path]::Combine($global:Burn4Root, 'scripts', 'burn4-subject.ps1')
    Burn4Validate ([IO.File]::ReadAllText($subject))
    $global:Burn4Verified = $true

    if ($global:Burn4Options.probe) {
        switch ($global:Burn4Options.probe) {
            'path-escape' { New-Item -ItemType Directory -Path ([IO.Path]::Combine($global:Burn4Root, '..', 'escape')) }
            'material-file' { New-Item -ItemType File -Path ([IO.Path]::Combine($global:Burn4Root, 'config', 'prism.key')) }
            'lookup' { Get-Command openssl }
            default { Burn4Validate $global:Burn4Options.probe }
        }
    } else {
        $global:Burn4Started = $true
        $parameters = @{}
        if ($null -ne $global:Burn4Options.server) { $parameters.ServerIP = $global:Burn4Options.server }
        elseif ($global:Burn4Options.PSObject.Properties.Name -notcontains 'server') { $parameters.ServerIP = 'fixture.example.invalid' }
        & $subject @parameters
        if (-not $?) { $failure = 'Subject exited with failure' }
    }
} catch {
    $failure = $_.Exception.Message
} finally {
    $result = [pscustomobject]@{
        calls = @($global:Burn4Calls.ToArray())
        caller = $caller
        after = (Microsoft.PowerShell.Management\Get-Location).Path
        stackDepth = (Microsoft.PowerShell.Management\Get-Location -Stack).Count
        error = $failure
        subjectStarted = $global:Burn4Started
        gatesVerified = $global:Burn4Verified
    } | ConvertTo-Json -Depth 12 -Compress
    [IO.File]::WriteAllText([IO.Path]::Combine($global:Burn4Root, 'burn4-trace.json'), $result)
}
if ($failure) { exit 1 }
