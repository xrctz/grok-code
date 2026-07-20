# Launch Grok Code on Windows via Node.
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ArgsRest
)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $ScriptDir "launch-grok-code.mjs") @ArgsRest
exit $LASTEXITCODE
