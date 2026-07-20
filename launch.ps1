# Launch Grok Code on Windows (PowerShell).
# Usage:
#   .\launch.ps1
#   .\launch.ps1 C:\path\to\folder
#   $env:GROK_CODE_OPEN_AGENT = "0"; .\launch.ps1
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ArgsRest
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $env:GROK_CODE_OPEN_AGENT) { $env:GROK_CODE_OPEN_AGENT = "1" }
if (-not $env:GROK_CODE_ROOT) { $env:GROK_CODE_ROOT = $Root }
if (-not $env:GROK_CODE_CWD) { $env:GROK_CODE_CWD = (Get-Location).Path }

$launch = Join-Path $Root "scripts\launch-grok-code.mjs"
& node $launch @ArgsRest
exit $LASTEXITCODE
