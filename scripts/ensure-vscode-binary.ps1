# Ensure / download / brand the VS Code binary on Windows.
param(
  [switch]$Force
)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$argsList = @()
if ($Force) { $argsList += "--force" }
& node (Join-Path $ScriptDir "ensure-vscode-binary.mjs") @argsList
exit $LASTEXITCODE
