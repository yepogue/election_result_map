$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$environmentPath = Join-Path $projectRoot ".venv-census"
$pythonPath = Join-Path $environmentPath "Scripts\python.exe"

if (-not (Test-Path $pythonPath)) {
    py -3 -m venv $environmentPath
}

& $pythonPath -m pip install --disable-pip-version-check -r (Join-Path $projectRoot "requirements-census.txt")
& $pythonPath (Join-Path $projectRoot "scripts\build_census_precinct_data.py") @args
