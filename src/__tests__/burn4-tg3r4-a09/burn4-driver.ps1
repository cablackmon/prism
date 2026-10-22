param([string]$Root, [string]$OptionsFile)

$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Management
Import-Module Microsoft.PowerShell.Utility
$PSModuleAutoLoadingPreference = 'None'
$global:Burn4Root = [IO.Path]::GetFullPath($Root)
$global:Burn4Options = [IO.File]::ReadAllText($OptionsFile) | ConvertFrom-Json
$global:Burn4Calls = [Collections.Generic.List[object]]::new()

function global:Burn4Path([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = $global:Burn4Root + [IO.Path]::DirectorySeparatorChar
    if ($full -ne $global:Burn4Root -and -not $full.StartsWith($prefix, [StringComparison]::Ordinal)) {
        throw 'Fixture path boundary rejected'
    }
    return $full
}

function global:Burn4Record([string]$Operation, [string]$Path) {
    $global:Burn4Calls.Add([pscustomobject]@{ operation = $Operation; path = $Path })
    if ($global:Burn4Options.fault -eq $Operation) { throw "Injected fixture failure: $Operation" }
}

function global:Test-Path {
    param([string]$Path)
    $full = Burn4Path $Path
    Burn4Record 'exists' $full
    Microsoft.PowerShell.Management\Test-Path -LiteralPath $full
}

function global:New-Item {
    param([string]$ItemType, [string]$Path)
    $full = Burn4Path $Path
    Burn4Record 'mkdir' $full
    Microsoft.PowerShell.Management\New-Item -ItemType $ItemType -Path $full
}

function global:Get-Content {
    param([string]$Path, [switch]$Raw)
    $full = Burn4Path $Path
    Burn4Record 'read' $full
    Microsoft.PowerShell.Management\Get-Content -LiteralPath $full -Raw:$Raw
}

function global:Set-Content {
    param([string]$Path, [switch]$NoNewline, [Parameter(ValueFromPipeline = $true)]$Value)
    process {
        $full = Burn4Path $Path
        Burn4Record 'write' $full
        Microsoft.PowerShell.Management\Set-Content -LiteralPath $full -NoNewline:$NoNewline -Value $Value
    }
}

function global:Remove-Item {
    param([string]$Path, [switch]$Recurse, [switch]$Force)
    $full = Burn4Path $Path
    Burn4Record 'remove' $full
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $full -Recurse:$Recurse -Force:$Force
}

function global:Copy-Item {
    param([string]$Path, [string]$Destination, [switch]$Recurse)
    $full = Burn4Path $Path
    $dest = Burn4Path $Destination
    Burn4Record 'copy' $full
    Microsoft.PowerShell.Management\Copy-Item -LiteralPath $full -Destination $dest -Recurse:$Recurse
}

function global:Push-Location {
    param([string]$Path)
    $full = Burn4Path $Path
    Burn4Record 'push' $full
    Microsoft.PowerShell.Management\Push-Location -LiteralPath $full
}

function global:Pop-Location {
    Burn4Record 'pop' $global:Burn4Root
    Microsoft.PowerShell.Management\Pop-Location
}

foreach ($name in @('aws', 'npm', 'npx', 'curl', 'wget', 'Invoke-WebRequest', 'Invoke-RestMethod', 'Expand-Archive', 'Start-Process')) {
    Set-Item -Path "function:global:$name" -Value { throw 'Operational command forbidden in fixture' }
}

if ($global:Burn4Options.ask -ne 'missing') {
    function global:ask {
        $global:Burn4Calls.Add([pscustomobject]@{
            operation = 'ask'
            path = (Microsoft.PowerShell.Management\Get-Location).Path
            arguments = @($args)
        })
        if ($global:Burn4Options.ask -eq 'throw') { throw 'Injected ask failure' }
    }
}

$caller = (Microsoft.PowerShell.Management\Get-Location).Path
$failure = $null
try {
    & (Join-Path $global:Burn4Root 'alexa/deploy.ps1')
} catch {
    $failure = $_.Exception.Message
} finally {
    $result = [pscustomobject]@{
        calls = @($global:Burn4Calls.ToArray())
        caller = $caller
        after = (Microsoft.PowerShell.Management\Get-Location).Path
        error = $failure
    } | ConvertTo-Json -Depth 12 -Compress
    [IO.File]::WriteAllText((Join-Path $global:Burn4Root 'trace.json'), $result)
}
if ($failure) { exit 1 }
