$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$environmentPath = Join-Path $projectRoot ".venv-wu-analysis"
$pythonPath = Join-Path $environmentPath "Scripts\python.exe"

if (-not (Test-Path $pythonPath)) {
    py -3.12 -m venv $environmentPath
}

& $pythonPath -m pip install --disable-pip-version-check -r (Join-Path $projectRoot "requirements-wu-analysis.txt")
& $pythonPath (Join-Path $projectRoot "scripts\build_wu_precinct_analysis.py") @args
