# Install the Windows \`grok.cmd\` wrapper into %USERPROFILE%\\.local\\bin
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $ScriptDir "install-grok-shell.mjs")
exit $LASTEXITCODE
